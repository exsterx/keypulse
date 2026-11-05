import type Database from "better-sqlite3";

export class NotificationRepository {
  private readonly insertStmt: Database.Statement;
  private readonly countSinceStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(
      `INSERT INTO notifications (message_id, sent_at, status, target_chat, error)
       VALUES (?, ?, ?, ?, ?)`
    );
    this.countSinceStmt = db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE sent_at >= ?`);
  }

  log(
    messageId: number | null,
    targetChat: string,
    status: "sent" | "failed",
    error?: string
  ): void {
    this.insertStmt.run(messageId, Math.floor(Date.now() / 1000), status, targetChat, error ?? null);
  }

  countSince(sinceSeconds: number): number {
    const row = this.countSinceStmt.get(sinceSeconds) as { c: number };
    return row.c;
  }
}
