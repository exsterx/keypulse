const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULT_RELAY_URL = "https://keypulse.xyz/";
const APP_VERSION = require("./package.json").version;

const DEFAULTS = {
  TG_API_ID: "",
  TG_API_HASH: "",
  TARGET_CHAT_ID: "",
  NOTIFY_VIA_RELAY: "true",
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
  LANGUAGE: "ru",
};

let mainWindow = null;
let tray = null;
let engine = null; // AppHandle
let engineLogger = null;
let config = { ...DEFAULTS };
let authClient = null;

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
  return !!(config.TG_API_ID && config.TG_API_HASH && config.TARGET_CHAT_ID && config.RELAY_API_KEY);
}

function requireEngine() {
  return {
    startApp: require(path.join(distDir, "bootstrap.js")).startApp,
    loadConfigFromObject: require(path.join(distDir, "config", "config.js")).loadConfigFromObject,
    createLogger: require(path.join(distDir, "utils", "logger.js")).createLogger,
    saveSessionFile: require(path.join(distDir, "utils", "sessionStore.js")).saveSessionFile,
  };
}

async function startEngine() {
  if (!configIsValid()) return;
  const { startApp, loadConfigFromObject, createLogger } = requireEngine();
  try {
    const appConfig = loadConfigFromObject(config, userDataDir);
    engineLogger = createLogger(appConfig.logsDir, appConfig.logLevel);
    engine = await startApp(appConfig, engineLogger);
    engineLogger.info("Desktop app: engine started.");
  } catch (e) {
    console.error("engine start failed:", e && e.message ? e.message : e);
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
  if (!engine) {
    return { state: "notConfigured", label: "notConfigured", color: "red" };
  }
  const s = engine.getStatus();
  if (!s.accountConnected) return { state: "noConnection", label: "noConnection", color: "red" };
  if (s.relayConnected === false) return { state: "noConnection", label: "noConnection", color: "red" };
  if (s.paused) return { state: "paused", label: "paused", color: "yellow" };
  return { state: "running", label: "running", color: "green" };
}

function updateStatus() {
  const info = statusInfo();
  if (tray) {
    tray.setToolTip(`Keypulse — ${info.label}`);
    const iconPath = path.join(__dirname, "assets", `tray-${info.color}.png`);
    if (fs.existsSync(iconPath)) {
      tray.setImage(nativeImage.createFromPath(iconPath));
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status", info);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
    title: `Key Pulse v${APP_VERSION}`,
    icon: path.join(__dirname, "assets", "logo.jpg"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  const menu = Menu.buildFromTemplate([
    { label: "Keypulse", enabled: false },
    { type: "separator" },
    { label: "Open window", click: () => mainWindow.show() },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => mainWindow.show());
}

// ---- IPC ----
ipcMain.handle("get-state", () => ({
  config,
  valid: configIsValid(),
  status: statusInfo(),
}));

ipcMain.handle("save-config", (_e, newConfig) => {
  config = { ...DEFAULTS, ...newConfig };
  saveConfigFile();
  return { ok: true };
});

ipcMain.handle("restart-engine", async () => {
  await stopEngine();
  await startEngine();
  return { ok: true };
});

ipcMain.handle("open-donate", () => {
  shell.openExternal("https://keypulse.xyz/donate.html");
  return { ok: true };
});

function waitFor(channel) {
  return new Promise((resolve) => ipcMain.once(channel, (_e, value) => resolve(value)));
}

ipcMain.handle("auth:start", async (_e, phone) => {
  try {
    const { TelegramClient } = require("telegram");
    const { StringSession } = require("telegram/sessions");
    const { saveSessionFile } = requireEngine();

    const apiId = parseInt(config.TG_API_ID, 10);
    const apiHash = config.TG_API_HASH;
    const sessionFile = path.join(userDataDir, "data", "session.bin");

    authClient = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
    await authClient.start({
      phoneNumber: async () => String(phone).trim(),
      password: async () => {
        if (mainWindow) mainWindow.webContents.send("auth:prompt", "password");
        return String(await waitFor("auth:password"));
      },
      phoneCode: async () => {
        if (mainWindow) mainWindow.webContents.send("auth:prompt", "code");
        return String(await waitFor("auth:code"));
      },
      onError: (err) => console.error("auth error:", err && err.message ? err.message : err),
    });
    const session = authClient.session.save();
    saveSessionFile(sessionFile, session);
    await authClient.disconnect();
    authClient = null;
    return { ok: true };
  } catch (e) {
    authClient = null;
    return { ok: false, error: e && e.message ? e.message : String(e) };
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
  // Keep running in the tray on Windows.
});

