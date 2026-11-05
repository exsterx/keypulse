const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

const appVersion = require(path.join(__dirname, "package.json")).version;

function getLocale(lang) {
  try {
    const p = path.join(__dirname, "locales", (lang || "en") + ".json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return {};
  }
}

contextBridge.exposeInMainWorld("keypulse", {
  appVersion,
  getState: () => ipcRenderer.invoke("get-state"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  restartEngine: () => ipcRenderer.invoke("restart-engine"),
  authorize: (phone) => ipcRenderer.invoke("auth:start", phone),
  sendAuthCode: (code) => ipcRenderer.send("auth:code", code),
  sendAuthPassword: (pwd) => ipcRenderer.send("auth:password", pwd),
  openDonate: () => ipcRenderer.invoke("open-donate"),
  getKeywords: () => ipcRenderer.invoke("keywords:list"),
  addKeyword: (phrase) => ipcRenderer.invoke("keywords:add", phrase),
  removeKeyword: (phrase) => ipcRenderer.invoke("keywords:remove", phrase),
  toggleKeyword: (phrase, enabled) => ipcRenderer.invoke("keywords:toggle", phrase, enabled),
  addExclude: (word) => ipcRenderer.invoke("excludes:add", word),
  removeExclude: (word) => ipcRenderer.invoke("excludes:remove", word),
  listChats: () => ipcRenderer.invoke("chats:list"),
  setChatMonitored: (id, monitored) => ipcRenderer.invoke("chats:setMonitored", id, monitored),
  setMonitorEnabled: (enabled) => ipcRenderer.invoke("monitor:setEnabled", enabled),
  resetAuth: () => ipcRenderer.invoke("auth:reset"),
  getLocale,
  onStatus: (cb) => ipcRenderer.on("status", (_e, s) => cb(s)),
  onAuthPrompt: (cb) => ipcRenderer.on("auth:prompt", (_e, p) => cb(p)),
  onAuthError: (cb) => ipcRenderer.on("auth:error", (_e, msg) => cb(msg)),
});

