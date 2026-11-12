export type Lang = "en" | "ru";

const translations: Record<string, Record<Lang, string>> = {
  // Help
  "help.title": { en: "Commands:", ru: "Команды управления:" },
  "help.start": { en: "/start — greeting", ru: "/start — приветствие" },
  "help.help": { en: "/help — help", ru: "/help — справка" },
  "help.status": { en: "/status — monitoring state", ru: "/status — состояние мониторинга" },
  "help.keywords": { en: "/keywords — list keywords", ru: "/keywords — список ключевых слов" },
  "help.add": { en: "/add KEYWORD — add keyword", ru: "/add КЛЮЧ — добавить ключевое слово" },
  "help.semantic": { en: "/add semantic TOPIC — add a semantic key (matches by meaning)", ru: "/add semantic ТЕМА — добавить семантический ключ (по смыслу)" },
  "help.remove": { en: "/remove KEYWORD — remove keyword", ru: "/remove КЛЮЧ — удалить ключевое слово" },
  "help.removeSemantic": { en: "/remove semantic TOPIC — remove a semantic key", ru: "/remove semantic ТЕМА — удалить семантический ключ" },
  "help.enable": { en: "/enable KEYWORD — enable a disabled word", ru: "/enable КЛЮЧ — включить отключённое слово" },
  "help.disable": { en: "/disable KEYWORD — disable without deleting", ru: "/disable КЛЮЧ — отключить слово без удаления" },
  "help.chats": { en: "/chats — list monitored chats", ru: "/chats — список отслеживаемых чатов" },
  "help.pause": { en: "/pause — pause monitoring", ru: "/pause — приостановить мониторинг" },
  "help.resume": { en: "/resume — resume monitoring", ru: "/resume — возобновить мониторинг" },
  "help.stats": { en: "/stats — match statistics", ru: "/stats — статистика совпадений" },
  "help.digest": { en: "/digest — last 24h digest", ru: "/digest — сводка за последние сутки" },
  "help.scan": { en: "/scan 7d — rescan history (7d, 24h, 30d…), keywords only", ru: "/scan 7d — пересканировать историю (7d, 24h, 30d…), только по ключевым словам" },
  "help.scanFast": { en: "/scan 7d fast — alias for the keyword-only scan", ru: "/scan 7d fast — то же, только по ключевым словам" },
  "help.scanDeep": { en: "/scan 7d deep — also match by meaning (slow, minutes–hours)", ru: "/scan 7d deep — дополнительно проверить по смыслу (долго, минуты–часы)" },
  "help.exclude": { en: "/exclude — list excluded chats", ru: "/exclude — список исключённых чатов" },
  "help.excludeChat": { en: "/exclude_chat ID — exclude a chat", ru: "/exclude_chat ID — исключить чат" },
  "help.includeChat": { en: "/include_chat ID — restore a chat", ru: "/include_chat ID — вернуть чат в мониторинг" },

  // Status
  "status.paused": { en: "⏸ paused", ru: "⏸ приостановлен" },
  "status.active": { en: "▶ active", ru: "▶ активен" },
  "status.connected": { en: "✅ connected", ru: "✅ подключён" },
  "status.disconnected": { en: "❌ not connected", ru: "❌ не подключён" },
  "status.state": { en: "State: {state}", ru: "Состояние: {state}" },
  "status.account": { en: "Telegram account: {state}", ru: "Аккаунт Telegram: {state}" },
  "status.monitorMode": { en: "Monitor mode: {mode}", ru: "Режим мониторинга: {mode}" },
  "status.searchMode": { en: "Search mode: {mode}", ru: "Режим поиска: {mode}" },
  "status.timezone": { en: "Timezone: {tz}", ru: "Часовой пояс: {tz}" },
  "status.monitoredChats": { en: "Monitored chats: {n}", ru: "Отслеживается чатов: {n}" },
  "status.excludedChats": { en: "Excluded chats: {n}", ru: "Исключено чатов: {n}" },
  "status.keywords": { en: "Keywords: {active} active of {total}", ru: "Ключевых слов: {active} активных из {total}" },
  "status.semantic": { en: "Semantic topics: {active} active of {total}", ru: "Семантических тем: {active} активных из {total}" },
  "status.totalMatches": { en: "Total matches: {n}", ru: "Совпадений всего: {n}" },

  // Chats / keywords
  "chats.empty": { en: "No monitored chats.", ru: "Нет отслеживаемых чатов." },
  "keywords.empty": { en: "No keywords. Add them via /add.", ru: "Ключевых слов нет. Добавьте их командой /add." },
  "keywords.disabled": { en: "disabled", ru: "отключено" },

  // Keyword add/remove/enable/disable
  "kw.addUsage": { en: "Specify a keyword: /add airdrop checker", ru: "Укажите ключевое слово: /add airdrop checker" },
  "kw.added": { en: "✅ Added: {phrase}", ru: "✅ Добавлено: {phrase}" },
  "kw.exists": { en: "⚠️ Keyword “{phrase}” already exists.", ru: "⚠️ Ключевое слово «{phrase}» уже существует." },
  "kw.removeUsage": { en: "Specify a keyword: /remove airdrop", ru: "Укажите ключевое слово: /remove airdrop" },
  "kw.removed": { en: "✅ Removed: {phrase}", ru: "✅ Удалено: {phrase}" },
  "kw.notFound": { en: "⚠️ Keyword “{phrase}” not found.", ru: "⚠️ Ключевое слово «{phrase}» не найдено." },
  "kw.enableUsage": { en: "Specify a keyword: /enable airdrop", ru: "Укажите ключевое слово: /enable airdrop" },
  "kw.enabled": { en: "✅ Enabled: {phrase}", ru: "✅ Включено: {phrase}" },
  "kw.enableFail": { en: "⚠️ Word “{phrase}” not found or already enabled.", ru: "⚠️ Слово «{phrase}» не найдено или уже включено." },
  "kw.disableUsage": { en: "Specify a keyword: /disable airdrop", ru: "Укажите ключевое слово: /disable airdrop" },
  "kw.disabled": { en: "🔕 Disabled (kept): {phrase}", ru: "🔕 Отключено (без удаления): {phrase}" },
  "kw.disableFail": { en: "⚠️ Word “{phrase}” not found or already disabled.", ru: "⚠️ Слово «{phrase}» не найдено или уже отключено." },

  // Semantic keys
  "semantic.title": { en: "🧠 Semantic keys:", ru: "🧠 Семантические ключи:" },
  "semantic.addUsage": { en: "Specify a topic: /add semantic problems withdrawing crypto from exchanges", ru: "Укажите тему: /add semantic проблемы с выводом криптовалюты с бирж" },
  "semantic.added": { en: "✅ Semantic key added: {description}", ru: "✅ Семантический ключ добавлен: {description}" },
  "semantic.exists": { en: "⚠️ Semantic key “{description}” already exists.", ru: "⚠️ Семантический ключ «{description}» уже существует." },
  "semantic.removeUsage": { en: "Specify a semantic key: /remove semantic problems withdrawing crypto", ru: "Укажите семантический ключ: /remove semantic проблемы с выводом криптовалюты" },
  "semantic.removed": { en: "✅ Semantic key removed: {description}", ru: "✅ Семантический ключ удалён: {description}" },
  "semantic.notFound": { en: "⚠️ Semantic key “{description}” not found.", ru: "⚠️ Семантический ключ «{description}» не найден." },
  "semantic.error": { en: "❌ Semantic error: {error}", ru: "❌ Ошибка семантики: {error}" },

  // Monitor control
  "monitor.paused": { en: "⏸ Monitoring paused.", ru: "⏸ Мониторинг приостановлен." },
  "monitor.resumed": { en: "▶ Monitoring resumed.", ru: "▶ Мониторинг возобновлён." },

  // Stats
  "stats.total": { en: "Total matches: {n}", ru: "Всего совпадений: {n}" },
  "stats.last24h": { en: "Last 24 hours: {n}", ru: "За последние 24 часа: {n}" },
  "stats.topKeywords": { en: "🔑 Top keywords:", ru: "🔑 Топ ключевых слов:" },
  "stats.topChats": { en: "📡 Top sources:", ru: "📡 Топ источников:" },

  // Digest / scan
  "digest.empty": { en: "No matches in the last 24 hours.", ru: "За последние сутки совпадений нет." },
  "scan.running": { en: "⏳ Scan already in progress.", ru: "⏳ Сканирование уже выполняется." },
  "scan.start": { en: "🚀 Scanning history for the last {days} days…", ru: "🚀 Запускаю сканирование истории за последние {days} дн…" },
  "scan.startSemantic": { en: "🚀 Scanning the last {days} days, matching by meaning too (this can take minutes–hours)…", ru: "🚀 Запускаю сканирование истории за последние {days} дн с проверкой по смыслу (это может занять очень долго, минуты–часы)…" },
  "scan.startKeywords": { en: "🚀 Scanning the last {days} days, keywords only…", ru: "🚀 Запускаю сканирование истории за последние {days} дн по ключевым словам…" },
  "scan.deep": { en: "🧠 Semantic matching is on: history is also scored by meaning, so this takes longer.", ru: "🧠 Семантическое сопоставление включено: история дополнительно проверяется по смыслу, это дольше." },
  "scan.deepHint": { en: "💡 Keywords only. Add “deep” (/scan 7d deep) to match by meaning too.", ru: "💡 Только ключевые слова. Для поиска по смыслу добавьте deep: /scan 7d deep." },
  "scan.fastHint": { en: "💡 Keywords only. Run /scan without “fast” to match by meaning.", ru: "💡 Только ключевые слова. Запустите /scan без слова fast, чтобы искать по смыслу." },

  // Chats exclude/include
  "exclude.empty": { en: "No excluded chats.", ru: "Нет исключённых чатов." },
  "exclude.usage": { en: "Specify a chat ID: /exclude_chat 123456789", ru: "Укажите ID чата: /exclude_chat 123456789" },
  "exclude.notFound": { en: "⚠️ Chat with id {id} not found.", ru: "⚠️ Чат с id {id} не найден." },
  "exclude.done": { en: "🚫 Chat “{title}” excluded from monitoring.", ru: "🚫 Чат «{title}» исключён из мониторинга." },
  "include.usage": { en: "Specify a chat ID: /include_chat 123456789", ru: "Укажите ID чата: /include_chat 123456789" },
  "include.done": { en: "✅ Chat “{title}” restored to monitoring.", ru: "✅ Чат «{title}» возвращён в мониторинг." },

  // Callbacks
  "cb.chatNotFound": { en: "Chat not found.", ru: "Чат не найден." },
  "cb.keywordNotFound": { en: "Keyword not found.", ru: "Ключевое слово не найдено." },
  "cb.keywordDeleted": { en: "Keyword “{phrase}” deleted.", ru: "Ключ «{phrase}» удалён." },
  "cb.unknown": { en: "Unknown action.", ru: "Неизвестное действие." },

  // Digest body
  "digest.title": { en: "📊 Matches digest", ru: "📊 Сводка совпадений" },
  "digest.period": { en: "Period: {from} — {to}", ru: "Период: {from} — {to}" },
  "digest.total": { en: "Total matches: {count}", ru: "Всего совпадений: {count}" },
  "digest.byKeywords": { en: "🔑 By keywords:", ru: "🔑 По ключевым словам:" },
  "digest.bySources": { en: "📡 By sources:", ru: "📡 По источникам:" },
  "digest.messages": { en: "📝 Messages:", ru: "📝 Сообщения:" },
  "digest.more": { en: "… and {count} more messages.", ru: "… и ещё {count} сообщений." },

  // Notifier button
  "notify.exclude": { en: "🚫 Exclude", ru: "🚫 Исключить" },

  // Relay bridge fallbacks
  "bridge.error": { en: "Error: {error}", ru: "Ошибка: {error}" },
  "bridge.unknownCommand": { en: "Unknown command: /{cmd}", ru: "Неизвестная команда: /{cmd}" },
};

export function t(lang: Lang | string | undefined, key: string, vars?: Record<string, string | number>): string {
  const entry = translations[key];
  let s = entry ? entry[lang === "ru" ? "ru" : "en"] ?? entry.en : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export function helpText(lang: Lang | string | undefined): string {
  const keys = [
    "help.title",
    "help.start",
    "help.help",
    "help.status",
    "help.keywords",
    "help.add",
    "help.semantic",
    "help.remove",
    "help.removeSemantic",
    "help.enable",
    "help.disable",
    "help.chats",
    "help.pause",
    "help.resume",
    "help.stats",
    "help.digest",
    "help.scan",
    "help.scanDeep",
    "help.scanFast",
    "help.exclude",
    "help.excludeChat",
    "help.includeChat",
  ];
  return keys.map((k) => t(lang, k)).join("\n");
}

