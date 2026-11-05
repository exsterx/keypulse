import type Database from "better-sqlite3";

export interface KeywordRecord {
  id: number;
  phrase: string;
  enabled: number;
  created_at: number;
}

export interface KeywordSyncEntry {
  phrase: string;
  enabled: boolean;
}

export class KeywordRepository {
  private readonly listStmt: Database.Statement;
  private readonly getStmt: Database.Statement;
  private readonly addStmt: Database.Statement;
  private readonly removeStmt: Database.Statement;
  private readonly setEnabledStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.listStmt = db.prepare(`SELECT id, phrase, enabled, created_at FROM keywords ORDER BY phrase COLLATE NOCASE`);
    this.getStmt = db.prepare(`SELECT id, phrase, enabled, created_at FROM keywords WHERE phrase = ?`);
    this.addStmt = db.prepare(
      `INSERT INTO keywords (phrase, enabled, created_at) VALUES (?, ?, ?) ON CONFLICT(phrase) DO NOTHING`
    );
    this.removeStmt = db.prepare(`DELETE FROM keywords WHERE phrase = ?`);
    this.setEnabledStmt = db.prepare(`UPDATE keywords SET enabled = ? WHERE phrase = ?`);
  }

  list(): KeywordRecord[] {
    return this.listStmt.all() as KeywordRecord[];
  }

  get(phrase: string): KeywordRecord | undefined {
    return this.getStmt.get(phrase) as KeywordRecord | undefined;
  }

  add(phrase: string, enabled = true): void {
    this.addStmt.run(phrase, enabled ? 1 : 0, Math.floor(Date.now() / 1000));
  }

  remove(phrase: string): boolean {
    return this.removeStmt.run(phrase).changes > 0;
  }

  setEnabled(phrase: string, enabled: boolean): boolean {
    return this.setEnabledStmt.run(enabled ? 1 : 0, phrase).changes > 0;
  }

  /**
   * Reconcile the database with a file-based source of truth. Adds new phrases,
   * updates enable/disable flags and removes phrases that disappeared from the file.
   */
  sync(entries: KeywordSyncEntry[]): void {
    const incoming = new Map<string, boolean>();
    for (const entry of entries) {
      const phrase = entry.phrase.trim();
      if (!phrase) continue;
      incoming.set(phrase, entry.enabled);
    }

    const existing = this.list();
    const existingPhrases = new Set(existing.map((k) => k.phrase));

    const apply = this.db.transaction(() => {
      for (const [phrase, enabled] of incoming) {
        if (existingPhrases.has(phrase)) {
          const current = this.get(phrase);
          if (current && current.enabled !== (enabled ? 1 : 0)) {
            this.setEnabled(phrase, enabled);
          }
        } else {
          this.add(phrase, enabled);
        }
      }
      for (const phrase of existingPhrases) {
        if (!incoming.has(phrase)) {
          this.remove(phrase);
        }
      }
    });
    apply();
  }
}
