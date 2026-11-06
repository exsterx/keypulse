import type { AppConfig } from "../config/config";
import type { Logger } from "../utils/logger";
import type { ChatRepository } from "../storage/chatRepository";
import type { MessageRepository } from "../storage/messageRepository";
import type { SettingsRepository } from "../storage/settingsRepository";
import type { KeywordManager } from "../matcher/keywordManager";
import type { KeywordMatcher } from "../matcher/matcher";
import type { TelegramAccount } from "../telegram/client";
import type { Monitor } from "../monitor/monitor";
import type { DigestService } from "../digest/digest";
import { parseDurationSeconds } from "../utils/misc";
import { unixSeconds } from "../utils/dates";
import { t, helpText } from "../utils/i18n";

export interface CommandServices {
  config: AppConfig;
  logger: Logger;
  keywordManager: KeywordManager;
  chatRepo: ChatRepository;
  messageRepo: MessageRepository;
  settingsRepo: SettingsRepository;
  monitor: Monitor;
  account: TelegramAccount;
  digest: DigestService;
  matcher: KeywordMatcher;
}

export interface CommandResult {
  text?: string;
  callbackAnswer?: string;
  parseMode?: "HTML";
}

export class CommandService {
  constructor(private readonly s: CommandServices) {}

  private t(key: string, vars?: Record<string, string | number>): string {
    return t(this.s.config.language, key, vars);
  }

  help(): CommandResult {
    return { text: helpText(this.s.config.language) };
  }

  status(): CommandResult {
    const keywords = this.s.keywordManager.list();
    const active = keywords.filter((k) => k.enabled).length;
    const state = this.s.monitor.isPaused() ? this.t("status.paused") : this.t("status.active");
    const account = this.s.account.isConnected() ? this.t("status.connected") : this.t("status.disconnected");
    return {
      text: [
        this.t("status.state", { state }),
        this.t("status.account", { state: account }),
        this.t("status.monitorMode", { mode: this.s.config.monitorMode }),
        this.t("status.searchMode", { mode: this.s.matcher.getMode() }),
        this.t("status.timezone", { tz: this.s.config.timezone }),
        this.t("status.monitoredChats", { n: this.s.chatRepo.getMonitored().length }),
        this.t("status.excludedChats", { n: this.s.chatRepo.getExcluded().length }),
        this.t("status.keywords", { active, total: keywords.length }),
        this.t("status.totalMatches", { n: this.s.messageRepo.total() }),
      ].join("\n"),
    };
  }

  chats(): CommandResult {
    const chats = this.s.chatRepo.getMonitored();
    if (chats.length === 0) {
      return { text: this.t("chats.empty") };
    }
    return { text: chats.map((c) => `• ${c.title} (${c.type}, id: ${c.id})`).join("\n") };
  }

  keywords(): CommandResult {
    const keywords = this.s.keywordManager.list();
    if (keywords.length === 0) {
      return { text: this.t("keywords.empty") };
    }
    return {
      text: keywords
        .map((k) => (k.enabled ? `• ${k.phrase}` : `• ${k.phrase} (${this.t("keywords.disabled")})`))
        .join("\n"),
    };
  }

  addKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: this.t("kw.addUsage") };
    if (this.s.keywordManager.add(phrase)) return { text: this.t("kw.added", { phrase }) };
    return { text: this.t("kw.exists", { phrase }) };
  }

  removeKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: this.t("kw.removeUsage") };
    if (this.s.keywordManager.remove(phrase)) return { text: this.t("kw.removed", { phrase }) };
    return { text: this.t("kw.notFound", { phrase }) };
  }

  enableKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: this.t("kw.enableUsage") };
    if (this.s.keywordManager.setEnabled(phrase, true)) return { text: this.t("kw.enabled", { phrase }) };
    return { text: this.t("kw.enableFail", { phrase }) };
  }

  disableKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: this.t("kw.disableUsage") };
    if (this.s.keywordManager.setEnabled(phrase, false)) return { text: this.t("kw.disabled", { phrase }) };
    return { text: this.t("kw.disableFail", { phrase }) };
  }

  pause(): CommandResult {
    this.s.monitor.pause();
    return { text: this.t("monitor.paused") };
  }

  resume(): CommandResult {
    this.s.monitor.resume();
    return { text: this.t("monitor.resumed") };
  }

  stats(): CommandResult {
    const stats = this.s.digest.computeStats(unixSeconds() - 86400);
    return {
      text: [
        this.t("stats.total", { n: stats.total }),
        this.t("stats.last24h", { n: stats.last24h }),
        ``,
        this.t("stats.topKeywords"),
        ...stats.topKeywords.slice(0, 10).map((k) => `  • ${k.keyword} — ${k.count}`),
        ``,
        this.t("stats.topChats"),
        ...stats.topChats.slice(0, 10).map((c) => `  • ${c.chat} — ${c.count}`),
      ].join("\n"),
    };
  }

  digest(): CommandResult {
    const since = unixSeconds() - 86400;
    const until = unixSeconds();
    const count = this.s.messageRepo.getMatchesBetween(since, until).length;
    if (count === 0) return { text: this.t("digest.empty") };
    return { text: this.s.digest.buildDigest(since, until), parseMode: "HTML" };
  }

  scan(args: string): CommandResult {
    if (this.s.monitor.backfiller.isRunning()) {
      return { text: this.t("scan.running") };
    }
    const seconds = parseDurationSeconds(args || undefined, this.s.config.backfillDays);
    const days = Math.max(1, Math.round(seconds / 86400));
    void this.s.monitor.backfiller
      .scanAll(seconds, this.s.config.backfillLimit, true)
      .catch((error) => this.s.logger.error(`Scan failed: ${String(error)}`));
    return { text: this.t("scan.start", { days }) };
  }

  exclude(): CommandResult {
    const excluded = this.s.chatRepo.getExcluded();
    if (excluded.length === 0) return { text: this.t("exclude.empty") };
    return { text: excluded.map((c) => `• ${c.title} (id: ${c.id})`).join("\n") };
  }

  excludeChat(args: string): CommandResult {
    const id = parseInt(args, 10);
    if (!Number.isFinite(id)) return { text: this.t("exclude.usage") };
    const chat = this.s.chatRepo.getById(id);
    if (!chat) return { text: this.t("exclude.notFound", { id }) };
    this.s.chatRepo.setMonitored(id, false);
    return { text: this.t("exclude.done", { title: chat.title }) };
  }

  includeChat(args: string): CommandResult {
    const id = parseInt(args, 10);
    if (!Number.isFinite(id)) return { text: this.t("include.usage") };
    const chat = this.s.chatRepo.getById(id);
    if (!chat) return { text: this.t("exclude.notFound", { id }) };
    this.s.chatRepo.setMonitored(id, true);
    return { text: this.t("include.done", { title: chat.title }) };
  }

  handleCallback(data: string): CommandResult {
    const exclude = /^exclude:(-?\d+)$/.exec(data);
    if (exclude) {
      const id = parseInt(exclude[1], 10);
      const chat = this.s.chatRepo.getById(id);
      if (!chat) return { callbackAnswer: this.t("cb.chatNotFound") };
      this.s.chatRepo.setMonitored(id, false);
      return { callbackAnswer: this.t("exclude.done", { title: chat.title }) };
    }
    const include = /^include:(-?\d+)$/.exec(data);
    if (include) {
      const id = parseInt(include[1], 10);
      const chat = this.s.chatRepo.getById(id);
      if (!chat) return { callbackAnswer: this.t("cb.chatNotFound") };
      this.s.chatRepo.setMonitored(id, true);
      return { callbackAnswer: this.t("include.done", { title: chat.title }) };
    }
    const kwdel = /^kwdel:(\d+)$/.exec(data);
    if (kwdel) {
      const id = parseInt(kwdel[1], 10);
      const keyword = this.s.keywordManager.list().find((k) => k.id === id);
      if (!keyword) return { callbackAnswer: this.t("cb.keywordNotFound") };
      this.s.keywordManager.remove(keyword.phrase);
      return { callbackAnswer: this.t("cb.keywordDeleted", { phrase: keyword.phrase }) };
    }
    return { callbackAnswer: this.t("cb.unknown") };
  }
}

