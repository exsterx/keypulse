import { Telegraf, Markup, type Context } from "telegraf";
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
import { splitMessage, truncate } from "../utils/text";
import { unixSeconds } from "../utils/dates";
import { parseDurationSeconds, errMsg } from "../utils/misc";

export interface BotServices {
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

function argAfter(ctx: Context): string {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
  return text.replace(/^\/\w+(?:@\w+)?\s*/, "").trim();
}

async function replyInChunks(ctx: Context, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) {
    await ctx.reply(chunk);
  }
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

export function registerBotHandlers(bot: Telegraf, services: BotServices): void {
  const { config, logger, keywordManager, chatRepo, messageRepo, monitor, account, digest, matcher } = services;

  // Owner-only guard: reject anyone whose Telegram user id is not configured.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== config.ownerTelegramId) {
      await ctx.reply("⛔ Доступ запрещён. Этот бот управляется только его владельцем.");
      return;
    }
    return next();
  });

  bot.catch((error) => {
    logger.error(`Bot handler error: ${errMsg(error)}`);
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Привет! Я — локальный Telegram Keyword Monitor.\n\n" +
        "Я отслеживаю сообщения в доступных твоему аккаунту каналах и группах, " +
        "ищу совпадения по ключевым словам и присылаю уведомления.\n\n" + HELP_TEXT
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command("status", async (ctx) => {
    const keywords = keywordManager.list();
    const activeKeywords = keywords.filter((k) => k.enabled).length;
    const lines = [
      `Состояние: ${monitor.isPaused() ? "⏸ приостановлен" : "▶ активен"}`,
      `Аккаунт Telegram: ${account.isConnected() ? "✅ подключён" : "❌ не подключён"}`,
      `Режим мониторинга: ${config.monitorMode}`,
      `Режим поиска: ${matcher.getMode()}`,
      `Часовой пояс: ${config.timezone}`,
      `Отслеживается чатов: ${chatRepo.getMonitored().length}`,
      `Исключено чатов: ${chatRepo.getExcluded().length}`,
      `Ключевых слов: ${activeKeywords} активных из ${keywords.length}`,
      `Совпадений всего: ${messageRepo.total()}`,
    ];
    await ctx.reply(lines.join("\n"));
  });

  bot.command("keywords", async (ctx) => {
    const keywords = keywordManager.list();
    if (keywords.length === 0) {
      await ctx.reply("Ключевых слов нет. Добавьте их в keywords.txt или командой /add.");
      return;
    }
    await ctx.reply(`Ключевых слов: ${keywords.length}. Нажмите на кнопку, чтобы удалить слово:`);

    const sorted = [...keywords].sort((a, b) =>
      a.phrase.localeCompare(b.phrase, "ru", { sensitivity: "base" })
    );
    const rows = sorted.map((k) => [
      Markup.button.callback(
        k.enabled ? `${truncate(k.phrase, 40)} ❌` : `${truncate(k.phrase, 34)} (откл) ❌`,
        `kwdel:${k.id}`
      ),
    ]);
    const rowsPerMessage = 20;
    const totalMessages = Math.ceil(rows.length / rowsPerMessage);
    let part = 0;
    for (let i = 0; i < rows.length; i += rowsPerMessage) {
      part += 1;
      const slice = rows.slice(i, i + rowsPerMessage);
      const caption = totalMessages > 1 ? `Ключи (часть ${part}/${totalMessages}):` : "Ключи:";
      await ctx.reply(caption, Markup.inlineKeyboard(slice));
    }
  });

  bot.command("add", async (ctx) => {
    const phrase = argAfter(ctx);
    if (!phrase) {
      await ctx.reply("Укажите ключевое слово или фразу: /add airdrop checker");
      return;
    }
    if (keywordManager.add(phrase)) {
      await ctx.reply(`✅ Добавлено: ${phrase}`);
    } else {
      await ctx.reply(`⚠️ Ключевое слово «${phrase}» уже существует.`);
    }
  });

  bot.command("remove", async (ctx) => {
    const phrase = argAfter(ctx);
    if (!phrase) {
      await ctx.reply("Укажите ключевое слово: /remove airdrop");
      return;
    }
    if (keywordManager.remove(phrase)) {
      await ctx.reply(`✅ Удалено: ${phrase}`);
    } else {
      await ctx.reply(`⚠️ Ключевое слово «${phrase}» не найдено.`);
    }
  });

  bot.command("enable", async (ctx) => {
    const phrase = argAfter(ctx);
    if (!phrase) {
      await ctx.reply("Укажите ключевое слово: /enable airdrop");
      return;
    }
    if (keywordManager.setEnabled(phrase, true)) {
      await ctx.reply(`✅ Включено: ${phrase}`);
    } else {
      await ctx.reply(`⚠️ Слово «${phrase}» не найдено или уже включено.`);
    }
  });

  bot.command("disable", async (ctx) => {
    const phrase = argAfter(ctx);
    if (!phrase) {
      await ctx.reply("Укажите ключевое слово: /disable airdrop");
      return;
    }
    if (keywordManager.setEnabled(phrase, false)) {
      await ctx.reply(`🔕 Отключено (без удаления): ${phrase}`);
    } else {
      await ctx.reply(`⚠️ Слово «${phrase}» не найдено или уже отключено.`);
    }
  });

  bot.command("chats", async (ctx) => {
    const chats = chatRepo.getMonitored();
    if (chats.length === 0) {
      await ctx.reply("Нет отслеживаемых чатов. Приложение автоматически находит доступные каналы и группы при запуске.");
      return;
    }
    await ctx.reply(`Отслеживается чатов: ${chats.length}. Нажмите на кнопку, чтобы исключить чат:`);
    const rows = chats.map((c) => [Markup.button.callback(`🚫 ${truncate(c.title, 32)}`, `exclude:${c.id}`)]);
    const chunkSize = 40;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const slice = rows.slice(i, i + chunkSize);
      await ctx.reply(`Чаты ${i + 1}–${i + slice.length}:`, Markup.inlineKeyboard(slice));
    }
  });

  bot.command("pause", async (ctx) => {
    monitor.pause();
    await ctx.reply("⏸ Мониторинг приостановлен.");
  });

  bot.command("resume", async (ctx) => {
    monitor.resume();
    await ctx.reply("▶ Мониторинг возобновлён.");
  });

  bot.command("stats", async (ctx) => {
    const stats = digest.computeStats(unixSeconds() - 86400);
    const lines = [
      `Всего совпадений: ${stats.total}`,
      `За последние 24 часа: ${stats.last24h}`,
      ``,
      `🔑 Топ ключевых слов:`,
      ...stats.topKeywords.slice(0, 10).map((k) => `  • ${k.keyword} — ${k.count}`),
      ``,
      `📡 Топ источников:`,
      ...stats.topChats.slice(0, 10).map((c) => `  • ${c.chat} — ${c.count}`),
    ];
    await replyInChunks(ctx, lines.join("\n"));
  });

  bot.command("digest", async (ctx) => {
    const since = unixSeconds() - 86400;
    const until = unixSeconds();
    const count = messageRepo.getMatchesBetween(since, until).length;
    if (count === 0) {
      await ctx.reply("За последние сутки совпадений нет.");
      return;
    }
    await ctx.reply("📊 Формирую сводку…");
    const text = digest.buildDigest(since, until);
    for (const chunk of splitMessage(text)) {
      await ctx.reply(chunk, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    }
  });

  bot.command("scan", async (ctx) => {
    const arg = argAfter(ctx) || undefined;
    const seconds = parseDurationSeconds(arg, config.backfillDays);
    const days = Math.max(1, Math.round(seconds / 86400));

    if (monitor.backfiller.isRunning()) {
      await ctx.reply("⏳ Сканирование уже выполняется.");
      return;
    }
    await ctx.reply(`🚀 Запускаю сканирование истории за последние ${days} дн…`);

    void monitor.backfiller
      .scanAll(seconds, config.backfillLimit, true)
      .then((summary) => {
        void ctx.reply(
          `✅ Сканирование завершено: ${summary.chatsScanned} чатов, ${summary.totalMessages} сообщений.`
        );
      })
      .catch((error) => {
        void ctx.reply(`❌ Ошибка сканирования: ${errMsg(error)}`);
      });
  });

  bot.command("exclude", async (ctx) => {
    const excluded = chatRepo.getExcluded();
    if (excluded.length === 0) {
      await ctx.reply("Нет исключённых чатов.");
      return;
    }
    await ctx.reply(`Исключено чатов: ${excluded.length}. Нажмите на кнопку, чтобы вернуть чат в мониторинг:`);
    const rows = excluded.map((c) => [Markup.button.callback(`✅ ${truncate(c.title, 32)}`, `include:${c.id}`)]);
    const chunkSize = 40;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const slice = rows.slice(i, i + chunkSize);
      await ctx.reply(`Чаты ${i + 1}–${i + slice.length}:`, Markup.inlineKeyboard(slice));
    }
  });

  bot.command("exclude_chat", async (ctx) => {
    const id = parseInt(argAfter(ctx), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply("Укажите ID чата: /exclude_chat 123456789");
      return;
    }
    const chat = chatRepo.getById(id);
    if (!chat) {
      await ctx.reply(`⚠️ Чат с id ${id} не найден. Список чатов: /chats`);
      return;
    }
    chatRepo.setMonitored(id, false);
    await ctx.reply(`🚫 Чат «${chat.title}» исключён из мониторинга.`);
  });

  bot.command("include_chat", async (ctx) => {
    const id = parseInt(argAfter(ctx), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply("Укажите ID чата: /include_chat 123456789");
      return;
    }
    const chat = chatRepo.getById(id);
    if (!chat) {
      await ctx.reply(`⚠️ Чат с id ${id} не найден. Список исключённых: /exclude`);
      return;
    }
    chatRepo.setMonitored(id, true);
    await ctx.reply(`✅ Чат «${chat.title}» возвращён в мониторинг.`);
  });

  bot.action(/^exclude:(-?\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    const chat = chatRepo.getById(id);
    if (!chat) {
      await ctx.answerCbQuery("Чат не найден.");
      return;
    }
    chatRepo.setMonitored(id, false);
    await ctx.answerCbQuery(`Чат «${chat.title}» исключён из мониторинга.`);
  });

  bot.action(/^include:(-?\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    const chat = chatRepo.getById(id);
    if (!chat) {
      await ctx.answerCbQuery("Чат не найден.");
      return;
    }
    chatRepo.setMonitored(id, true);
    await ctx.answerCbQuery(`Чат «${chat.title}» возвращён в мониторинг.`);
  });

  bot.action(/^kwdel:(\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    const keyword = keywordManager.list().find((k) => k.id === id);
    if (!keyword) {
      await ctx.answerCbQuery("Ключевое слово не найдено.");
      return;
    }
    keywordManager.remove(keyword.phrase);
    await ctx.answerCbQuery(`Ключ «${keyword.phrase}» удалён.`);
  });
}

