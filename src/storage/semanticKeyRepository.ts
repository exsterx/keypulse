import type Database from "better-sqlite3";

export interface SemanticKeyRecord {
  id: number;
  description: string;
  threshold: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface SemanticKeyInput {
  description: string;
  threshold: number;
}

const COLUMNS = `id, description, threshold, enabled, created_at, updated_at`;

/**
 * Semantic keys are stored as plain text: relevance is computed at match time
 * by the cross-encoder, so there is no per-key vector to keep around.
 */
export class SemanticKeyRepository {
  private readonly listStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly getByDescriptionStmt: Database.Statement;
  private readonly addStmt: Database.Statement;
  private readonly removeStmt: Database.Statement;
  private readonly setEnabledStmt: Database.Statement;
  private readonly setThresholdStmt: Database.Statement;
  private readonly updateStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.listStmt = db.prepare(`SELECT ${COLUMNS} FROM semantic_keys ORDER BY description COLLATE NOCASE`);
    this.getByIdStmt = db.prepare(`SELECT ${COLUMNS} FROM semantic_keys WHERE id = ?`);
    this.getByDescriptionStmt = db.prepare(`SELECT ${COLUMNS} FROM semantic_keys WHERE description = ?`);
    this.addStmt = db.prepare(
      `INSERT INTO semantic_keys (description, threshold, enabled, created_at, updated_at)
       VALUES (@description, @threshold, 1, @now, @now)
       ON CONFLICT(description) DO NOTHING`
    );
    this.removeStmt = db.prepare(`DELETE FROM semantic_keys WHERE id = ?`);
    this.setEnabledStmt = db.prepare(`UPDATE semantic_keys SET enabled = ?, updated_at = ? WHERE id = ?`);
    this.setThresholdStmt = db.prepare(`UPDATE semantic_keys SET threshold = ?, updated_at = ? WHERE id = ?`);
    this.updateStmt = db.prepare(
      `UPDATE semantic_keys SET description = ?, threshold = ?, updated_at = ? WHERE id = ?`
    );
  }

  list(): SemanticKeyRecord[] {
    return this.listStmt.all() as SemanticKeyRecord[];
  }

  getById(id: number): SemanticKeyRecord | undefined {
    return this.getByIdStmt.get(id) as SemanticKeyRecord | undefined;
  }

  getByDescription(description: string): SemanticKeyRecord | undefined {
    return this.getByDescriptionStmt.get(description) as SemanticKeyRecord | undefined;
  }

  /** Returns the inserted row id, or 0 when the description already exists. */
  add(input: SemanticKeyInput): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.addStmt.run({
      description: input.description,
      threshold: input.threshold,
      now,
    });
    return result.changes > 0 ? Number(result.lastInsertRowid) : 0;
  }

  remove(id: number): boolean {
    return this.removeStmt.run(id).changes > 0;
  }

  setEnabled(id: number, enabled: boolean): boolean {
    return this.setEnabledStmt.run(enabled ? 1 : 0, Math.floor(Date.now() / 1000), id).changes > 0;
  }

  setThreshold(id: number, threshold: number): boolean {
    return this.setThresholdStmt.run(threshold, Math.floor(Date.now() / 1000), id).changes > 0;
  }

  update(id: number, input: SemanticKeyInput): boolean {
    return this.updateStmt.run(
      input.description,
      input.threshold,
      Math.floor(Date.now() / 1000),
      id
    ).changes > 0;
  }
}
