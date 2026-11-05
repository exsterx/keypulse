import type Database from "better-sqlite3";

export type ChatType = "channel" | "supergroup" | "group";

export interface ChatRecord {
  id: number;
  title: string;
  username: string | null;
  type: ChatType;
  is_monitored: number;
  first_seen_at: number;
  last_seen_at: number;
}

export interface ChatUpsertInput {
  id: number;
  title: string;
  username: string | null;
  type: ChatType;
}

export class ChatRepository {
  private readonly upsertStmt: Database.Statement;
  private readonly setMonitoredStmt: Database.Statement;
  private readonly touchStmt: Database.Statement;
  private readonly getAllStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly countStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.upsertStmt = db.prepare(
      `INSERT INTO chats (id, title, username, type, is_monitored, first_seen_at, last_seen_at)
       VALUES (@id, @title, @username, @type, 1, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         username = excluded.username,
         type = excluded.type,
         last_seen_at = @now`
    );
    this.setMonitoredStmt = db.prepare(`UPDATE chats SET is_monitored = ? WHERE id = ?`);
    this.touchStmt = db.prepare(`UPDATE chats SET last_seen_at = ? WHERE id = ?`);
    this.getAllStmt = db.prepare(
      `SELECT id, title, username, type, is_monitored, first_seen_at, last_seen_at FROM chats ORDER BY title COLLATE NOCASE`
    );
    this.getByIdStmt = db.prepare(
      `SELECT id, title, username, type, is_monitored, first_seen_at, last_seen_at FROM chats WHERE id = ?`
    );
    this.countStmt = db.prepare(`SELECT COUNT(*) AS c FROM chats`);
  }

  upsert(chat: ChatUpsertInput): ChatRecord {
    const now = Math.floor(Date.now() / 1000);
    this.upsertStmt.run({
      id: chat.id,
      title: chat.title,
      username: chat.username,
      type: chat.type,
      now,
    });
    return this.getById(chat.id)!;
  }

  setMonitored(id: number, monitored: boolean): boolean {
    const result = this.setMonitoredStmt.run(monitored ? 1 : 0, id);
    return result.changes > 0;
  }

  touch(id: number): void {
    this.touchStmt.run(Math.floor(Date.now() / 1000), id);
  }

  getById(id: number): ChatRecord | undefined {
    return this.getByIdStmt.get(id) as ChatRecord | undefined;
  }

  getAll(): ChatRecord[] {
    return this.getAllStmt.all() as ChatRecord[];
  }

  getMonitored(): ChatRecord[] {
    return this.getAll().filter((c) => c.is_monitored === 1);
  }

  getExcluded(): ChatRecord[] {
    return this.getAll().filter((c) => c.is_monitored === 0);
  }

  count(): number {
    const row = this.countStmt.get() as { c: number };
    return row.c;
  }
}
