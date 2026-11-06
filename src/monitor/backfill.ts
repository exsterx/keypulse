import type { Api } from "telegram";
import type { Logger } from "../utils/logger";
import type { ChatRepository, ChatRecord } from "../storage/chatRepository";
import type { BackfillRepository } from "../storage/backfillRepository";
import type { TelegramAccount } from "../telegram/client";
import type { MessageProcessor } from "./messageProcessor";
import { errMsg, toNumber } from "../utils/misc";

export interface ScanSummary {
  chatsScanned: number;
  totalMessages: number;
}

export interface BackfillerDeps {
  account: TelegramAccount;
  chatRepo: ChatRepository;
  backfillRepo: BackfillRepository;
  processor: MessageProcessor;
  entities: Map<number, Api.TypeInputPeer>;
  logger: Logger;
}

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

  async scanAll(daysSeconds: number, limit: number, force = false): Promise<ScanSummary> {
    if (this.running) {
      throw new Error("A scan is already in progress.");
    }
    this.running = true;
    try {
      const chats = this.deps.chatRepo.getMonitored();
      let total = 0;

      let index = 0;
      for (const chat of chats) {
        index += 1;
        const inputEntity = this.deps.entities.get(chat.id);
        if (!inputEntity) {
          this.deps.logger.warn(`No input entity cached for chat ${chat.id}; skipping backfill.`);
          continue;
        }
        if (force) this.deps.backfillRepo.reset(chat.id);
        this.deps.logger.info(`Backfilling ${index}/${chats.length}: ${chat.title}…`);
        try {
          const scanned = await this.scanChat(chat, inputEntity, daysSeconds, limit);
          total += scanned;
          this.deps.logger.info(`Backfilled ${chat.title}: ${scanned} messages.`);
        } catch (error) {
          this.deps.logger.error(`Backfill failed for chat ${chat.id} (${chat.title}): ${errMsg(error)}`);
        }
      }

      this.deps.logger.info(`Backfill finished: ${chats.length} chats, ${total} messages scanned.`);
      return { chatsScanned: chats.length, totalMessages: total };
    } finally {
      this.running = false;
    }
  }

  private async scanChat(
    chat: ChatRecord,
    inputEntity: Api.TypeInputPeer,
    daysSeconds: number,
    limit: number
  ): Promise<number> {
    const state = this.deps.backfillRepo.get(chat.id);
    const minDate = Math.floor(Date.now() / 1000) - daysSeconds;

    let offsetId = state && state.completed === 0 ? state.last_offset_id : 0;
    let scannedInRun = 0;
    let cumulative = state?.scanned_count ?? 0;

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

      for (const message of messages) {
        await this.deps.processor.process(message);
      }

      scannedInRun += messages.length;
      cumulative += messages.length;

      const oldest = messages[messages.length - 1] as unknown as Record<string, unknown>;
      offsetId = toNumber(oldest.id);
      this.deps.backfillRepo.update(chat.id, {
        lastOffsetId: offsetId,
        scannedCount: cumulative,
        completed: false,
      });

      const oldestDate = toNumber(oldest.date);
      if (oldestDate && oldestDate < minDate) {
        this.markCompleted(chat.id, offsetId, cumulative);
        break;
      }
      if (scannedInRun >= limit) {
        this.markCompleted(chat.id, offsetId, cumulative);
        break;
      }
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
