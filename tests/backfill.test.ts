import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import winston from "winston";
import type { Api } from "telegram";
import { migrateDatabase } from "../src/storage/database";
import { ChatRepository } from "../src/storage/chatRepository";
import { MessageRepository } from "../src/storage/messageRepository";
import { BackfillRepository } from "../src/storage/backfillRepository";
import { KeywordMatcher, type Keyword } from "../src/matcher/matcher";
import { MessageProcessor } from "../src/monitor/messageProcessor";
import { Backfiller } from "../src/monitor/backfill";
import type { Logger } from "../src/utils/logger";
import type { Notifier, Notification } from "../src/notifications/notifier";
import type { SemanticMatcher } from "../src/semantic/semanticMatcher";
import type { SemanticKeyManager } from "../src/semantic/semanticKeyManager";
import type { RerankerService, SemanticModelStatus } from "../src/semantic/rerankerService";
import type { SemanticKeyRecord } from "../src/storage/semanticKeyRepository";
import type { TelegramAccount } from "../src/telegram/client";

const CHAT_ID = -1001234567890;
const week = 7 * 86400;
const logger = winston.createLogger({ silent: true }) as unknown as Logger;

interface SetupOptions {
  /** What the reranker reports to the backfiller. */
  modelStatus?: SemanticModelStatus;
  /** Number of active semantic keys. */
  semanticKeys?: number;
  /** Put the chat peer into the dialog cache (default true). */
  cachedEntity?: boolean;
  /** Make the on-demand peer lookup fail (default false). */
  resolveFails?: boolean;
}

/** Builds a Backfiller over an in-memory DB with a canned chat history. */
function setup(history: string[], options: SetupOptions = {}) {
  const db = new Database(":memory:");
  migrateDatabase(db);

  const chats = new ChatRepository(db);
  const messages = new MessageRepository(db);
  const backfillRepo = new BackfillRepository(db);
  const matcher = new KeywordMatcher();
  const sent: Notification[] = [];
  const semanticEnqueues: { messageId: number; text: string }[] = [];
  const idleCalls = { n: 0 };
  const modelStatus = options.modelStatus ?? "ready";
  const keyCount = options.semanticKeys ?? 1;

  chats.upsert({ id: CHAT_ID, title: "Crypto Signals", username: null, type: "channel" });

  const now = Math.floor(Date.now() / 1000);
  const apiMessages = history.map((text, index) => ({
    chatId: CHAT_ID,
    id: 100 - index, // newest first, the order Telegram returns
    date: now - index * 60,
    text,
    isChannel: true,
    chat: { title: "Crypto Signals" },
  }));

  const account = {
    getMessages: async (_entity: unknown, params: { offsetId?: number }) =>
      params.offsetId === undefined ? apiMessages : [],
    resolveInputEntity: async () =>
      options.resolveFails ? null : ({} as unknown as Api.TypeInputPeer),
    setWatchdogPaused: () => {},
  } as unknown as TelegramAccount;

  const semanticMatcher = {
    enqueue: (item: { messageId: number; text: string }) => {
      semanticEnqueues.push(item);
      return true;
    },
    whenIdle: async () => {
      idleCalls.n += 1;
    },
    pending: () => 0,
    getDropped: () => 0,
  } as unknown as SemanticMatcher;

  const processor = new MessageProcessor({
    chatRepo: chats,
    messageRepo: messages,
    matcher,
    notifier: { enqueue: (n: Notification) => void sent.push(n) } as unknown as Notifier,
    semanticMatcher,
    logger,
  });

  const reranker = {
    getStatus: () => modelStatus,
    ensureLoaded: async () => modelStatus === "ready",
  } as unknown as RerankerService;
  const semanticKeys = {
    activeKeys: () =>
      Array.from(
        { length: keyCount },
        (_, i) =>
          ({
            id: i + 1,
            description: `topic ${i + 1}`,
            threshold: 0.05,
            enabled: 1,
            created_at: 0,
            updated_at: 0,
          }) as SemanticKeyRecord
      ),
  } as unknown as SemanticKeyManager;

  const entities = new Map<number, Api.TypeInputPeer>();
  if (options.cachedEntity !== false) entities.set(CHAT_ID, {} as unknown as Api.TypeInputPeer);

  const backfiller = new Backfiller({
    account,
    chatRepo: chats,
    backfillRepo,
    messageRepo: messages,
    processor,
    entities,
    logger,
    reranker,
    semanticKeys,
    semanticMatcher,
  });

  return { messages, matcher, backfiller, sent, semanticEnqueues, idleCalls };
}

test("regular backfill never re-checks an already processed message", async () => {
  const { messages, matcher, backfiller, sent } = setup(["gm everyone", "big airdrop incoming"]);

  // First pass without keywords: both messages are scanned and marked as processed.
  await backfiller.scanAll(week, 100);
  assert.equal(messages.total(), 0);

  // A keyword is added, but the messages are already marked processed.
  matcher.setKeywords([{ id: 1, phrase: "airdrop", enabled: true } satisfies Keyword]);
  await backfiller.scanAll(week, 100);

  assert.equal(messages.total(), 0, "processed messages must not be matched again");
  assert.equal(sent.length, 0);
});

test("a forced rescan clears the markers and picks up old messages once", async () => {
  const { messages, matcher, backfiller, sent } = setup(["gm everyone", "big airdrop incoming"]);

  await backfiller.scanAll(week, 100);
  matcher.setKeywords([{ id: 1, phrase: "airdrop", enabled: true } satisfies Keyword]);

  await backfiller.scanAll(week, 100, true);
  assert.equal(messages.total(), 1, "the old message now matches and is stored");
  assert.equal(sent.length, 1, "it is notified once");

  // Repeating the forced scan is idempotent: unique(chat_id, message_id) deduplicates.
  await backfiller.scanAll(week, 100, true);
  assert.equal(messages.total(), 1);
  assert.equal(sent.length, 1);
});

test("forced rescan keeps history matching keyword-only by default", async () => {
  const { messages, backfiller, semanticEnqueues } = setup(["semantically related text"]);

  await backfiller.scanAll(week, 100, true);

  assert.equal(semanticEnqueues.length, 0, "history path must not enqueue cross-encoder work");
  assert.equal(messages.total(), 0);
});

test("a chat missing from the dialog cache is resolved on demand and still scanned", async () => {
  const { messages, matcher, backfiller } = setup(["big airdrop incoming"], {
    cachedEntity: false,
  });
  matcher.setKeywords([{ id: 1, phrase: "airdrop", enabled: true } satisfies Keyword]);

  const summary = await backfiller.scanAll(week, 100, true);

  assert.equal(summary.chatsScanned, 1, "the chat is opened through the on-demand lookup");
  assert.equal(summary.skippedChats, 0);
  assert.equal(summary.totalMessages, 1);
  assert.equal(messages.total(), 1, "history is matched instead of being skipped");
});

test("a chat whose peer cannot be resolved is reported instead of silently vanishing", async () => {
  const { backfiller } = setup(["big airdrop incoming"], {
    cachedEntity: false,
    resolveFails: true,
  });

  const summary = await backfiller.scanAll(week, 100, true);

  assert.equal(summary.chatsScanned, 0);
  assert.equal(summary.skippedChats, 1, "the caller can tell why nothing was scanned");
  assert.equal(summary.totalMessages, 0);
});

test("the scan reports progress per chat and every batch of messages", async () => {
  const history = Array.from({ length: 20 }, (_, i) => `history message number ${i} with enough text`);
  const { backfiller } = setup(history);
  const updates: { chatsDone: number; chatsTotal: number; messages: number }[] = [];

  await backfiller.scanAll(week, 100, true, {
    semantic: true,
    onProgress: (progress) => void updates.push(progress),
  });

  assert.ok(updates.length >= 2, `expected progress callbacks, got ${updates.length}`);
  const last = updates[updates.length - 1];
  assert.equal(last.chatsDone, 1);
  assert.equal(last.chatsTotal, 1);
  assert.equal(last.messages, history.length, "the final update carries the full count");
});

test("a deep rescan scores the whole history by meaning and waits for the queue", async () => {
  const history = [
    "points of the loopscale campaign were converted",
    "finex launched an etf product",
    "nothing to see here, just chatter",
  ];
  const { messages, backfiller, semanticEnqueues, idleCalls } = setup(history);

  const summary = await backfiller.scanAll(week, 100, true, { semantic: true });

  assert.equal(summary.semantic, true, "the summary reports that semantics ran");
  assert.equal(semanticEnqueues.length, history.length, "every non-matching message is scored");
  assert.equal(semanticEnqueues[0].messageId, 100, "newest message first, like Telegram returns it");
  assert.ok(idleCalls.n >= 1, "the scan must drain the semantic queue instead of overflowing it");
  assert.equal(messages.total(), 0, "scoring results are stored by the matcher, not by the backfiller");
});

test("a deep rescan drains the queue in batches instead of letting it grow", async () => {
  const history = Array.from({ length: 20 }, (_, i) => `history message number ${i} with enough text`);
  const { backfiller, semanticEnqueues, idleCalls } = setup(history);

  await backfiller.scanAll(week, 100, true, { semantic: true });

  assert.equal(semanticEnqueues.length, 20);
  assert.ok(
    idleCalls.n >= Math.ceil(20 / 8),
    `expected a drain at least every 8 messages, got ${idleCalls.n} drain(s)`
  );
});

test("a deep rescan falls back to keywords while the model is still loading", async () => {
  const { messages, matcher, backfiller, semanticEnqueues, idleCalls } = setup(
    ["big airdrop incoming"],
    { modelStatus: "loading" }
  );
  matcher.setKeywords([{ id: 1, phrase: "airdrop", enabled: true } satisfies Keyword]);

  const summary = await backfiller.scanAll(week, 100, true, { semantic: true });

  assert.equal(summary.semantic, false, "the caller can tell semantics did not run");
  assert.equal(semanticEnqueues.length, 0);
  assert.equal(idleCalls.n, 0);
  assert.equal(messages.total(), 1, "keyword matching still works");
});

test("a deep rescan falls back to keywords when no semantic keys are active", async () => {
  const { backfiller, semanticEnqueues } = setup(["points of the loopscale campaign"], { semanticKeys: 0 });

  const summary = await backfiller.scanAll(week, 100, true, { semantic: true });

  assert.equal(summary.semantic, false);
  assert.equal(semanticEnqueues.length, 0);
});
