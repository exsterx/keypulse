const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { Writable } = require("stream");
const winston = require("winston");

const DEFAULT_RELAY_URL = "https://keypulse.xyz/";
const BOT_USERNAME = "KeyPulseMainBot";
const APP_VERSION = require("./package.json").version;

const DEFAULTS = {
  TG_API_ID: "",
  TG_API_HASH: "",
  RELAY_URL: DEFAULT_RELAY_URL,
  RELAY_API_KEY: "",
  MONITOR_MODE: "both",
  BACKFILL_DAYS: "1",
  BACKFILL_LIMIT: "500",
  BACKFILL_MIN_INTERVAL_SECONDS: "600",
  SEARCH_MODE: "substring",
  NOTIFICATION_MODE: "each",
  TIMEZONE: "Europe/Moscow",
  DIGEST_TIME: "09:00",
  LOG_LEVEL: "info",
  LANGUAGE: "en",
};

let mainWindow = null;
let tray = null;
let engine = null; // AppHandle
let engineLogger = null;
let config = { ...DEFAULTS };
let authClient = null;
let lastEngineError = "";
let trayIcons = null;
let lastTrayState = null;
let starting = false;

const userDataDir = app.getPath("userData");
const configPath = path.join(userDataDir, "config.json");
const distDir = path.join(__dirname, "dist");

function loadConfigFile() {
  try {
    if (fs.existsSync(configPath)) {
      config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
    } else {
      saveConfigFile();
    }
    if (!config.RELAY_URL) config.RELAY_URL = DEFAULT_RELAY_URL;
  } catch (e) {
    config = { ...DEFAULTS };
  }
}

function saveConfigFile() {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

function configIsValid() {
  return !!(config.TG_API_ID && config.TG_API_HASH && config.RELAY_API_KEY);
}

function sessionFilePath() {
  return path.join(userDataDir, "data", "session.bin");
}

function sessionExists() {
  try {
    return fs.existsSync(sessionFilePath());
  } catch (_) {
    return false;
  }
}

function requireEngine() {
  return {
    startApp: require(path.join(distDir, "bootstrap.js")).startApp,
    loadConfigFromObject: require(path.join(distDir, "config", "config.js")).loadConfigFromObject,
    createLogger: require(path.join(distDir, "utils", "logger.js")).createLogger,
    saveSessionFile: require(path.join(distDir, "utils", "sessionStore.js")).saveSessionFile,
  };
}

function missingFieldsMessage() {
  const m = [];
  if (!config.TG_API_ID) m.push("API ID");
  if (!config.TG_API_HASH) m.push("API Hash");
  if (!config.RELAY_API_KEY) m.push("API-ключ релея");
  if (!m.length) return "";
  return (config.LANGUAGE || "ru") === "ru" ? "Не заполнено: " + m.join(", ") : "Missing: " + m.join(", ");
}

async function startEngine() {
  if (!configIsValid()) {
    lastEngineError = missingFieldsMessage();
    return { ok: false, error: lastEngineError };
  }
  if (!sessionExists()) {
    lastEngineError = "No Telegram session. Authorize first.";
    return { ok: false, error: lastEngineError };
  }
  starting = true;
  updateStatus();
  try {
    const { startApp, loadConfigFromObject, createLogger } = requireEngine();
    const appConfig = loadConfigFromObject(config, userDataDir);
    engineLogger = createLogger(appConfig.logsDir, appConfig.logLevel);
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("log", String(chunk).replace(/\s+$/, ""));
        }
        callback();
      },
    });
    engineLogger.add(
      new winston.transports.Stream({
        format: winston.format.combine(
          winston.format.timestamp({ format: "HH:mm:ss" }),
          winston.format.printf((info) => `${String(info.timestamp)} [${String(info.level).toUpperCase()}] ${info.message}`)
        ),
        stream: logStream,
      })
    );
    engine = await startApp(appConfig, engineLogger);
    engineLogger.info("Desktop app: engine started.");
    lastEngineError = "";
    return { ok: true };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error("engine start failed:", msg);
    lastEngineError = msg;
    return { ok: false, error: msg };
  } finally {
    starting = false;
    updateStatus();
  }
}

async function stopEngine() {
  if (engine) {
    try {
      await engine.stop();
    } catch (e) {
      /* ignore */
    }
    engine = null;
  }
}

function statusInfo() {
  if (!configIsValid()) {
    return { state: "error", label: "notConfigured", color: "red", error: missingFieldsMessage() };
  }
  if (!sessionExists()) {
    return { state: "error", label: "notAuthorized", color: "red", error: trayText("errNotAuthorized", "Not authorized") };
  }
  if (starting) {
    return { state: "connecting", label: "connecting", color: "yellow", error: "" };
  }
  if (!engine) {
    return { state: "error", label: "error", color: "red", error: lastEngineError || "" };
  }
  const s = engine.getStatus();
  if (!s.accountConnected || s.relayConnected === false) {
    return { state: "error", label: "noConnection", color: "red", error: trayText("errNoConnection", "No connection") };
  }
  if (s.paused) return { state: "paused", label: "paused", color: "yellow", error: "" };
  return { state: "running", label: "running", color: "green", error: "" };
}

function updateStatus() {
  const info = statusInfo();
  if (tray) {
    tray.setToolTip(`Keypulse — ${trayText(info.label, info.label)}`);
    const icons = getTrayIcons();
    const icon = info.state === "running" ? icons.normal : info.state === "paused" || info.state === "connecting" ? icons.yellow : icons.red;
    tray.setImage(icon);
    if (info.state !== lastTrayState) {
      lastTrayState = info.state;
      refreshTrayMenu();
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status", info);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 680,
    title: `Key Pulse v${APP_VERSION}`,
    icon: path.join(__dirname, "assets", "logo.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function trayIconWithBorder(border) {
  const p = path.join(__dirname, "assets", "logo.jpg");
  try {
    if (!fs.existsSync(p)) return nativeImage.createEmpty();
    const size = 16;
    const img = nativeImage.createFromPath(p).resize({ width: size, height: size });
    if (!border) return img;
    const bitmap = Buffer.from(img.toBitmap()); // BGRA
    const t = 2; // border thickness in px
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x >= t && y >= t && x < size - t && y < size - t) continue;
        const i = (y * size + x) * 4;
        bitmap[i] = border.b;
        bitmap[i + 1] = border.g;
        bitmap[i + 2] = border.r;
        bitmap[i + 3] = 255;
      }
    }
    return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
  } catch (_) {
    return nativeImage.createEmpty();
  }
}

function getTrayIcons() {
  if (!trayIcons) {
    trayIcons = {
      normal: trayIconWithBorder(null),
      yellow: trayIconWithBorder({ r: 255, g: 200, b: 0 }),
      red: trayIconWithBorder({ r: 255, g: 60, b: 60 }),
    };
  }
  return trayIcons;
}

function trayText(key, fallback) {
  try {
    const p = path.join(__dirname, "locales", (config.LANGUAGE || "ru") + ".json");
    const loc = JSON.parse(fs.readFileSync(p, "utf8"));
    return loc[key] || fallback;
  } catch (_) {
    return fallback;
  }
}

async function setMonitorEnabled(enabled) {
  if (!engine) return { ok: false, error: "engine not running" };
  try {
    if (enabled) engine.monitor.resume();
    else engine.monitor.pause();
    updateStatus();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const info = statusInfo();
  const monitorOn = info.state === "running" || info.state === "paused";
  const paused = info.state === "paused";
  const menu = Menu.buildFromTemplate([
    { label: "Keypulse", enabled: false },
    { label: trayText(info.label, info.label), enabled: false },
    { type: "separator" },
    {
      label: trayText(paused ? "enableMonitor" : "disableMonitor", "Toggle"),
      enabled: monitorOn,
      click: () => void setMonitorEnabled(paused),
    },
    { label: trayText("open", "Open window"), click: () => mainWindow.show() },
    {
      label: trayText("quit", "Quit"),
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(getTrayIcons().normal);
  refreshTrayMenu();
  tray.on("click", () => mainWindow.show());
}

// ---- IPC ----
ipcMain.handle("get-state", () => ({
  config,
  valid: configIsValid(),
  authorized: sessionExists(),
  status: statusInfo(),
}));

ipcMain.handle("save-config", (_e, newConfig) => {
  config = { ...DEFAULTS, ...newConfig };
  saveConfigFile();
  return { ok: true };
});

ipcMain.handle("restart-engine", async () => {
  await stopEngine();
  const result = await startEngine();
  updateStatus();
  return { ...result, status: statusInfo() };
});

ipcMain.handle("open-donate", () => {
  shell.openExternal("https://keypulse.xyz/donate.html");
  return { ok: true };
});

ipcMain.handle("monitor:setEnabled", (_e, enabled) => setMonitorEnabled(!!enabled));

ipcMain.handle("auth:reset", async () => {
  await stopEngine();
  try {
    if (fs.existsSync(sessionFilePath())) fs.unlinkSync(sessionFilePath());
  } catch (_) {}
  lastEngineError = "";
  updateStatus();
  return { ok: true, authorized: sessionExists() };
});

ipcMain.handle("bot:sendStart", async () => {
  if (!engine) {
    const r = await startEngine();
    if (!r.ok) return r;
  }
  const lang = config.LANGUAGE === "ru" ? "ru" : "en";
  try {
    await engine.account.sendMessage(BOT_USERNAME, "/start " + lang);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

// ---- Keywords / exclude words (files auto-reloaded by the running engine) ----
function keywordFilePath() {
  return path.join(userDataDir, "keywords.txt");
}
function excludeFilePath() {
  return path.join(userDataDir, "exclude_words.txt");
}
function parseKeywordLines(content) {
  const entries = [];
  for (const raw of String(content || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const disabled = /^-\s+/.test(line);
    const phrase = disabled ? line.replace(/^-\s+/, "").trim() : line;
    if (!phrase) continue;
    entries.push({ phrase, enabled: !disabled });
  }
  return entries;
}
function readKeywordFile(file) {
  try {
    return fs.existsSync(file) ? parseKeywordLines(fs.readFileSync(file, "utf8")) : [];
  } catch (_) {
    return [];
  }
}
function writeKeywordFile(file, entries, header) {
  const lines = [header];
  for (const e of entries) lines.push(e.enabled ? e.phrase : "- " + e.phrase);
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

ipcMain.handle("keywords:list", () => ({
  keywords: readKeywordFile(keywordFilePath()),
  excludes: readKeywordFile(excludeFilePath()),
}));

ipcMain.handle("keywords:add", (_e, phrase) => {
  const p = String(phrase || "").trim();
  if (!p) return { ok: false, error: "empty" };
  const file = keywordFilePath();
  const entries = readKeywordFile(file);
  if (entries.some((e) => e.phrase.toLowerCase() === p.toLowerCase())) {
    return { ok: false, error: "duplicate" };
  }
  entries.push({ phrase: p, enabled: true });
  writeKeywordFile(file, entries, "# Keywords (one per line)");
  return { ok: true };
});

ipcMain.handle("keywords:remove", (_e, phrase) => {
  const p = String(phrase || "").trim();
  const file = keywordFilePath();
  const entries = readKeywordFile(file).filter((e) => e.phrase.toLowerCase() !== p.toLowerCase());
  writeKeywordFile(file, entries, "# Keywords (one per line)");
  return { ok: true };
});

ipcMain.handle("keywords:toggle", (_e, phrase, enabled) => {
  const p = String(phrase || "").trim();
  const file = keywordFilePath();
  const entries = readKeywordFile(file).map((e) =>
    e.phrase.toLowerCase() === p.toLowerCase() ? { phrase: e.phrase, enabled: !!enabled } : e
  );
  writeKeywordFile(file, entries, "# Keywords (one per line)");
  return { ok: true };
});

ipcMain.handle("excludes:add", (_e, word) => {
  const p = String(word || "").trim();
  if (!p) return { ok: false, error: "empty" };
  const file = excludeFilePath();
  const entries = readKeywordFile(file);
  if (entries.some((e) => e.phrase.toLowerCase() === p.toLowerCase())) {
    return { ok: false, error: "duplicate" };
  }
  entries.push({ phrase: p, enabled: true });
  writeKeywordFile(file, entries, "# Exclude words (one per line)");
  return { ok: true };
});

ipcMain.handle("excludes:remove", (_e, word) => {
  const p = String(word || "").trim();
  const file = excludeFilePath();
  const entries = readKeywordFile(file).filter((e) => e.phrase.toLowerCase() !== p.toLowerCase());
  writeKeywordFile(file, entries, "# Exclude words (one per line)");
  return { ok: true };
});

ipcMain.handle("chats:list", () => {
  if (!engine) return { chats: [] };
  try {
    return { chats: engine.listChats() };
  } catch (_) {
    return { chats: [] };
  }
});

ipcMain.handle("chats:setMonitored", (_e, id, monitored) => {
  if (!engine) return { ok: false, error: "engine not running" };
  try {
    engine.setChatMonitored(Number(id), !!monitored);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

function waitFor(channel) {
  return new Promise((resolve) => ipcMain.once(channel, (_e, value) => resolve(value)));
}

function authLog(msg) {
  const line = "[auth] " + msg;
  console.log(line);
  try {
    if (engineLogger) engineLogger.info(line);
  } catch (_) {}
}

function friendlyAuthError(msg) {
  const m = String(msg || "");
  const waitMatch = m.match(/FLOOD_WAIT_(\d+)/);
  if (waitMatch) {
    const secs = parseInt(waitMatch[1], 10);
    if (secs >= 3600) return `${m} (wait ~${Math.round(secs / 3600)} h)`;
    if (secs >= 60) return `${m} (wait ~${Math.round(secs / 60)} min)`;
    return `${m} (wait ${secs} sec)`;
  }
  if (m === "FLOOD" || m === "PHONE_NUMBER_FLOOD") {
    return `${m} (Telegram anti-spam: too many attempts, wait ~24 h)`;
  }
  return m;
}

ipcMain.handle("auth:start", async (_e, phone) => {
  let lastAuthError = null;
  try {
    const { TelegramClient } = require("telegram");
    const { StringSession } = require("telegram/sessions");
    const { saveSessionFile } = requireEngine();

    const apiId = parseInt(config.TG_API_ID, 10);
    const apiHash = (config.TG_API_HASH || "").trim();
    if (!Number.isFinite(apiId) || apiId <= 0) {
      return { ok: false, error: "Telegram API ID must be a positive number (my.telegram.org)" };
    }
    if (apiHash.length < 8) {
      return { ok: false, error: "Telegram API Hash looks invalid (my.telegram.org)" };
    }
    const sessionFile = path.join(userDataDir, "data", "session.bin");

    const withTimeout = (p, ms, label) =>
      Promise.race([
        p,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(label + " timed out")), ms)
        ),
      ]);

    authClient = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 3,
      timeout: 15,
      retryDelay: 1500,
    });

    authLog("connecting to Telegram...");
    await withTimeout(authClient.connect(), 30000, "Connection to Telegram");
    authLog("connected, requesting code for " + phone);

    await withTimeout(
      authClient.start({
        phoneNumber: async () => String(phone).trim(),
        password: async () => {
          if (mainWindow) mainWindow.webContents.send("auth:prompt", "password");
          return String(await waitFor("auth:password"));
        },
        phoneCode: async () => {
          authLog("waiting for code");
          if (mainWindow) mainWindow.webContents.send("auth:prompt", "code");
          return String(await waitFor("auth:code"));
        },
        onError: (err) => {
          const rawMsg = err && (err.errorMessage || err.message) ? (err.errorMessage || err.message) : String(err);
          const msg = friendlyAuthError(rawMsg);
          lastAuthError = msg;
          authLog("onError: " + msg);
          if (mainWindow) mainWindow.webContents.send("auth:error", msg);
          return true; // stop retrying — otherwise GramJS loops forever
        },
      }),
      180000,
      "Authorization"
    );

    const session = authClient.session.save();
    saveSessionFile(sessionFile, session);
    await authClient.disconnect();
    authClient = null;
    authLog("authorization finished");
    return { ok: true };
  } catch (e) {
    const raw = e && e.message ? e.message : String(e);
    const msg = raw === "AUTH_USER_CANCEL" && lastAuthError ? lastAuthError : friendlyAuthError(raw);
    authLog("failed: " + raw + (raw !== msg ? " -> " + msg : ""));
    try {
      if (authClient) await authClient.disconnect();
    } catch (_) {}
    authClient = null;
    return { ok: false, error: msg };
  }
});

app.whenReady().then(() => {
  loadConfigFile();
  createWindow();
  createTray();
  if (configIsValid()) startEngine();
  setInterval(updateStatus, 2500);
  updateStatus();
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("window-all-closed", () => {
  app.quit();
});

