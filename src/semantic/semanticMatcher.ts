import type { Logger } from "../utils/logger";
import type { MessageRepository } from "../storage/messageRepository";
import type { Notifier } from "../notifications/notifier";
import { RerankerService, type RerankPair } from "./rerankerService";
import { SemanticKeyManager } from "./semanticKeyManager";
import { errMsg } from "../utils/misc";

export interface SemanticCandidate {
  chatId: number;
  messageId: number;
  messageDate: number | null;
  text: string;
  chatTitle: string;
  link: string | null;
}

/** Below this a chat message has no topic to judge (emoji, "ага", "+"). */
const DEFAULT_MIN_TEXT_LENGTH = 10;
const MAX_QUEUE = 2000;
/** Messages per loop iteration; each one becomes one pair per active key. */
const MESSAGE_BATCH = 8;

/**
 * Background semantic matcher. Runs outside the live-message path so keyword
 * monitoring never blocks on the model.
 *
 * Every message is scored against every active key with a cross-encoder,
 * which judges relevance of the (key, message) pair instead of comparing two
 * independent embeddings. That is what stops one crypto message from matching
 * every crypto-flavoured key at once.
 */
export class SemanticMatcher {
  private queue: SemanticCandidate[] = [];
  private running = false;
  private stopped = false;
  private droppedCount = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly reranker: RerankerService,
    private readonly keys: SemanticKeyManager,
    private readonly messageRepo: MessageRepository,
    private readonly notifier: Notifier,
    private readonly logger: Logger,
    private readonly minTextLength: number = DEFAULT_MIN_TEXT_LENGTH
  ) {}

  /**
   * Queues a message for background scoring. Returns false when nothing was
   * queued (too short, matcher stopped) or when the message pushed an older one
   * out of a full queue — history scans avoid that by awaiting {@link whenIdle}.
   */
  enqueue(candidate: SemanticCandidate): boolean {
    const text = candidate.text.trim();
    if (text.length < this.minTextLength) return false;
    if (this.stopped) return false;
    // Bound memory and keep the queue fresh: a cross-encoder pass per key is
    // far slower than the old vector lookup, so the oldest item is dropped
    // rather than letting live monitoring fall hours behind. Bulk history scans
    // must therefore drain the queue as they go (see whenIdle()).
    let accepted = true;
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      this.droppedCount += 1;
      accepted = false;
      if (this.droppedCount === 1 || this.droppedCount % 100 === 0) {
        this.logger.warn(
          `Semantic queue overflow: ${this.droppedCount} message(s) dropped so far; they stay keyword-only.`
        );
      }
    }
    this.queue.push({ ...candidate, text });
    if (!this.running) {
      this.running = true;
      void this.loop();
    }
    return accepted;
  }

  /** Messages waiting to be scored. */
  pending(): number {
    return this.queue.length;
  }

  /** Messages skipped because the queue was full (they stay keyword-only). */
  getDropped(): number {
    return this.droppedCount;
  }

  /**
   * Resolves once the queue is empty and no batch is in flight. Backfill uses
   * this between batches so a history run cannot overflow the queue and lose
   * messages that are already marked as processed.
   *
   * @param timeoutMs give up waiting after this long (0 = wait forever). Used by
   * backfill so a stuck model pass cannot stall the whole scan.
   */
  whenIdle(timeoutMs = 0): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const waiter = (): void => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.idleWaiters = this.idleWaiters.filter((pending) => pending !== waiter);
          this.logger.warn(
            `Semantic queue still holds ${this.queue.length} message(s) after ${timeoutMs} ms; continuing without waiting.`
          );
          resolve();
        }, timeoutMs);
        timer.unref?.();
      }
      this.idleWaiters.push(waiter);
    });
  }

  private notifyIdle(): void {
    if (this.running || this.queue.length > 0) return;
    for (const resolve of this.idleWaiters.splice(0, this.idleWaiters.length)) resolve();
  }

  private async loop(): Promise<void> {
    try {
      while (!this.stopped && this.queue.length > 0) {
        const ready = await this.reranker.ensureLoaded();
        if (!ready) {
          // Model unavailable: drain so we never accumulate a poison queue.
          this.drain("semantic model is not ready");
          break;
        }
        const active = this.keys.activeKeys();
        if (active.length === 0) {
          this.drain("no semantic keys are active");
          break;
        }
        const batch = this.queue.splice(0, MESSAGE_BATCH);
        try {
          await this.processBatch(batch, active);
        } catch (error) {
          this.logger.error(`Semantic batch failed: ${errMsg(error)}`);
        }
      }
    } finally {
      this.running = false;
      this.notifyIdle();
    }
  }

  private drain(reason: string): void {
    if (this.queue.length === 0) return;
    this.logger.debug(`Dropping ${this.queue.length} queued message(s): ${reason}; they stay keyword-only.`);
    this.queue = [];
  }

  private async processBatch(
    batch: SemanticCandidate[],
    active: { description: string; threshold: number }[]
  ): Promise<void> {
    const pairs: RerankPair[] = [];
    for (const candidate of batch) {
      for (const key of active) {
        pairs.push({ query: key.description, passage: candidate.text });
      }
    }
    const scores = await this.reranker.scorePairs(pairs);
    if (scores.length !== pairs.length) {
      this.logger.warn(
        `Reranker returned ${scores.length} scores for ${pairs.length} pairs; skipping batch.`
      );
      return;
    }
    for (let i = 0; i < batch.length; i++) {
      const matched: { description: string; score: number }[] = [];
      for (let j = 0; j < active.length; j++) {
        const score = scores[i * active.length + j];
        if (score >= active[j].threshold) {
          matched.push({ description: active[j].description, score });
        }
      }
      if (matched.length === 0) continue;
      this.report(batch[i], matched);
    }
  }

  private report(
    candidate: SemanticCandidate,
    matched: { description: string; score: number }[]
  ): void {
    this.logger.info(
      `Semantic match (msg ${candidate.messageId}): ${matched
        .map((m) => `${m.description} [${m.score.toFixed(3)}]`)
        .join("; ")}`
    );

    const descriptions = matched.map((m) => m.description);
    const rowId = this.messageRepo.addMatch({
      chatId: candidate.chatId,
      messageId: candidate.messageId,
      messageDate: candidate.messageDate,
      text: candidate.text,
      matchedKeywords: descriptions,
      link: candidate.link,
    });
    if (rowId <= 0) return;
    this.notifier.enqueue({
      messageRowId: rowId,
      chatTitle: candidate.chatTitle,
      chatId: candidate.chatId,
      messageId: candidate.messageId,
      messageDate: candidate.messageDate,
      matchedKeywords: descriptions,
      text: candidate.text,
      link: candidate.link,
      kind: "semantic",
    });
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.notifyIdle();
  }
}
