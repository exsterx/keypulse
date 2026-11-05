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
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (locale[key]) el.setAttribute("placeholder", locale[key]);
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
  $("TARGET_CHAT_ID").value = c.TARGET_CHAT_ID || "";
  $("RELAY_URL").value = c.RELAY_URL || "";
  $("RELAY_API_KEY").value = c.RELAY_API_KEY || "";

  renderStatus(state.status);
}

function collectConfig() {
  return {
    TG_API_ID: $("TG_API_ID").value.trim(),
    TG_API_HASH: $("TG_API_HASH").value.trim(),
    TARGET_CHAT_ID: $("TARGET_CHAT_ID").value.trim(),
    RELAY_URL: $("RELAY_URL").value.trim(),
    RELAY_API_KEY: $("RELAY_API_KEY").value.trim(),
    LANGUAGE: $("lang").value,
  };
}

async function save() {
  await window.keypulse.saveConfig(collectConfig());
  await window.keypulse.restartEngine();
  $("save-result").textContent = t("saved");
  refresh();
}

let pendingPrompt = null;

$("save").onclick = save;
$("donate").onclick = () => window.keypulse.openDonate();

$("authorize").onclick = async () => {
  const phone = $("phone").value.trim();
  if (!phone) {
    $("auth-result").textContent = t("fillRequired");
    return;
  }
  const cfg = collectConfig();
  if (!cfg.TG_API_ID || !cfg.TG_API_HASH) {
    $("auth-result").textContent = t("fillApiIdHash");
    return;
  }
  const btn = $("authorize");
  btn.disabled = true;
  btn.textContent = t("sending");
  $("auth-result").textContent = "";
  await window.keypulse.saveConfig(cfg);
  let res;
  try {
    res = await window.keypulse.authorize(phone);
  } catch (e) {
    res = { ok: false, error: (e && e.message) || String(e) };
  }
  btn.disabled = false;
  btn.textContent = t("authorize");
  $("auth-result").textContent = res.ok ? t("authDone") : t("authError") + ": " + (res.error || "");
  if (res.ok) await window.keypulse.restartEngine();
};

window.keypulse.onAuthPrompt((kind) => {
  pendingPrompt = kind;
  $("auth-prompt").hidden = false;
  $("prompt-label").textContent = kind === "code" ? t("code") : t("password");
  $("prompt-value").value = "";
  $("prompt-value").focus();
  $("auth-result").textContent = t("codeSent");
});

$("prompt-submit").onclick = () => {
  const v = $("prompt-value").value;
  if (pendingPrompt === "code") window.keypulse.sendAuthCode(v);
  else window.keypulse.sendAuthPassword(v);
  $("auth-prompt").hidden = true;
};

window.keypulse.onStatus((status) => renderStatus(status));

$("lang").onchange = async () => {
  setLang($("lang").value);
  await window.keypulse.saveConfig(collectConfig());
};

refresh();
