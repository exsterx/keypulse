require("dotenv").config();
const { Telegraf } = require("telegraf");
const Fastify = require("fastify");
const { WebSocketServer } = require("ws");

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_KEYS = (process.env.API_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required in .env");
  process.exit(1);
}

const fastify = Fastify();
const bot = new Telegraf(BOT_TOKEN);

// ---- WebSocket command routing ----
const clients = new Map(); // chat_id (string) -> WebSocket
const langs = new Map(); // chat_id (string) -> "en" | "ru"
const pending = new Map(); // requestId -> { resolve, timeout }
let seq = 0;

const STRINGS = {
  en: {
    start: (id) => `Connected. Your chat_id: ${id}. The monitoring app must be running.`,
    clientNotConnected: "Client is not connected. The monitoring app must be running.",
    clientOffline: "Client is not connected.",
    done: "Done",
  },
  ru: {
    start: (id) => `Подключено. Ваш chat_id: ${id}. Приложение мониторинга должно быть запущено.`,
    clientNotConnected: "Клиент не подключён. Приложение мониторинга должно быть запущено.",
    clientOffline: "Клиент не подключён.",
    done: "Готово",
  },
};

function langFor(chatId) {
  return langs.get(String(chatId)) === "ru" ? "ru" : "en";
}

function sendRequest(chatId, payload) {
  const ws = clients.get(String(chatId));
  if (!ws) return Promise.resolve(null);
  const id = String(++seq);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 15000);
    pending.set(id, { resolve, timeout });
    try {
      ws.send(JSON.stringify({ type: "req", id, ...payload }));
    } catch (e) {
      clearTimeout(timeout);
      pending.delete(id);
      resolve(null);
    }
  });
}

function splitMessage(text, max = 4096) {
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut <= 0 || cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0 || cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) out.push(rest);
  return out;
}

async function replyViaClient(ctx, chatId, payload) {
  const res = await sendRequest(chatId, payload);
  if (!res) {
    await ctx.reply(STRINGS[langFor(chatId)].clientNotConnected);
    return;
  }
  if (res.text) {
    const extra = { link_preview_options: { is_disabled: true } };
    if (res.parseMode) extra.parse_mode = res.parseMode;
    for (const chunk of splitMessage(res.text)) {
      await ctx.reply(chunk, extra);
    }
  }
}

function argAfter(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text : "";
  return text.replace(/^\/\w+(?:@\w+)?\s*/, "").trim();
}

// ---- Bot handlers ----
bot.start((ctx) => {
  const lang = argAfter(ctx) === "ru" ? "ru" : "en";
  return ctx.reply(STRINGS[lang].start(ctx.chat.id));
});

const COMMANDS = [
  "help", "status", "chats", "keywords", "add", "remove", "enable", "disable",
  "pause", "resume", "stats", "digest", "scan", "exclude", "exclude_chat", "include_chat",
];
for (const cmd of COMMANDS) {
  bot.command(cmd, async (ctx) => {
    await replyViaClient(ctx, ctx.chat.id, { kind: "command", cmd, args: argAfter(ctx) });
  });
}

bot.action(/^.+$/, async (ctx) => {
  const data = ctx.callbackQuery && ctx.callbackQuery.data ? ctx.callbackQuery.data : "";
  const chatId = ctx.callbackQuery && ctx.callbackQuery.from ? ctx.callbackQuery.from.id : 0;
  if (!chatId) return;
  const res = await sendRequest(chatId, { kind: "callback", data });
  if (!res) {
    await ctx.answerCbQuery(STRINGS[langFor(chatId)].clientOffline);
    return;
  }
  await ctx.answerCbQuery(res.callbackAnswer || STRINGS[langFor(chatId)].done);
});

// ---- HTTP API ----
function headerKey(req) {
  const value = req.headers["x-api-key"];
  return Array.isArray(value) ? value[0] : value;
}

fastify.post("/notify", async (req, reply) => {
  const key = headerKey(req);
  if (API_KEYS.length && !API_KEYS.includes(key)) {
    return reply.code(401).send({ error: "invalid api key" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const { chat_id, text, reply_markup } = body;
  if (!chat_id || !text) {
    return reply.code(400).send({ error: "chat_id and text are required" });
  }
  try {
    const extra = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    if (reply_markup) extra.reply_markup = reply_markup;
    await bot.telegram.sendMessage(chat_id, String(text), extra);
    return { ok: true };
  } catch (e) {
    return reply.code(502).send({ error: e.message });
  }
});

fastify.get("/health", async () => ({ ok: true }));

// ---- Start ----
fastify
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    console.log("relay listening on " + PORT);
    const wss = new WebSocketServer({ server: fastify.server, path: "/ws" });
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === "hello") {
          if (API_KEYS.length && !API_KEYS.includes(msg.api_key)) {
            ws.close();
            return;
          }
          clients.set(String(msg.chat_id), ws);
          langs.set(String(msg.chat_id), msg.lang === "ru" ? "ru" : "en");
          console.log("client registered", msg.chat_id);
        } else if (msg.type === "res") {
          const p = pending.get(String(msg.id));
          if (p) {
            clearTimeout(p.timeout);
            pending.delete(String(msg.id));
            p.resolve(msg);
          }
        }
      });
      ws.on("close", () => {
        for (const [k, v] of clients) {
          if (v === ws) clients.delete(k);
        }
      });
    });
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

bot.launch().catch((e) => console.error("bot launch:", e.message));

process.once("SIGINT", () => {
  bot.stop("SIGINT");
  process.exit(0);
});
process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
  process.exit(0);
});

