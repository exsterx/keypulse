import type { AppConfig } from "../config/config";
import type { Logger } from "../utils/logger";
import type { MessageRepository } from "../storage/messageRepository";
import type { NotificationRepository } from "../storage/notificationRepository";
import { splitMessage, escapeHtml, highlightKeywords } from "../utils/text";
import { formatDate } from "../utils/dates";
import { errMsg, sleep } from "../utils/misc";
import { t } from "../utils/i18n";

export interface Notification {
  messageRowId: number;
  chatTitle: string;
  chatId: number;
  messageId: number;
  messageDate: number | null;
  matchedKeywords: string[];
  text: string;
  link: string | null;
}

function formatNotification(n: Notification, timezone: string, lang: "en" | "ru"): string {
  const lines: string[] = [];
  lines.push(`🔔 <b>${escapeHtml(n.chatTitle)}</b>`);
  lines.push(`🕒 ${formatDate(n.messageDate, timezone, lang)}`);
  lines.push(`🔑 ${escapeHtml(n.matchedKeywords.join(", "))}`);
  if (n.link) lines.push(`🔗 ${escapeHtml(n.link)}`);
  lines.push("");
  lines.push(highlightKeywords(n.text, n.matchedKeywords));
  return lines.join("\n");
}

export interface NotifierSendExtra {
  parse_mode?: string;
  link_preview_options?: { is_disabled?: boolean };
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
}

/**
 * Sends matched-message notifications through the bot with a queue,
 * rate limiting, batching and retry-on-transient-failure support.
 */
export class Notifier {
  private queue: Notification[] = [];
  private processing = false;
  private batchAccumulator: Notification[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private recentSendTimes: number[] = [];

  constructor(
    private readonly sendFn: (
      chatId: number,
      text: string,
      extra?: NotifierSendExtra
    ) => Promise<unknown>,
    private readonly messageRepo: MessageRepository,
    private readonly notificationRepo: NotificationRepository,
    private readonly config: AppConfig,
    private readonly targetChatId: number,
    private readonly logger: Logger
  ) {}

  enqueue(notification: Notification): void {
    if (this.config.notificationMode === "batch") {
      this.batchAccumulator.push(notification);
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => void this.flushBatch(), this.config.notificationBatchSeconds * 1000);
      }
    } else {
      this.queue.push(notification);
      void this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        await this.throttle();
        const notification = this.queue.shift()!;
        await this.sendOne(notification);
      }
    } finally {
      this.processing = false;
    }
  }

  private async flushBatch(): Promise<void> {
    this.batchTimer = null;
    const items = this.batchAccumulator.splice(0);
    if (items.length === 0) return;

    const blocks = items.map((n) => formatNotification(n, this.config.timezone, this.config.language));
    const combined = blocks.join("\n\n──────────\n\n");

    try {
      const extra: NotifierSendExtra = {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      };
      for (const chunk of splitMessage(combined)) {
        await this.sendRaw(chunk, extra);
      }
      for (const item of items) {
        this.messageRepo.markNotified(item.messageRowId);
      }
      this.notificationRepo.log(null, String(this.targetChatId), "sent");
    } catch (error) {
      this.logger.error(`Batch notification failed: ${errMsg(error)}`);
      this.notificationRepo.log(null, String(this.targetChatId), "failed", errMsg(error));
    }
  }

  private async sendOne(notification: Notification): Promise<void> {
    const text = formatNotification(notification, this.config.timezone, this.config.language);
    const extra: NotifierSendExtra = {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: t(this.config.language, "notify.exclude"), callback_data: `exclude:${notification.chatId}` }]],
      },
    };
    try {
      for (const chunk of splitMessage(text)) {
        await this.sendRaw(chunk, extra);
      }
      this.messageRepo.markNotified(notification.messageRowId);
      this.notificationRepo.log(notification.messageRowId, String(this.targetChatId), "sent");
    } catch (error) {
      this.logger.error(`Notification failed: ${errMsg(error)}`);
      this.notificationRepo.log(
        notification.messageRowId,
        String(this.targetChatId),
        "failed",
        errMsg(error)
      );
    }
  }

  /** Send a single chunk with a small retry/backoff loop for transient errors. */
  private async sendRaw(text: string, extra: NotifierSendExtra): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        await this.sendFn(this.targetChatId, text, extra);
        return;
      } catch (error) {
        attempt += 1;
        const message = errMsg(error);
        this.logger.error(`Send attempt ${attempt} failed: ${message}`);
        if (attempt >= 5) throw error;
        await sleep(Math.min(30000, 1000 * 2 ** attempt));
      }
    }
  }

  /** Simple sliding-window rate limiter (max N sends per minute). */
  private async throttle(): Promise<void> {
    const now = Date.now();
    this.recentSendTimes = this.recentSendTimes.filter((t) => now - t < 60000);
    if (this.recentSendTimes.length >= this.config.notificationMaxPerMinute) {
      const oldest = this.recentSendTimes[0];
      const wait = 60000 - (now - oldest) + 250;
      await sleep(wait);
    }
    this.recentSendTimes.push(Date.now());
  }

  stop(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
}
