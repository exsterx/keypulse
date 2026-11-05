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

const HELP_TEXT = [
  "Команды управления:",
  "/start — приветствие",
  "/help — справка",
  "/status — состояние мониторинга",
  "/keywords — список ключевых слов",
  "/add КЛЮЧ — добавить ключевое слово",
  "/remove КЛЮЧ — удалить ключевое слово",
  "/enable КЛЮЧ — включить отключённое слово",
  "/disable КЛЮЧ — отключить слово без удаления",
  "/chats — список отслеживаемых чатов",
  "/pause — приостановить мониторинг",
  "/resume — возобновить мониторинг",
  "/stats — статистика совпадений",
  "/digest — сводка за последние сутки",
  "/scan 7d — сканировать историю (7d, 24h, 30d…)",
  "/exclude — список исключённых чатов",
  "/exclude_chat ID — исключить чат",
  "/include_chat ID — вернуть чат в мониторинг",
].join("\n");

export class CommandService {
  constructor(private readonly s: CommandServices) {}

  help(): CommandResult {
    return { text: HELP_TEXT };
  }

  status(): CommandResult {
    const keywords = this.s.keywordManager.list();
    const active = keywords.filter((k) => k.enabled).length;
    return {
      text: [
        `Состояние: ${this.s.monitor.isPaused() ? "⏸ приостановлен" : "▶ активен"}`,
        `Аккаунт Telegram: ${this.s.account.isConnected() ? "✅ подключён" : "❌ не подключён"}`,
        `Режим мониторинга: ${this.s.config.monitorMode}`,
        `Режим поиска: ${this.s.matcher.getMode()}`,
        `Часовой пояс: ${this.s.config.timezone}`,
        `Отслеживается чатов: ${this.s.chatRepo.getMonitored().length}`,
        `Исключено чатов: ${this.s.chatRepo.getExcluded().length}`,
        `Ключевых слов: ${active} активных из ${keywords.length}`,
        `Совпадений всего: ${this.s.messageRepo.total()}`,
      ].join("\n"),
    };
  }

  chats(): CommandResult {
    const chats = this.s.chatRepo.getMonitored();
    if (chats.length === 0) {
      return { text: "Нет отслеживаемых чатов." };
    }
    return { text: chats.map((c) => `• ${c.title} (${c.type}, id: ${c.id})`).join("\n") };
  }

  keywords(): CommandResult {
    const keywords = this.s.keywordManager.list();
    if (keywords.length === 0) {
      return { text: "Ключевых слов нет. Добавьте их в keywords.txt или командой /add." };
    }
    return { text: keywords.map((k) => (k.enabled ? `• ${k.phrase}` : `• ${k.phrase} (отключено)`)).join("\n") };
  }

  addKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: "Укажите ключевое слово: /add airdrop checker" };
    if (this.s.keywordManager.add(phrase)) return { text: `✅ Добавлено: ${phrase}` };
    return { text: `⚠️ Ключевое слово «${phrase}» уже существует.` };
  }

  removeKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: "Укажите ключевое слово: /remove airdrop" };
    if (this.s.keywordManager.remove(phrase)) return { text: `✅ Удалено: ${phrase}` };
    return { text: `⚠️ Ключевое слово «${phrase}» не найдено.` };
  }

  enableKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: "Укажите ключевое слово: /enable airdrop" };
    if (this.s.keywordManager.setEnabled(phrase, true)) return { text: `✅ Включено: ${phrase}` };
    return { text: `⚠️ Слово «${phrase}» не найдено или уже включено.` };
  }

  disableKeyword(args: string): CommandResult {
    const phrase = args.trim();
    if (!phrase) return { text: "Укажите ключевое слово: /disable airdrop" };
    if (this.s.keywordManager.setEnabled(phrase, false)) return { text: `🔕 Отключено (без удаления): ${phrase}` };
    return { text: `⚠️ Слово «${phrase}» не найдено или уже отключено.` };
  }

  pause(): CommandResult {
    this.s.monitor.pause();
    return { text: "⏸ Мониторинг приостановлен." };
  }

  resume(): CommandResult {
    this.s.monitor.resume();
    return { text: "▶ Мониторинг возобновлён." };
  }

  stats(): CommandResult {
    const stats = this.s.digest.computeStats(unixSeconds() - 86400);
    return {
      text: [
        `Всего совпадений: ${stats.total}`,
        `За последние 24 часа: ${stats.last24h}`,
        ``,
        `🔑 Топ ключевых слов:`,
        ...stats.topKeywords.slice(0, 10).map((k) => `  • ${k.keyword} — ${k.count}`),
        ``,
        `📡 Топ источников:`,
        ...stats.topChats.slice(0, 10).map((c) => `  • ${c.chat} — ${c.count}`),
      ].join("\n"),
    };
  }

  digest(): CommandResult {
    const since = unixSeconds() - 86400;
    const until = unixSeconds();
    const count = this.s.messageRepo.getMatchesBetween(since, until).length;
    if (count === 0) return { text: "За последние сутки совпадений нет." };
    return { text: this.s.digest.buildDigest(since, until), parseMode: "HTML" };
  }

  scan(args: string): CommandResult {
    if (this.s.monitor.backfiller.isRunning()) {
      return { text: "⏳ Сканирование уже выполняется." };
    }
    const seconds = parseDurationSeconds(args || undefined, this.s.config.backfillDays);
    const days = Math.max(1, Math.round(seconds / 86400));
    void this.s.monitor.backfiller
      .scanAll(seconds, this.s.config.backfillLimit, true)
      .catch((error) => this.s.logger.error(`Scan failed: ${String(error)}`));
    return { text: `🚀 Запускаю сканирование истории за последние ${days} дн…` };
  }

  exclude(): CommandResult {
    const excluded = this.s.chatRepo.getExcluded();
    if (excluded.length === 0) return { text: "Нет исключённых чатов." };
    return { text: excluded.map((c) => `• ${c.title} (id: ${c.id})`).join("\n") };
  }

  excludeChat(args: string): CommandResult {
    const id = parseInt(args, 10);
    if (!Number.isFinite(id)) return { text: "Укажите ID чата: /exclude_chat 123456789" };
    const chat = this.s.chatRepo.getById(id);
    if (!chat) return { text: `⚠️ Чат с id ${id} не найден.` };
    this.s.chatRepo.setMonitored(id, false);
    return { text: `🚫 Чат «${chat.title}» исключён из мониторинга.` };
  }

  includeChat(args: string): CommandResult {
    const id = parseInt(args, 10);
    if (!Number.isFinite(id)) return { text: "Укажите ID чата: /include_chat 123456789" };
    const chat = this.s.chatRepo.getById(id);
    if (!chat) return { text: `⚠️ Чат с id ${id} не найден.` };
    this.s.chatRepo.setMonitored(id, true);
    return { text: `✅ Чат «${chat.title}» возвращён в мониторинг.` };
  }

  handleCallback(data: string): CommandResult {
    const exclude = /^exclude:(-?\d+)$/.exec(data);
    if (exclude) {
      const id = parseInt(exclude[1], 10);
      const chat = this.s.chatRepo.getById(id);
      if (!chat) return { callbackAnswer: "Чат не найден." };
      this.s.chatRepo.setMonitored(id, false);
      return { callbackAnswer: `Чат «${chat.title}» исключён из мониторинга.` };
    }
    const include = /^include:(-?\d+)$/.exec(data);
    if (include) {
      const id = parseInt(include[1], 10);
      const chat = this.s.chatRepo.getById(id);
      if (!chat) return { callbackAnswer: "Чат не найден." };
      this.s.chatRepo.setMonitored(id, true);
      return { callbackAnswer: `Чат «${chat.title}» возвращён в мониторинг.` };
    }
    const kwdel = /^kwdel:(\d+)$/.exec(data);
    if (kwdel) {
      const id = parseInt(kwdel[1], 10);
      const keyword = this.s.keywordManager.list().find((k) => k.id === id);
      if (!keyword) return { callbackAnswer: "Ключевое слово не найдено." };
      this.s.keywordManager.remove(keyword.phrase);
      return { callbackAnswer: `Ключ «${keyword.phrase}» удалён.` };
    }
    return { callbackAnswer: "Неизвестное действие." };
  }
}

export { HELP_TEXT };

