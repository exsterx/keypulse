import type { Logger } from "../utils/logger";
import { MessageRepository, type MatchRecord } from "../storage/messageRepository";
import { splitMessage, truncate, escapeHtml } from "../utils/text";
import { formatDate, unixSeconds } from "../utils/dates";
import { errMsg } from "../utils/misc";
import { t, type Lang } from "../utils/i18n";

export interface StatsResult {
  total: number;
  last24h: number;
  topKeywords: { keyword: string; count: number }[];
  topChats: { chat: string; count: number }[];
}

function parseKeywords(record: MatchRecord): string[] {
  try {
    const parsed = JSON.parse(record.matched_keywords);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
  } catch {
    /* ignore */
  }
  return [record.matched_keywords];
}

function aggregate(matches: MatchRecord[]) {
  const keywordCounts = new Map<string, number>();
  const chatCounts = new Map<string, number>();
  for (const match of matches) {
    for (const keyword of parseKeywords(match)) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
    }
    const chat = match.chat_title || String(match.chat_id);
    chatCounts.set(chat, (chatCounts.get(chat) ?? 0) + 1);
  }
  const topKeywords = [...keywordCounts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  const topChats = [...chatCounts.entries()]
    .map(([chat, count]) => ({ chat, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { topKeywords, topChats };
}

export class DigestService {
  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly timezone: string,
    private readonly language: Lang,
    private readonly sendFn: (
      chatId: number,
      text: string,
      extra?: { parse_mode?: string; link_preview_options?: { is_disabled?: boolean } }
    ) => Promise<unknown>,
    private readonly targetChatId: number,
    private readonly logger: Logger
  ) {}

  computeStats(sinceSeconds: number): StatsResult {
    const matches = this.messageRepo.getMatchesBetween(sinceSeconds, unixSeconds() + 3600);
    const { topKeywords, topChats } = aggregate(matches);
    const dayAgo = unixSeconds() - 86400;
    return {
      total: this.messageRepo.total(),
      last24h: this.messageRepo.getMatchesBetween(dayAgo, unixSeconds() + 3600).length,
      topKeywords,
      topChats,
    };
  }

  buildDigest(sinceSeconds: number, untilSeconds: number): string {
    const matches = this.messageRepo.getMatchesBetween(sinceSeconds, untilSeconds);
    const { topKeywords, topChats } = aggregate(matches);

    const lines: string[] = [];
    lines.push(t(this.language, "digest.title"));
    lines.push(
      t(this.language, "digest.period", {
        from: formatDate(sinceSeconds, this.timezone, this.language),
        to: formatDate(untilSeconds, this.timezone, this.language),
      })
    );
    lines.push(t(this.language, "digest.total", { count: matches.length }));
    lines.push("");

    if (topKeywords.length) {
      lines.push(t(this.language, "digest.byKeywords"));
      for (const { keyword, count } of topKeywords) {
        lines.push(`  • ${escapeHtml(keyword)} — ${count}`);
      }
      lines.push("");
    }

    if (topChats.length) {
      lines.push(t(this.language, "digest.bySources"));
      for (const { chat, count } of topChats) {
        lines.push(`  • ${escapeHtml(chat)} — ${count}`);
      }
      lines.push("");
    }

    if (matches.length) {
      lines.push(t(this.language, "digest.messages"));
      const listed = matches.slice(-30);
      listed.forEach((match, index) => {
        const chat = escapeHtml(match.chat_title || String(match.chat_id));
        const when = formatDate(match.message_date ?? match.detected_at, this.timezone, this.language);
        const keywords = escapeHtml(parseKeywords(match).join(", "));
        lines.push(`<b>${index + 1}. [${chat}] ${when}</b>`);
        lines.push(`   🔑 ${keywords}`);
        if (match.link) lines.push(`   🔗 ${escapeHtml(match.link)}`);
        lines.push(`   ${escapeHtml(truncate(match.text, 200))}`);
        lines.push("");
      });
      if (matches.length > 30) {
        lines.push(t(this.language, "digest.more", { count: matches.length - 30 }));
      }
    }

    return lines.join("\n").trim();
  }

  /** Builds and sends the digest, splitting long text into Telegram-safe chunks. */
  async sendDigest(sinceSeconds: number, untilSeconds: number): Promise<number> {
    return this.sendDigestTo(this.targetChatId, sinceSeconds, untilSeconds);
  }

  async sendDigestTo(chatId: number, sinceSeconds: number, untilSeconds: number): Promise<number> {
    const text = this.buildDigest(sinceSeconds, untilSeconds);
    let sent = 0;
    try {
      for (const chunk of splitMessage(text)) {
        await this.sendFn(chatId, chunk, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
        sent += 1;
      }
    } catch (error) {
      this.logger.error(`Failed to send digest: ${errMsg(error)}`);
    }
    return sent;
  }
}
