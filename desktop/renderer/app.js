const $ = (id) => document.getElementById(id);

let locale = {};
let currentLang = "en";
let lastStatusState = null;
let wasConnecting = false;

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
  void renderKeywords();
}

function renderStatus(status) {
  const dot = $("status-dot");
  dot.className = "dot " + (status && status.color ? status.color : "red");
  $("status-text").textContent = t(status && status.label ? status.label : "noConnection");
  lastStatusState = status && status.state ? status.state : null;

  const connecting = !!(status && status.state === "connecting");
  if (connecting && !wasConnecting) {
    $("log-output").textContent = "";
  }
  wasConnecting = connecting;

  const err = status && status.error ? status.error : "";
  const detailsBtn = $("status-details");
  detailsBtn.hidden = !err;
  detailsBtn.onclick = () => {
    $("status-modal-text").textContent = err;
    $("status-modal").hidden = false;
  };

  const toggle = $("status-toggle");
  const controllable = status && (status.state === "running" || status.state === "paused");
  toggle.hidden = !controllable;
  if (controllable) {
    toggle.textContent = status.state === "paused" ? t("enableMonitor") : t("disableMonitor");
  }
}

async function refresh() {
  const state = await window.keypulse.getState();
  const c = state.config || {};
  currentLang = c.LANGUAGE || "ru";
  setLang(currentLang);
  $("lang").value = currentLang;

  $("TG_API_ID").value = c.TG_API_ID || "";
  $("TG_API_HASH").value = c.TG_API_HASH || "";
  $("RELAY_URL").value = c.RELAY_URL || "";
  $("RELAY_API_KEY").value = c.RELAY_API_KEY || "";

  const authorized = !!state.authorized;
  $("auth-form").hidden = authorized;
  $("auth-authorized").hidden = !authorized;
  $("bot-start-block").hidden = !authorized;

  renderStatus(state.status);
}

function collectConfig() {
  return {
    TG_API_ID: $("TG_API_ID").value.trim(),
    TG_API_HASH: $("TG_API_HASH").value.trim(),
    RELAY_URL: $("RELAY_URL").value.trim(),
    RELAY_API_KEY: $("RELAY_API_KEY").value.trim(),
    LANGUAGE: $("lang").value,
  };
}

async function save() {
  await window.keypulse.saveConfig(collectConfig());
  const res = await window.keypulse.restartEngine();
  if (res && res.ok) {
    $("save-result").textContent = t("saved");
  } else {
    $("save-result").textContent = t("engineError") + (res && res.error ? ": " + res.error : "");
  }
  await refresh();
}

// ---- Tabs ----
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + name));
  if (name === "chats") void renderChats();
  if (name === "keywords") void renderKeywords();
}

document.querySelectorAll(".tab").forEach((b) => {
  b.addEventListener("click", () => switchTab(b.dataset.tab));
});

let pendingPrompt = null;

$("save").onclick = save;
$("donate").onclick = () => window.keypulse.openDonate();
$("status-toggle").onclick = async () => {
  const enable = lastStatusState === "paused";
  await window.keypulse.setMonitorEnabled(enable);
  await refresh();
};
$("auth-reset").onclick = async () => {
  await window.keypulse.resetAuth();
  await refresh();
};
$("bot-start").onclick = async () => {
  const res = await window.keypulse.sendBotStart();
  $("bot-start-result").textContent = res && res.ok ? t("botStartDone") : t("engineError") + (res && res.error ? ": " + res.error : "");
};
$("status-modal-close").onclick = () => { $("status-modal").hidden = true; };
$("status-modal").addEventListener("click", (e) => {
  if (e.target === $("status-modal")) $("status-modal").hidden = true;
});

$("authorize").onclick = async () => {
  const phone = $("phone").value.trim();
  if (!phone) {
    $("auth-result").textContent = t("fillRequired");
    return;
  }
  if (!/^\+?\d{7,15}$/.test(phone)) {
    $("auth-result").textContent = t("phoneInvalid");
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
  if (res.ok) {
    await window.keypulse.restartEngine();
    await refresh();
  }
};

window.keypulse.onAuthPrompt((kind) => {
  pendingPrompt = kind;
  $("auth-prompt").hidden = false;
  $("prompt-label").textContent = kind === "code" ? t("code") : t("password");
  $("prompt-value").value = "";
  $("prompt-value").focus();
  $("auth-result").textContent = t("codeSent");
});

window.keypulse.onAuthError((msg) => {
  $("auth-result").textContent = t("authError") + ": " + msg;
});

$("prompt-submit").onclick = () => {
  const v = $("prompt-value").value;
  if (pendingPrompt === "code") window.keypulse.sendAuthCode(v);
  else window.keypulse.sendAuthPassword(v);
  $("auth-prompt").hidden = true;
};

// ---- Keywords ----
function kwItem(entry, kind) {
  const li = document.createElement("li");
  li.className = "kw-item" + (entry.enabled ? "" : " kw-off");

  const span = document.createElement("span");
  span.className = "kw-phrase";
  span.textContent = entry.phrase;
  li.appendChild(span);

  if (kind === "kw") {
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "kw-toggle";
    toggleBtn.textContent = entry.enabled ? "✓" : "○";
    toggleBtn.title = entry.enabled ? t("disable") : t("enable");
    toggleBtn.addEventListener("click", async () => {
      await window.keypulse.toggleKeyword(entry.phrase, !entry.enabled);
      await renderKeywords();
    });
    li.appendChild(toggleBtn);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "kw-del";
  delBtn.textContent = "🗑";
  delBtn.title = t("delete");
  delBtn.addEventListener("click", async () => {
    if (kind === "kw") await window.keypulse.removeKeyword(entry.phrase);
    else await window.keypulse.removeExclude(entry.phrase);
    await renderKeywords();
  });
  li.appendChild(delBtn);

  return li;
}

function fillList(listEl, entries, emptyKey, kind) {
  listEl.innerHTML = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "kw-empty";
    li.textContent = t(emptyKey);
    listEl.appendChild(li);
    return;
  }
  for (const e of entries) listEl.appendChild(kwItem(e, kind));
}

async function renderKeywords() {
  try {
    const data = await window.keypulse.getKeywords();
    fillList($("kw-list"), data.keywords || [], "keywordsEmpty", "kw");
    fillList($("ex-list"), data.excludes || [], "excludesEmpty", "ex");
  } catch (_) {}
}

$("kw-add").onclick = async () => {
  const input = $("kw-input");
  const p = input.value.trim();
  if (!p) return;
  await window.keypulse.addKeyword(p);
  input.value = "";
  await renderKeywords();
};

$("ex-add").onclick = async () => {
  const input = $("ex-input");
  const p = input.value.trim();
  if (!p) return;
  await window.keypulse.addExclude(p);
  input.value = "";
  await renderKeywords();
};

$("kw-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("kw-add").click(); });
$("ex-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("ex-add").click(); });

// ---- Chats ----
function chatItem(c) {
  const li = document.createElement("li");
  li.className = "kw-item kw-off";

  const span = document.createElement("span");
  span.className = "kw-phrase";
  span.textContent = (c.title || c.username || "#" + c.id) + " · " + c.type;
  li.appendChild(span);

  const btn = document.createElement("button");
  btn.className = "kw-toggle";
  btn.textContent = t("restore");
  btn.title = t("restore");
  btn.addEventListener("click", async () => {
    await window.keypulse.setChatMonitored(c.id, true);
    await renderChats();
  });
  li.appendChild(btn);

  return li;
}

async function renderChats() {
  try {
    const data = await window.keypulse.listChats();
    const listEl = $("chat-list");
    listEl.innerHTML = "";
    const excluded = (data.chats || []).filter((c) => !c.isMonitored);
    if (!excluded.length) {
      const li = document.createElement("li");
      li.className = "kw-empty";
      li.textContent = t("chatsEmpty");
      listEl.appendChild(li);
      return;
    }
    for (const c of excluded) listEl.appendChild(chatItem(c));
  } catch (_) {}
}

window.keypulse.onStatus((status) => renderStatus(status));

function appendLog(line) {
  const out = $("log-output");
  if (!out) return;
  const lines = out.textContent ? out.textContent.split("\n") : [];
  lines.push(String(line ?? ""));
  while (lines.length > 500) lines.shift();
  out.textContent = lines.join("\n");
  out.scrollTop = out.scrollHeight;
}

window.keypulse.onLog(appendLog);

$("lang").onchange = async () => {
  setLang($("lang").value);
  await window.keypulse.saveConfig(collectConfig());
};

// Set app version from package.json (exposed via preload)
if (window.keypulse.appVersion) {
  document.title = "Key Pulse v" + window.keypulse.appVersion;
  const v = document.querySelector(".version");
  if (v) v.textContent = "v" + window.keypulse.appVersion;
}

refresh();
