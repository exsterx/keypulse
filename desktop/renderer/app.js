const $ = (id) => document.getElementById(id);

let locale = {};
let currentLang = "ru";

function t(key) {
  return locale[key] || key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (locale[key]) el.textContent = locale[key];
  });
}

function setLang(lang) {
  currentLang = lang;
  locale = window.keypulse.getLocale(lang);
  applyI18n();
}

function renderStatus(status) {
  const dot = $("status-dot");
  dot.className = "dot " + (status && status.color ? status.color : "red");
  $("status-text").textContent = t(status && status.label ? status.label : "noConnection");
}

async function refresh() {
  const state = await window.keypulse.getState();
  const c = state.config || {};
  currentLang = c.LANGUAGE || "ru";
  setLang(currentLang);
  $("lang").value = currentLang;

  $("TG_API_ID").value = c.TG_API_ID || "";
  $("TG_API_HASH").value = c.TG_API_HASH || "";
  $("BOT_TOKEN").value = c.BOT_TOKEN || "";
  $("OWNER_TELEGRAM_ID").value = c.OWNER_TELEGRAM_ID || "";
  $("RELAY_URL").value = c.RELAY_URL || "";
  $("RELAY_API_KEY").value = c.RELAY_API_KEY || "";

  renderStatus(state.status);
}

async function save() {
  const cfg = {
    TG_API_ID: $("TG_API_ID").value.trim(),
    TG_API_HASH: $("TG_API_HASH").value.trim(),
    BOT_TOKEN: $("BOT_TOKEN").value.trim(),
    OWNER_TELEGRAM_ID: $("OWNER_TELEGRAM_ID").value.trim(),
    RELAY_URL: $("RELAY_URL").value.trim(),
    RELAY_API_KEY: $("RELAY_API_KEY").value.trim(),
    LANGUAGE: $("lang").value,
  };
  await window.keypulse.saveConfig(cfg);
  await window.keypulse.restartEngine();
  $("auth-result").textContent = t("saved");
  refresh();
}

let pendingPrompt = null;

$("save").onclick = save;
$("donate").onclick = () => window.keypulse.openDonate();

$("authorize").onclick = async () => {
  const phone = $("phone").value.trim();
  if (!phone) return;
  const res = await window.keypulse.authorize(phone);
  $("auth-result").textContent = res.ok ? t("authDone") : t("authError") + ": " + (res.error || "");
};

window.keypulse.onAuthPrompt((kind) => {
  pendingPrompt = kind;
  $("auth-prompt").hidden = false;
  $("prompt-label").textContent = kind === "code" ? t("code") : t("password");
  $("prompt-value").value = "";
  $("prompt-value").focus();
});

$("prompt-submit").onclick = () => {
  const v = $("prompt-value").value;
  if (pendingPrompt === "code") window.keypulse.sendAuthCode(v);
  else window.keypulse.sendAuthPassword(v);
  $("auth-prompt").hidden = true;
};

window.keypulse.onStatus((status) => renderStatus(status));

$("lang").onchange = () => {
  setLang($("lang").value);
};

refresh();
