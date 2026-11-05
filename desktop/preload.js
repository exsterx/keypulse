const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

function getLocale(lang) {
  try {
    const p = path.join(__dirname, "locales", (lang || "en") + ".json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return {};
  }
}

contextBridge.exposeInMainWorld("keypulse", {
  getState: () => ipcRenderer.invoke("get-state"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  restartEngine: () => ipcRenderer.invoke("restart-engine"),
  authorize: (phone) => ipcRenderer.invoke("auth:start", phone),
  sendAuthCode: (code) => ipcRenderer.send("auth:code", code),
  sendAuthPassword: (pwd) => ipcRenderer.send("auth:password", pwd),
  openDonate: () => ipcRenderer.invoke("open-donate"),
  getLocale,
  onStatus: (cb) => ipcRenderer.on("status", (_e, s) => cb(s)),
  onAuthPrompt: (cb) => ipcRenderer.on("auth:prompt", (_e, p) => cb(p)),
});

