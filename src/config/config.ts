import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { loadSessionFile } from "../utils/sessionStore";

export type MonitorMode = "live" | "backfill" | "both";
export type SearchMode = "exact" | "substring" | "regex";
export type NotificationMode = "each" | "batch";

export interface AppConfig {
  rootDir: string;
  dataDir: string;
  logsDir: string;
  keywordsFile: string;
  excludeWordsFile: string;
  sessionFile: string;

  apiId: number;
  apiHash: string;
  sessionString: string;
  botToken: string;
  ownerTelegramId: number;
  targetChatId: number;

  timezone: string;
  digestTime: string;
  monitorMode: MonitorMode;
  backfillDays: number;
  backfillLimit: number;
  backfillMinIntervalSeconds: number;

  searchMode: SearchMode;
  notificationMode: NotificationMode;
  notificationBatchSeconds: number;
  notificationMaxPerMinute: number;

  notifyViaRelay: boolean;
  relayUrl: string;
  relayApiKey: string;

  logLevel: string;
}

export type ConfigSource = Record<string, string | undefined>;

function resolveRoot(): string {
  if (process.env.APP_ROOT && fs.existsSync(process.env.APP_ROOT)) {
    return process.env.APP_ROOT;
  }
  if (fs.existsSync(path.join(process.cwd(), "package.json"))) {
    return process.cwd();
  }
  let cur = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

function requireFrom(env: ConfigSource, name: string): string {
  const value = env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required setting "${name}".`);
  }
  return value.trim();
}

function parsePositiveInt(value: string | undefined, name: string): number {
  const n = parseInt(value ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid value for "${name}": expected a positive integer, got "${value}".`);
  }
  return n;
}

function pickEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value && (allowed as readonly string[]).includes(value)) return value as T;
  return fallback;
}

export function loadConfigFromObject(env: ConfigSource, rootDir: string): AppConfig {
  const dataDir = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(rootDir, "data");
  const logsDir = env.LOGS_DIR ? path.resolve(env.LOGS_DIR) : path.join(rootDir, "logs");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const apiId = parsePositiveInt(requireFrom(env, "TG_API_ID"), "TG_API_ID");
  const apiHash = requireFrom(env, "TG_API_HASH");
  const botToken = (env.BOT_TOKEN || "").trim();
  const ownerTelegramId = env.OWNER_TELEGRAM_ID
    ? parsePositiveInt(env.OWNER_TELEGRAM_ID, "OWNER_TELEGRAM_ID")
    : 0;

  const targetChatId = env.TARGET_CHAT_ID
    ? parsePositiveInt(env.TARGET_CHAT_ID, "TARGET_CHAT_ID")
    : ownerTelegramId;
  if (!targetChatId) {
    throw new Error("TARGET_CHAT_ID (or OWNER_TELEGRAM_ID) is required.");
  }

  const monitorMode = pickEnum<MonitorMode>(env.MONITOR_MODE, ["live", "backfill", "both"], "live");
  const searchMode = pickEnum<SearchMode>(env.SEARCH_MODE, ["exact", "substring", "regex"], "substring");
  const notificationMode = pickEnum<NotificationMode>(env.NOTIFICATION_MODE, ["each", "batch"], "each");

  const notifyViaRelay = env.NOTIFY_VIA_RELAY === "true" || env.NOTIFY_VIA_RELAY === "1";
  const relayUrl = (env.RELAY_URL || "").trim();
  const relayApiKey = (env.RELAY_API_KEY || "").trim();
  if (notifyViaRelay && (!relayUrl || !relayApiKey)) {
    throw new Error("NOTIFY_VIA_RELAY=true requires RELAY_URL and RELAY_API_KEY to be set.");
  }

  const sessionFile = path.join(dataDir, "session.bin");

  return {
    rootDir,
    dataDir,
    logsDir,
    keywordsFile: path.join(rootDir, "keywords.txt"),
    excludeWordsFile: path.join(rootDir, "exclude_words.txt"),
    sessionFile,

    apiId,
    apiHash,
    sessionString: loadSessionFile(sessionFile, env.TG_SESSION ?? ""),
    botToken,
    ownerTelegramId,
    targetChatId,

    timezone: env.TIMEZONE || "Europe/Moscow",
    digestTime: env.DIGEST_TIME || "09:00",
    monitorMode,
    backfillDays: parseInt(env.BACKFILL_DAYS ?? "7", 10) || 7,
    backfillLimit: parseInt(env.BACKFILL_LIMIT ?? "500", 10) || 500,
    backfillMinIntervalSeconds: parseInt(env.BACKFILL_MIN_INTERVAL_SECONDS ?? "600", 10) || 600,

    searchMode,
    notificationMode,
    notificationBatchSeconds: parseInt(env.NOTIFICATION_BATCH_SECONDS ?? "300", 10) || 300,
    notificationMaxPerMinute: parseInt(env.NOTIFICATION_MAX_PER_MINUTE ?? "20", 10) || 20,

    notifyViaRelay,
    relayUrl,
    relayApiKey,

    logLevel: env.LOG_LEVEL || "info",
  };
}

/** Read config from a JSON file (used by the desktop app; config.json). */
export function loadConfigFromFile(jsonPath: string, rootDir: string): AppConfig {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Config file not found: ${jsonPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as ConfigSource;
  return loadConfigFromObject(raw, rootDir);
}

export function loadConfig(): AppConfig {
  dotenv.config();
  return loadConfigFromObject(process.env as ConfigSource, resolveRoot());
}

