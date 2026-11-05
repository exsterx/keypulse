import fs from "node:fs";
import { KeywordMatcher, type Keyword } from "./matcher";
import { KeywordRepository, type KeywordSyncEntry } from "../storage/keywordRepository";
import type { Logger } from "../utils/logger";
import { errMsg } from "../utils/misc";

export interface ParsedEntry {
  phrase: string;
  enabled: boolean;
}

/**
 * Parses a keywords.txt / exclude_words.txt file.
 * - Blank lines are ignored.
 * - Lines starting with '#' are comments.
 * - A line prefixed with '- ' (dash + space) is kept but disabled.
 */
export function parseKeywordFile(content: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    const disabled = /^-\s+/.test(line);
    const phrase = disabled ? line.replace(/^-\s+/, "").trim() : line;
    if (!phrase) continue;
    entries.push({ phrase, enabled: !disabled });
  }
  return entries;
}

export class KeywordManager {
  private watchers: fs.StatWatcher[] = [];
  private lastKeywordHash = "";
  private lastExcludeHash = "";
  private excludes: string[] = [];

  constructor(
    private readonly keywordsFile: string,
    private readonly excludeWordsFile: string,
    private readonly repo: KeywordRepository,
    private readonly matcher: KeywordMatcher,
    private readonly logger: Logger
  ) {}

  async init(): Promise<void> {
    this.ensureFiles();
    await this.reloadKeywords(true);
    await this.reloadExcludes(true);
    this.watch();
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.keywordsFile)) {
      fs.writeFileSync(this.keywordsFile, "# Keywords (one per line)\n", "utf8");
    }
    if (!fs.existsSync(this.excludeWordsFile)) {
      fs.writeFileSync(this.excludeWordsFile, "# Exclude words (one per line)\n", "utf8");
    }
  }

  private hash(content: string): string {
    // A cheap but sufficient content hash for change detection.
    let h = 5381;
    for (let i = 0; i < content.length; i++) {
      h = ((h << 5) + h) ^ content.charCodeAt(i);
    }
    return String(h >>> 0);
  }

  private watch(): void {
    // fs.watchFile (polling) is more reliable than fs.watch on Windows.
    const kwWatcher = fs.watchFile(this.keywordsFile, { interval: 2000 }, () => {
      void this.reloadKeywords(false);
    });
    const exWatcher = fs.watchFile(this.excludeWordsFile, { interval: 2000 }, () => {
      void this.reloadExcludes(false);
    });
    this.watchers.push(kwWatcher, exWatcher);
  }

  async reloadKeywords(force: boolean): Promise<void> {
    try {
      const content = fs.readFileSync(this.keywordsFile, "utf8");
      const currentHash = this.hash(content);
      if (!force && currentHash === this.lastKeywordHash) return;
      this.lastKeywordHash = currentHash;

      const entries = parseKeywordFile(content);
      this.repo.sync(entries.map((e) => ({ phrase: e.phrase, enabled: e.enabled })));
      const keywords: Keyword[] = this.repo.list().map((k) => ({
        id: k.id,
        phrase: k.phrase,
        enabled: k.enabled === 1,
      }));
      this.matcher.setKeywords(keywords);
      this.logger.info(
        `Loaded ${keywords.length} keywords (${keywords.filter((k) => k.enabled).length} active).`
      );
    } catch (error) {
      this.logger.error(`Failed to reload keywords: ${errMsg(error)}`);
    }
  }

  async reloadExcludes(force: boolean): Promise<void> {
    try {
      const content = fs.readFileSync(this.excludeWordsFile, "utf8");
      const currentHash = this.hash(content);
      if (!force && currentHash === this.lastExcludeHash) return;
      this.lastExcludeHash = currentHash;

      const entries = parseKeywordFile(content);
      this.excludes = entries.filter((e) => e.enabled).map((e) => e.phrase);
      this.matcher.setExcludeWords(this.excludes);
      this.logger.info(`Loaded ${this.excludes.length} exclude words.`);
    } catch (error) {
      this.logger.error(`Failed to reload exclude words: ${errMsg(error)}`);
    }
  }

  list(): Keyword[] {
    return this.matcher.getKeywords();
  }

  listExcludes(): string[] {
    return [...this.excludes];
  }

  add(phrase: string): boolean {
    const clean = phrase.trim();
    if (!clean) return false;
    const entries = parseKeywordFile(this.readFile(this.keywordsFile));
    if (entries.some((e) => e.phrase.toLowerCase() === clean.toLowerCase())) return false;
    this.appendLine(this.keywordsFile, clean);
    void this.reloadKeywords(true);
    return true;
  }

  remove(phrase: string): boolean {
    const clean = phrase.trim();
    const entries = parseKeywordFile(this.readFile(this.keywordsFile));
    const before = entries.length;
    const filtered = entries.filter((e) => e.phrase.toLowerCase() !== clean.toLowerCase());
    if (filtered.length === before) return false;
    this.writeEntries(this.keywordsFile, filtered);
    void this.reloadKeywords(true);
    return true;
  }

  setEnabled(phrase: string, enabled: boolean): boolean {
    const clean = phrase.trim();
    const entries = parseKeywordFile(this.readFile(this.keywordsFile));
    let changed = false;
    const updated = entries.map((e) => {
      if (e.phrase.toLowerCase() !== clean.toLowerCase()) return e;
      if (e.enabled !== enabled) changed = true;
      return { phrase: e.phrase, enabled };
    });
    if (!changed) return false;
    this.writeEntries(this.keywordsFile, updated);
    void this.reloadKeywords(true);
    return true;
  }

  private readFile(file: string): string {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  }

  private appendLine(file: string, line: string): void {
    const content = this.readFile(file);
    const separator = content.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(file, `${content}${separator}${line}\n`, "utf8");
  }

  private writeEntries(file: string, entries: ParsedEntry[]): void {
    const lines = entries.map((e) => (e.enabled ? e.phrase : `- ${e.phrase}`));
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  }

  close(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.unref();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
  }
}

export type { KeywordSyncEntry };

