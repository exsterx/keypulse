import type Database from "better-sqlite3";

export class SettingsRepository {
  private readonly getStmt: Database.Statement;
  private readonly setStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.getStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
    this.setStmt = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
  }

  get(key: string): string | undefined {
    const row = this.getStmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string | number | boolean): void {
    this.setStmt.run(key, String(value));
  }

  getNumber(key: string, fallback?: number): number | undefined {
    const value = this.get(key);
    if (value === undefined) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  getBoolean(key: string, fallback = false): boolean {
    const value = this.get(key);
    if (value === undefined) return fallback;
    return value === "1" || value === "true";
  }

  delete(key: string): void {
    this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  }
}
