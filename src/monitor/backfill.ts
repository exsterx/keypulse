import type { Api } from "telegram";
import type { Logger } from "../utils/logger";
import type { ChatRepository, ChatRecord } from "../storage/chatRepository";
import type { BackfillRepository } from "../storage/backfillRepository";
import type { MessageRepository } from "../storage/messageRepository";
import type { TelegramAccount } from "../telegram/client";
import type { SemanticKeyManager } from "../semantic/semanticKeyManager";
import type { SemanticMatcher } from "../semantic/semanticMatcher";
import type { RerankerService } from "../semantic/rerankerService";
import type { MessageProcessor } from "./messageProcessor";
import { errMsg, sleep, toNumber } from "../utils/misc";

export interface ScanSummary {
  chatsScanned: number;
  /** Monitored chats that could not be opened (no cached peer and no way to resolve one). */
  skippedChats: number;
  totalMessages: number;
  /** True when the cross-encoder also scored the scanned history. */
  semantic: boolean;
}

export interface ScanProgress {
  /** Chats fully scanned so far. */
  chatsDone: number;
  chatsTotal: number;
  /** Messages scanned so far across all chats. */
  messages: number;
  chatTitle: string;
}

export interface ScanOptions {
  /**
   * Also match history by meaning. Off by default: the cross-encoder costs
   * roughly 16–20 ms per (message, key) pair, so a week of history across many
   * chats takes minutes instead of seconds. `/scan` turns it on (and
   * `/scan <period> fast` turns it back off).
   */
  semantic?: boolean;
  /** Called after every chat and periodically during long scans. */
  onProgress?: (progress: ScanProgress) => void;
}

export interface BackfillerDeps {
  account: TelegramAccount;
  chatRepo: ChatRepository;
  backfillRepo: BackfillRepository;
  messageRepo: MessageRepository;
  processor: MessageProcessor;
  entities: Map<number, Api.TypeInputPeer>;
  logger: Logger;
  reranker: RerankerService;
  semanticKeys: SemanticKeyManager;
  semanticMatcher: SemanticMatcher;
}

/** Drain the semantic queue every N messages so a long scan cannot overflow it. */
const SEMANTIC_DRAIN_EVERY = 8;
const SEMANTIC_PROGRESS_EVERY = 100;
/** Give up waiting on the semantic queue for this long, then keep scanning. */
const SEMANTIC_DRAIN_TIMEOUT_MS = 120_000;
/**
 * Brief pauses between Telegram history calls. Without them a scan hammers the
 * single MTProto connection with getMessages requests, which starves GramJS's
 * update-loop ping and makes it time out (and reconnect) mid-scan.
 */
const API_PAGE_DELAY_MS = 150;
const API_CHAT_DELAY_MS = 200;

/**
 * Scans message history of the monitored chats with paging, a time window
 * and a hard per-chat limit. Progress is persisted so a restart can resume.
 */
export class Backfiller {
  private running = false;
  private readonly batchSize = 100;

  constructor(private readonly deps: BackfillerDeps) {}

  isRunning(): boolean {
    return this.running;
  }

  async scanAll(
    daysSeconds: number,
    limit: number,
    force = false,
    options: ScanOptions = {}
  ): Promise<ScanSummary> {
    if (this.running) {
      throw new Error("A scan is already in progress.");
    }
    this.running = true;
    const semantic = this.resolveSemantic(options.semantic === true);
    // A scan keeps the connection busy with getMessages and (for deep scans)
    // pegs the CPU; keep the liveness watchdog from mistaking that load for a
    // dead connection and reconnecting on every tick.
    this.deps.account.setWatchdogPaused(true);
    try {
      const chats = this.deps.chatRepo.getMonitored();
      let total = 0;
      let clearedMarkers = 0;
      let scannedChats = 0;
      let skippedChats = 0;

      let index = 0;
      for (const chat of chats) {
        index += 1;
        const inputEntity = await this.inputEntityFor(chat.id);
        if (!inputEntity) {
          skippedChats += 1;
          this.deps.logger.warn(
            `No input entity for chat ${chat.id} (${chat.title}); skipping backfill. It will be picked up once Telegram returns it in the dialog list.`
          );
          continue;
        }
        if (force) {
          // A forced rescan is meant to re-evaluate the history with the current
          // keyword set, so the per-message "already processed" markers have to go
          // first — otherwise every message is skipped before matching runs.
          const cleared = this.deps.messageRepo.clearProcessed(chat.id);
          clearedMarkers += cleared;
          this.deps.backfillRepo.reset(chat.id);
          this.deps.logger.info(
            `Force rescan of ${chat.title}: cleared ${cleared} processed marker(s).`
          );
        }
        this.deps.logger.info(`Backfilling ${index}/${chats.length}: ${chat.title}…`);
        try {
          const scanned = await this.scanChat(
            chat,
            inputEntity,
            daysSeconds,
            limit,
            semantic,
            options.onProgress
              ? (scannedInChat) =>
                  options.onProgress?.({
                    chatsDone: scannedChats,
                    chatsTotal: chats.length,
                    messages: total + scannedInChat,
                    chatTitle: chat.title,
                  })
              : undefined
          );
          total += scanned;
          scannedChats += 1;
          this.deps.logger.info(`Backfilled ${chat.title}: ${scanned} messages.`);
          options.onProgress?.({
            chatsDone: scannedChats,
            chatsTotal: chats.length,
            messages: total,
            chatTitle: chat.title,
          });
        } catch (error) {
          skippedChats += 1;
          this.deps.logger.error(`Backfill failed for chat ${chat.id} (${chat.title}): ${errMsg(error)}`);
        }
        await sleep(API_CHAT_DELAY_MS);
      }

      if (semantic) {
        // Flush whatever is left before reporting the totals.
        await this.deps.semanticMatcher.whenIdle(SEMANTIC_DRAIN_TIMEOUT_MS);
        const dropped = this.deps.semanticMatcher.getDropped();
        if (dropped > 0) {
          this.deps.logger.warn(
            `${dropped} message(s) were dropped from the semantic queue during the scan and stay keyword-only; run the scan again to score them.`
          );
        }
      }

      const suffix = semantic ? ", semantic matching on" : "";
      const skipped = skippedChats > 0 ? `, ${skippedChats} chat(s) skipped (no peer)` : "";
      this.deps.logger.info(
        force
          ? `Backfill finished: ${scannedChats} chats, ${total} messages scanned, ${clearedMarkers} processed marker(s) cleared${skipped}${suffix}.`
          : `Backfill finished: ${scannedChats} chats, ${total} messages scanned${skipped}${suffix}.`
      );
      return { chatsScanned: scannedChats, skippedChats, totalMessages: total, semantic };
    } finally {
      this.deps.account.setWatchdogPaused(false);
      this.running = false;
    }
  }

  /**
   * Decides whether the requested semantic pass can actually run. Loading the
   * model downloads ~570 MB on first use, so a scan never waits for it: if the
   * reranker is not ready yet the scan silently degrades to keyword-only.
   */
  private resolveSemantic(requested: boolean): boolean {
    if (!requested) return false;
    const active = this.deps.semanticKeys.activeKeys().length;
    if (active === 0) {
      this.deps.logger.warn(
        "Semantic history scan requested, but no semantic keys are active; scanning keywords only."
      );
      return false;
    }
    const status = this.deps.reranker.getStatus();
    if (status !== "ready") {
      this.deps.logger.warn(
        `Semantic history scan requested, but the reranker is "${status}"; scanning keywords only. ` +
          "Run the scan again once the model reports ready."
      );
      return false;
    }
    this.deps.logger.info(
      `Semantic history scan enabled: ${active} key(s), ~16–20 ms per (message, key) pair.`
    );
    return true;
  }

  /**
   * Returns a peer for the chat, resolving it on demand when the dialog cache
   * has none. Archived chats were missing from that cache on older builds, which
   * made a scan report "0 chats scanned" without explaining why.
   */
  private async inputEntityFor(chatId: number): Promise<Api.TypeInputPeer | undefined> {
    const cached = this.deps.entities.get(chatId);
    if (cached) return cached;
    const resolved = await this.deps.account.resolveInputEntity(chatId);
    if (!resolved) return undefined;
    this.deps.entities.set(chatId, resolved);
    this.deps.logger.info(`Resolved missing input entity for chat ${chatId}.`);
    return resolved;
  }

  private async scanChat(
    chat: ChatRecord,
    inputEntity: Api.TypeInputPeer,
    daysSeconds: number,
    limit: number,
    semantic: boolean,
    onTick?: (scannedInChat: number) => void
  ): Promise<number> {
    const state = this.deps.backfillRepo.get(chat.id);
    const minDate = Math.floor(Date.now() / 1000) - daysSeconds;

    let offsetId = state && state.completed === 0 ? state.last_offset_id : 0;
    let scannedInRun = 0;
    let cumulative = state?.scanned_count ?? 0;
    let queued = 0;
    let nextProgressAt = SEMANTIC_PROGRESS_EVERY;

    for (;;) {
      const params: { limit: number; offsetId?: number } = { limit: this.batchSize };
      if (offsetId) params.offsetId = offsetId;

      let messages: Api.Message[];
      try {
        messages = await this.deps.account.getMessages(inputEntity, params);
      } catch (error) {
        this.deps.logger.error(`Backfill error for chat ${chat.id}: ${errMsg(error)}`);
        break;
      }

      if (messages.length === 0) {
        this.markCompleted(chat.id, offsetId, cumulative);
        break;
      }

      let stoppedByDate = false;
      for (const message of messages) {
        const raw = message as unknown as Record<string, unknown>;
        const msgDate = toNumber(raw.date);
        if (msgDate && msgDate < minDate) {
          // This message (and everything older in the batch) is outside the window.
          stoppedByDate = true;
          break;
        }
        // Without the flag the scan stays keyword-only: a cross-encoder pass is
        // cheap enough now (~16–20 ms per pair) but still adds up over a week of
        // history across many chats, so it is opt-in via `deep` or a manual scan.
        await this.deps.processor.process(message, { semantic });
        scannedInRun += 1;
        cumulative += 1;

        if (semantic) {
          queued += 1;
          if (queued >= SEMANTIC_DRAIN_EVERY) {
            queued = 0;
            // Keep the queue short: unscored messages must not pile up, and a
            // burst of history should not push live messages out of the queue.
            await this.deps.semanticMatcher.whenIdle(SEMANTIC_DRAIN_TIMEOUT_MS);
            if (scannedInRun >= nextProgressAt) {
              nextProgressAt += SEMANTIC_PROGRESS_EVERY;
              this.deps.logger.info(
                `Semantic backfill ${chat.title}: ${scannedInRun} message(s) of ${cumulative} scanned so far.`
              );
            }
            // The caller throttles its own output (a Telegram reply every few
            // minutes), so the tick itself can stay cheap.
            onTick?.(scannedInRun);
          }
        }
      }

      if (semantic) {
        // Flush the tail of this batch before moving the offset forward.
        await this.deps.semanticMatcher.whenIdle(SEMANTIC_DRAIN_TIMEOUT_MS);
      }

      const oldest = messages[messages.length - 1] as unknown as Record<string, unknown>;
      offsetId = toNumber(oldest.id);

      if (stoppedByDate || scannedInRun >= limit) {
        this.markCompleted(chat.id, offsetId, cumulative);
        break;
      }

      this.deps.backfillRepo.update(chat.id, {
        lastOffsetId: offsetId,
        scannedCount: cumulative,
        completed: false,
      });

      // Let the connection breathe between pages so the update-loop ping and
      // live-message handling are not starved by a burst of getMessages calls.
      await sleep(API_PAGE_DELAY_MS);
    }

    return scannedInRun;
  }

  private markCompleted(chatId: number, offsetId: number, scannedCount: number): void {
    this.deps.backfillRepo.update(chatId, {
      lastOffsetId: offsetId,
      scannedCount,
      completed: true,
    });
  }
}
