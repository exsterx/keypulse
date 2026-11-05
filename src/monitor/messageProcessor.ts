import type { Api } from "telegram";
import type { Logger } from "../utils/logger";
import { ChatRepository, type ChatType, type ChatUpsertInput } from "../storage/chatRepository";
import { MessageRepository } from "../storage/messageRepository";
import { KeywordMatcher } from "../matcher/matcher";
import type { Notifier } from "../notifications/notifier";
import { buildMessageLink } from "../utils/text";
import { toNumber } from "../utils/misc";

export interface ProcessorDeps {
  chatRepo: ChatRepository;
  messageRepo: MessageRepository;
  matcher: KeywordMatcher;
  notifier: Notifier;
  logger: Logger;
}

function extractText(msg: Api.Message): string {
  const raw = msg as unknown as Record<string, unknown>;
  const text = raw.text ?? raw.message ?? "";
  return typeof text === "string" ? text.trim() : "";
}

function extractChatInfo(msg: Api.Message): ChatUpsertInput {
  const raw = msg as unknown as Record<string, unknown>;
  const chatId = toNumber(raw.chatId);
  const entity = raw.chat as { megagroup?: boolean; title?: string; username?: string } | undefined;
  const type: ChatType = raw.isChannel
    ? entity?.megagroup
      ? "supergroup"
      : "channel"
    : "group";
  return {
    id: chatId,
    title: String(entity?.title ?? `Chat ${chatId}`),
    username: entity?.username ? String(entity.username) : null,
    type,
  };
}

/**
 * Shared by the live handler and the history backfiller. Extracts text,
 * matches keywords, de-duplicates and enqueues notifications.
 */
export class MessageProcessor {
  constructor(private readonly deps: ProcessorDeps) {}

  async process(msg: Api.Message): Promise<void> {
    const raw = msg as unknown as Record<string, unknown>;
    const chatId = toNumber(raw.chatId);
    const messageId = toNumber(raw.id);
    if (!chatId || !messageId) return;

    let chat = this.deps.chatRepo.getById(chatId);
    if (!chat) {
      // Only channels/groups are monitored; private chats with users are skipped.
      if (!raw.isChannel && !raw.isGroup) return;
      chat = this.deps.chatRepo.upsert(extractChatInfo(msg));
      this.deps.logger.info(`Auto-registered chat ${chatId} (${chat.title})`);
    }
    if (chat.is_monitored !== 1) return;

    if (this.deps.messageRepo.isProcessed(chatId, messageId)) return;

    const text = extractText(msg);
    const result = text ? this.deps.matcher.match(text) : { matched: [], excluded: false };
    const isMatch = result.matched.length > 0 && !result.excluded;

    this.deps.messageRepo.markProcessed(chatId, messageId, isMatch);

    if (!isMatch) return;

    const link = buildMessageLink(chat, messageId);
    const rowId = this.deps.messageRepo.addMatch({
      chatId,
      messageId,
      messageDate: toNumber(raw.date) || null,
      text,
      matchedKeywords: result.matched.map((k) => k.phrase),
      link,
    });

    if (rowId > 0) {
      this.deps.notifier.enqueue({
        messageRowId: rowId,
        chatTitle: chat.title,
        chatId,
        messageId,
        messageDate: toNumber(raw.date) || null,
        matchedKeywords: result.matched.map((k) => k.phrase),
        text,
        link,
      });
    }
  }
}
