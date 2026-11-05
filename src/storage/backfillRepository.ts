import type Database from "better-sqlite3";

export interface BackfillState {
  chat_id: number;
  last_offset_id: number;
  scanned_count: number;
  completed: number;
  last_scanned_at: number;
}

export class BackfillRepository {
  private readonly getStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;
  private readonly resetStmt: Database.Statement;
  private readonly resetAllStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.getStmt = db.prepare(
      `SELECT chat_id, last_offset_id, scanned_count, completed, last_scanned_at FROM backfill_state WHERE chat_id = ?`
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO backfill_state (chat_id, last_offset_id, scanned_count, completed, last_scanned_at)
       VALUES (@chatId, @lastOffsetId, @scannedCount, @completed, @lastScannedAt)
       ON CONFLICT(chat_id) DO UPDATE SET
         last_offset_id = excluded.last_offset_id,
         scanned_count = excluded.scanned_count,
         completed = excluded.completed,
         last_scanned_at = excluded.last_scanned_at`
    );
    this.resetStmt = db.prepare(
      `UPDATE backfill_state SET completed = 0, last_offset_id = 0 WHERE chat_id = ?`
    );
    this.resetAllStmt = db.prepare(`UPDATE backfill_state SET completed = 0, last_offset_id = 0`);
  }

  get(chatId: number): BackfillState | undefined {
    return this.getStmt.get(chatId) as BackfillState | undefined;
  }

  update(
    chatId: number,
    data: { lastOffsetId: number; scannedCount: number; completed: boolean }
  ): void {
    this.upsertStmt.run({
      chatId,
      lastOffsetId: data.lastOffsetId,
      scannedCount: data.scannedCount,
      completed: data.completed ? 1 : 0,
      lastScannedAt: Math.floor(Date.now() / 1000),
    });
  }

  reset(chatId: number): void {
    this.resetStmt.run(chatId);
  }

  resetAll(): void {
    this.resetAllStmt.run();
  }
}
