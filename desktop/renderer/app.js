const $ = (id) => document.getElementById(id);

let locale = {};
let currentLang = "en";
let lastStatusState = null;
let wasConnecting = false;

const PAUSE_ICON = '<circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>';
const PLAY_ICON = '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>';

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
  const badge = $("status-badge");
  const color =
    status && status.state === "running" ? "running"
    : status && status.state === "paused" ? "paused"
    : status && status.state === "connecting" ? "connecting"
    : "error";
  badge.className = "status-badge " + color;
  badge.textContent = t(status && status.label ? status.label : "noConnection");
  lastStatusState = status && status.state ? status.state : null;

  const connecting = !!(status && status.state === "connecting");
  if (connecting && !wasConnecting) {
    $("log-output").textContent = "";
  }
  wasConnecting = connecting;

  const err = status && status.error ? status.error : "";
  badge.onclick = err
    ? () => {
        $("status-modal-text").textContent = err;
        $("status-modal").hidden = false;
      }
    : null;
  badge.style.cursor = err ? "pointer" : "default";
  badge.title = err || "";

  const toggle = $("status-toggle");
  const controllable = status && (status.state === "running" || status.state === "paused");
  toggle.hidden = !controllable;
  if (controllable) {
    const paused = status.state === "paused";
    toggle.querySelector("svg").innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
    toggle.querySelector("span").textContent = t(paused ? "enableMonitor" : "disableMonitor");
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
  $("SEMANTIC_THRESHOLD").value = c.SEMANTIC_THRESHOLD || "0.40";
  $("sem-threshold").value = c.SEMANTIC_THRESHOLD || "0.40";
  $("SEMANTIC_MIN_TEXT_LENGTH").value = c.SEMANTIC_MIN_TEXT_LENGTH || "10";

  const authorized = !!state.authorized;
  $("auth-form").hidden = authorized;
  $("auth-authorized").hidden = !authorized;
  $("bot-start-block").hidden = !authorized;

  renderStatus(state.status);
  // Load the semantic topic list right away — it comes from the DB and must
  // not wait for the user to open the tab (or for a scan to finish).
  void renderSemantic();
}

function collectConfig() {
  return {
    TG_API_ID: $("TG_API_ID").value.trim(),
    TG_API_HASH: $("TG_API_HASH").value.trim(),
    RELAY_URL: $("RELAY_URL").value.trim(),
    RELAY_API_KEY: $("RELAY_API_KEY").value.trim(),
    LANGUAGE: $("lang").value,
    SEMANTIC_THRESHOLD: $("SEMANTIC_THRESHOLD").value,
    SEMANTIC_MIN_TEXT_LENGTH: $("SEMANTIC_MIN_TEXT_LENGTH").value,
  };
}

async function save() {
  await window.keypulse.saveConfig(collectConfig());
  const res = await window.keypulse.restartEngine();
  if (res && res.ok) {
    appendLogColor(t("saved"), "log-ok");
  } else {
    appendLogColor(t("engineError") + (res && res.error ? ": " + res.error : ""), "log-error");
  }
  await refresh();
}
// ---- Tabs ----
function switchTab(name) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + name));
  if (name === "chats") void renderChats();
  if (name === "keywords") void renderKeywords();
  if (name === "semantic") void renderSemantic();
}

document.querySelectorAll(".nav-item").forEach((b) => {
  b.addEventListener("click", (e) => {
    e.preventDefault();
    switchTab(b.dataset.tab);
  });
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
  if (res && res.ok) {
    appendLogColor(t("botStartDone"), "log-ok");
  } else {
    appendLogColor(t("engineError") + (res && res.error ? ": " + res.error : ""), "log-error");
  }
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
  li.className = "item" + (entry.enabled ? "" : " off");

  const span = document.createElement("span");
  span.className = "item-phrase";
  span.textContent = entry.phrase;
  li.appendChild(span);

  if (kind === "kw") {
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "item-btn";
    toggleBtn.textContent = entry.enabled ? "✓" : "○";
    toggleBtn.title = entry.enabled ? t("disable") : t("enable");
    toggleBtn.addEventListener("click", async () => {
      await window.keypulse.toggleKeyword(entry.phrase, !entry.enabled);
      await renderKeywords();
    });
    li.appendChild(toggleBtn);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "item-btn danger";
  delBtn.textContent = "✕";
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
    li.className = "empty";
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
  li.className = "item off";

  const span = document.createElement("span");
  span.className = "item-phrase";
  span.textContent = (c.title || c.username || "#" + c.id) + " · " + c.type;
  li.appendChild(span);

  const btn = document.createElement("button");
  btn.className = "item-btn";
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
      li.className = "empty";
      li.textContent = t("chatsEmpty");
      listEl.appendChild(li);
      return;
    }
    for (const c of excluded) listEl.appendChild(chatItem(c));
  } catch (_) {}
}

// ---- Semantic keys ----
function semanticStatusLabel(status) {
  const key =
    status === "ready" ? "semanticModelReady"
    : status === "loading" ? "semanticModelLoading"
    : status === "error" ? "semanticModelError"
    : "semanticModelUnloaded";
  return t(key);
}

function semanticItem(k) {
  const li = document.createElement("li");
  li.className = "item" + (k.enabled ? "" : " off");

  const span = document.createElement("span");
  span.className = "item-phrase";
  span.textContent = "🧠 " + k.description + " · " + k.threshold;
  li.appendChild(span);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "item-btn";
  toggleBtn.textContent = k.enabled ? "✓" : "○";
  toggleBtn.title = k.enabled ? t("disable") : t("enable");
  toggleBtn.addEventListener("click", async () => {
    await window.keypulse.toggleSemanticKey(k.id, !k.enabled);
    await renderSemantic();
  });
  li.appendChild(toggleBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "item-btn danger";
  delBtn.textContent = "✕";
  delBtn.title = t("delete");
  delBtn.addEventListener("click", async () => {
    await window.keypulse.removeSemanticKey(k.id);
    await renderSemantic();
  });
  li.appendChild(delBtn);

  return li;
}

async function renderSemantic() {
  try {
    const data = await window.keypulse.listSemanticKeys();
    $("semantic-status").textContent = t("semanticStatus") + ": " + semanticStatusLabel(data.status);
    const listEl = $("sem-list");
    listEl.innerHTML = "";
    const keys = data.keys || [];
    if (!keys.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = t("semanticEmpty");
      listEl.appendChild(li);
      return;
    }
    for (const k of keys) listEl.appendChild(semanticItem(k));
  } catch (_) {}
}

$("sem-add").onclick = async () => {
  const input = $("sem-input");
  const desc = input.value.trim();
  if (!desc) return;
  const threshold = Number($("sem-threshold").value) || 0.40;
  const res = await window.keypulse.addSemanticKey(desc, threshold);
  if (res && res.ok) {
    input.value = "";
    appendLogColor(t("semanticAdded"), "log-ok");
  } else if (res && res.exists) {
    appendLogColor(t("semanticExists"), "log-error");
  } else {
    appendLogColor(t("semanticError") + (res && res.error ? ": " + res.error : ""), "log-error");
  }
  await renderSemantic();
};

$("sem-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("sem-add").click(); });

window.keypulse.onStatus((status) => {
  const prev = lastStatusState;
  renderStatus(status);
  // When the engine finishes starting (connecting → running/paused) the
  // semantic topic list becomes available; refresh it without a tab switch.
  if (
    status &&
    (status.state === "running" || status.state === "paused") &&
    prev !== status.state
  ) {
    void renderSemantic();
    void renderChats();
  }
});

function appendLogSpan(line, className) {
  const out = $("log-output");
  if (!out) return;
  const span = document.createElement("span");
  span.textContent = String(line ?? "");
  if (className) span.className = className;
  out.appendChild(span);
  while (out.children.length > 500) out.removeChild(out.firstChild);
  out.scrollTop = out.scrollHeight;
}

function appendLog(line) {
  appendLogSpan(line, null);
}

function appendLogColor(line, className) {
  appendLogSpan(line, className);
}

window.keypulse.onLog(appendLog);

$("lang").onchange = async () => {
  setLang($("lang").value);
  await window.keypulse.saveConfig(collectConfig());
  await window.keypulse.restartEngine();
  await refresh();
};

if (window.keypulse.appVersion) {
  document.title = "Key Pulse v" + window.keypulse.appVersion;
  $("app-version").textContent = window.keypulse.appVersion;
}

refresh();