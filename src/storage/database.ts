import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    username TEXT,
    type TEXT NOT NULL,
    is_monitored INTEGER NOT NULL DEFAULT 1,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS processed_messages (
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    processed_at INTEGER NOT NULL,
    matched INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, message_id)
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    message_date INTEGER,
    text TEXT NOT NULL,
    matched_keywords TEXT NOT NULL,
    link TEXT,
    detected_at INTEGER NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0,
    UNIQUE (chat_id, message_id)
  )`,

  `CREATE TABLE IF NOT EXISTS keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phrase TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER,
    sent_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    target_chat TEXT,
    error TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS backfill_state (
    chat_id INTEGER PRIMARY KEY,
    last_offset_id INTEGER NOT NULL DEFAULT 0,
    scanned_count INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    last_scanned_at INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS semantic_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL UNIQUE,
    threshold REAL NOT NULL DEFAULT 0.05,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_detected_at ON messages(detected_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_notified ON messages(notified)`,
  `CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_messages(processed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_sent_at ON notifications(sent_at)`,
];

/**
 * Early builds stored one embedding vector per key and compared it to a
 * per-message vector with cosine similarity. Keys are now scored by a
 * cross-encoder, so those columns are dead weight.
 *
 * Old thresholds lived on the centred-cosine scale (0.35/0.40/0.50), the new
 * ones are reranker probabilities (0.02/0.05/0.15), so the values are remapped
 * instead of being carried over untouched.
 */
function migrateSemanticKeysToReranker(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(semantic_keys)").all() as { name: string }[];
  if (columns.length === 0 || !columns.some((c) => c.name === "embedding")) return;

  const remap = db.transaction(() => {
    db.exec(`CREATE TABLE semantic_keys_reranker (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL UNIQUE,
      threshold REAL NOT NULL DEFAULT 0.05,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.exec(`INSERT INTO semantic_keys_reranker (id, description, threshold, enabled, created_at, updated_at)
      SELECT id, description,
        CASE
          WHEN threshold >= 0.45 THEN 0.15
          WHEN threshold >= 0.37 THEN 0.05
          ELSE 0.02
        END,
        enabled, created_at, updated_at
      FROM semantic_keys`);
    db.exec("DROP TABLE semantic_keys");
    db.exec("ALTER TABLE semantic_keys_reranker RENAME TO semantic_keys");
  });
  remap();
}

export function migrateDatabase(db: Database.Database): void {
  const apply = db.transaction(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.exec(sql);
    }
  });
  apply();
  migrateSemanticKeysToReranker(db);
}

export function openDatabase(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "monitor.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrateDatabase(db);
  return db;
}
