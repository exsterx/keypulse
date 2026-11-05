import type Database from "better-sqlite3";

export interface MatchRecord {
  id: number;
  chat_id: number;
  message_id: number;
  message_date: number | null;
  text: string;
  matched_keywords: string;
  link: string | null;
  detected_at: number;
  notified: number;
  chat_title: string;
}

export interface AddMatchInput {
  chatId: number;
  messageId: number;
  messageDate: number | null;
  text: string;
  matchedKeywords: string[];
  link: string | null;
}

export class MessageRepository {
  private readonly isProcessedStmt: Database.Statement;
  private readonly markProcessedStmt: Database.Statement;
  private readonly addMatchStmt: Database.Statement;
  private readonly markNotifiedStmt: Database.Statement;
  private readonly getBetweenStmt: Database.Statement;
  private readonly totalStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.isProcessedStmt = db.prepare(
      `SELECT 1 AS found FROM processed_messages WHERE chat_id = ? AND message_id = ?`
    );
    this.markProcessedStmt = db.prepare(
      `INSERT INTO processed_messages (chat_id, message_id, processed_at, matched)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, message_id) DO NOTHING`
    );
    this.addMatchStmt = db.prepare(
      `INSERT INTO messages (chat_id, message_id, message_date, text, matched_keywords, link, detected_at, notified)
       VALUES (@chatId, @messageId, @messageDate, @text, @matchedKeywords, @link, @detectedAt, 0)
       ON CONFLICT(chat_id, message_id) DO NOTHING`
    );
    this.markNotifiedStmt = db.prepare(`UPDATE messages SET notified = 1 WHERE id = ?`);
    this.getBetweenStmt = db.prepare(
      `SELECT m.id, m.chat_id, m.message_id, m.message_date, m.text, m.matched_keywords, m.link,
              m.detected_at, m.notified, c.title AS chat_title
       FROM messages m
       LEFT JOIN chats c ON c.id = m.chat_id
       WHERE m.detected_at >= ? AND m.detected_at < ?
       ORDER BY m.detected_at ASC`
    );
    this.totalStmt = db.prepare(`SELECT COUNT(*) AS c FROM messages`);
  }

  isProcessed(chatId: number, messageId: number): boolean {
    return this.isProcessedStmt.get(chatId, messageId) !== undefined;
  }

  markProcessed(chatId: number, messageId: number, matched: boolean): void {
    this.markProcessedStmt.run(chatId, messageId, Math.floor(Date.now() / 1000), matched ? 1 : 0);
  }

  /** Returns the inserted row id, or 0 if it was a duplicate. */
  addMatch(input: AddMatchInput): number {
    const result = this.addMatchStmt.run({
      chatId: input.chatId,
      messageId: input.messageId,
      messageDate: input.messageDate,
      text: input.text,
      matchedKeywords: JSON.stringify(input.matchedKeywords),
      link: input.link,
      detectedAt: Math.floor(Date.now() / 1000),
    });
    return result.changes > 0 ? Number(result.lastInsertRowid) : 0;
  }

  markNotified(id: number): void {
    this.markNotifiedStmt.run(id);
  }

  getMatchesBetween(sinceSeconds: number, untilSeconds: number): MatchRecord[] {
    return this.getBetweenStmt.all(sinceSeconds, untilSeconds) as MatchRecord[];
  }

  total(): number {
    const row = this.totalStmt.get() as { c: number };
    return row.c;
  }
}
