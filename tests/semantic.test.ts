import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/storage/database";
import { SemanticMatcher } from "../src/semantic/semanticMatcher";
import type { RerankPair, RerankerService } from "../src/semantic/rerankerService";
import type { SemanticKeyManager } from "../src/semantic/semanticKeyManager";
import type { SemanticKeyRecord } from "../src/storage/semanticKeyRepository";
import type { MessageRepository } from "../src/storage/messageRepository";
import type { Notifier } from "../src/notifications/notifier";
import type { Logger } from "../src/utils/logger";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

function key(id: number, description: string, threshold: number): SemanticKeyRecord {
  return { id, description, threshold, enabled: 1, created_at: 0, updated_at: 0 };
}

interface Harness {
  matcher: SemanticMatcher;
  rows: Record<string, unknown>[];
  notifications: { matchedKeywords: string[] }[];
  pairs: RerankPair[];
}

/**
 * Builds a SemanticMatcher with a stubbed reranker. Scores are derived from the
 * pair text so a wrong (message, key) alignment would show up as a wrong match.
 */
function harness(
  keys: SemanticKeyRecord[],
  score: (pair: RerankPair) => number,
  delayMs = 0,
  minTextLength?: number
): Harness {
  const rows: Record<string, unknown>[] = [];
  const notifications: { matchedKeywords: string[] }[] = [];
  const pairs: RerankPair[] = [];

  const reranker = {
    ensureLoaded: async () => true,
    scorePairs: async (input: RerankPair[]) => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      pairs.push(...input);
      return input.map(score);
    },
  } as unknown as RerankerService;
  const keyManager = { activeKeys: () => keys } as unknown as SemanticKeyManager;
  const messageRepo = {
    addMatch: (row: Record<string, unknown>) => {
      rows.push(row);
      return rows.length;
    },
  } as unknown as MessageRepository;
  const notifier = {
    enqueue: (n: { matchedKeywords: string[] }) => {
      notifications.push(n);
    },
  } as unknown as Notifier;

  return {
    matcher: new SemanticMatcher(reranker, keyManager, messageRepo, notifier, silentLogger, minTextLength),
    rows,
    notifications,
    pairs,
  };
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for the matcher");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function candidate(messageId: number, text: string) {
  return { chatId: -100, messageId, messageDate: null, text, chatTitle: "test", link: null };
}

test("reranker scores are mapped back to the key that produced them", async () => {
  const keys = [key(1, "Loopscale points", 0.05), key(2, "Finex ETF", 0.05), key(3, "Testnet airdrop", 0.15)];
  const h = harness(keys, ({ query, passage }) => {
    if (query === "Loopscale points" && passage.startsWith("msg1")) return 0.9;
    if (query === "Finex ETF" && passage.startsWith("msg2")) return 0.2;
    if (query === "Testnet airdrop" && passage.startsWith("msg2")) return 0.1;
    return 0.001;
  });

  h.matcher.enqueue(candidate(1, "msg1 points converted to tokens"));
  h.matcher.enqueue(candidate(2, "msg2 finex launched an etf"));
  h.matcher.enqueue(candidate(3, "msg3 nothing relevant here at all"));

  await waitFor(() => h.rows.length === 2);

  assert.equal(h.rows[0].messageId, 1);
  assert.deepEqual(h.rows[0].matchedKeywords, ["Loopscale points"]);
  assert.equal(h.rows[1].messageId, 2);
  assert.deepEqual(h.rows[1].matchedKeywords, ["Finex ETF"], "a score below the key threshold must not match");
  assert.equal(h.notifications.length, 2);
});

test("one message can match several keys, and short messages are skipped", async () => {
  const keys = [key(1, "Loopscale points", 0.05), key(2, "Finex ETF", 0.05)];
  const h = harness(keys, () => 0.5);

  h.matcher.enqueue(candidate(1, "коротко")); // below MIN_TEXT_LENGTH
  h.matcher.enqueue(candidate(2, "both topics in one long message"));
  await waitFor(() => h.rows.length === 1);

  assert.equal(h.rows[0].messageId, 2);
  assert.deepEqual(h.rows[0].matchedKeywords, ["Loopscale points", "Finex ETF"]);
  assert.equal(h.pairs.length, 2, "only the long message should be scored");
});

test("whenIdle resolves only after every queued message has been scored", async () => {
  const keys = [key(1, "Loopscale points", 0.05)];
  const h = harness(keys, () => 0.9, 5);

  // Idle before any work: resolves immediately.
  await h.matcher.whenIdle();
  assert.equal(h.matcher.pending(), 0);

  h.matcher.enqueue(candidate(1, "first long enough message"));
  h.matcher.enqueue(candidate(2, "second long enough message"));
  assert.ok(h.matcher.pending() > 0, "the queue reports pending work");

  await h.matcher.whenIdle();

  assert.equal(h.matcher.pending(), 0);
  assert.equal(h.matcher.getDropped(), 0);
  assert.deepEqual(
    h.rows.map((row) => row.messageId),
    [1, 2],
    "both messages are stored before whenIdle resolves"
  );
});

test("enqueue reports whether the message was queued", async () => {
  const keys = [key(1, "Loopscale points", 0.05)];
  const h = harness(keys, () => 0.9);

  assert.equal(h.matcher.enqueue(candidate(1, "коротко")), false, "short texts are not scored");
  assert.equal(h.matcher.enqueue(candidate(2, "long enough to be scored")), true);

  await h.matcher.whenIdle();
  assert.equal(h.matcher.pending(), 0);
});

test("the minimum text length is configurable", () => {
  const keys = [key(1, "Loopscale points", 0.05)];

  const lenient = harness(keys, () => 0.9, 0, 5);
  assert.equal(lenient.matcher.enqueue(candidate(1, "коротко")), true, "a lenient threshold accepts 7 chars");

  const strict = harness(keys, () => 0.9, 0, 30);
  assert.equal(strict.matcher.enqueue(candidate(2, "long enough to be scored")), false, "a strict threshold rejects 24 chars");
});

test("whenIdle honours its timeout so a stuck model pass cannot stall a scan", async () => {
  const stuckReranker = {
    ensureLoaded: async () => true,
    // Never resolves: simulates an inference call that hangs.
    scorePairs: () => new Promise<number[]>(() => {}),
  } as unknown as RerankerService;
  const matcher = new SemanticMatcher(
    stuckReranker,
    { activeKeys: () => [key(1, "Loopscale points", 0.05)] } as unknown as SemanticKeyManager,
    { addMatch: () => 1 } as unknown as MessageRepository,
    { enqueue: () => {} } as unknown as Notifier,
    silentLogger
  );

  matcher.enqueue(candidate(1, "long enough to be scored"));

  let fallback: NodeJS.Timeout | undefined;
  const gaveUpTooLate = await Promise.race([
    matcher.whenIdle(20).then(() => false),
    // Kept ref'ed so the event loop stays alive while we wait for whenIdle.
    new Promise<boolean>((resolve) => {
      fallback = setTimeout(() => resolve(true), 2000);
    }),
  ]);
  if (fallback) clearTimeout(fallback);

  assert.equal(gaveUpTooLate, false, "whenIdle must resolve once the timeout elapses");
});

test("legacy embedding columns are migrated away and thresholds remapped", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE semantic_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL UNIQUE,
    threshold REAL NOT NULL DEFAULT 0.75,
    enabled INTEGER NOT NULL DEFAULT 1,
    embedding BLOB NOT NULL,
    dims INTEGER NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const insert = db.prepare(
    `INSERT INTO semantic_keys (description, threshold, enabled, embedding, dims, model, created_at, updated_at)
     VALUES (?, ?, 1, ?, 768, 'e5-base@q8@centered-v2', 1, 1)`
  );
  insert.run("sensitive", 0.35, Buffer.alloc(8));
  insert.run("balanced", 0.4, Buffer.alloc(8));
  insert.run("strict", 0.5, Buffer.alloc(8));

  migrateDatabase(db);

  const columns = (db.prepare("PRAGMA table_info(semantic_keys)").all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(columns, ["id", "description", "threshold", "enabled", "created_at", "updated_at"]);

  const rows = db.prepare("SELECT description, threshold FROM semantic_keys ORDER BY id").all() as {
    description: string;
    threshold: number;
  }[];
  assert.deepEqual(rows, [
    { description: "sensitive", threshold: 0.02 },
    { description: "balanced", threshold: 0.05 },
    { description: "strict", threshold: 0.15 },
  ]);

  // Running the migration again is a no-op.
  migrateDatabase(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM semantic_keys").get() as { n: number }).n, 3);
  db.close();
});
