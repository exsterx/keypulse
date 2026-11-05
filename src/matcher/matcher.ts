import { normalizeText } from "../utils/text";

export type SearchMode = "exact" | "substring" | "regex";

export interface Keyword {
  id: number;
  phrase: string;
  enabled: boolean;
}

export interface MatchResult {
  matched: Keyword[];
  excluded: boolean;
}

/**
 * Pure, dependency-free keyword matcher. Case-insensitive by default and
 * Unicode-aware (NFC normalization + full lowercasing, including Cyrillic).
 */
export class KeywordMatcher {
  private keywords: Keyword[] = [];
  private excludeWords: string[] = [];
  private mode: SearchMode = "substring";
  private caseInsensitive = true;
  private regexCache = new Map<string, RegExp | null>();

  setKeywords(keywords: Keyword[]): void {
    this.keywords = keywords;
    this.recompileRegexes();
  }

  setExcludeWords(words: string[]): void {
    this.excludeWords = words.map((w) => w.trim()).filter((w) => w.length > 0);
  }

  setMode(mode: SearchMode): void {
    this.mode = mode;
    this.recompileRegexes();
  }

  getMode(): SearchMode {
    return this.mode;
  }

  getKeywords(): Keyword[] {
    return this.keywords;
  }

  private recompileRegexes(): void {
    this.regexCache.clear();
    if (this.mode !== "regex") return;
    for (const keyword of this.keywords) {
      if (!keyword.enabled) continue;
      try {
        this.regexCache.set(keyword.phrase, new RegExp(keyword.phrase, this.caseInsensitive ? "i" : ""));
      } catch {
        // Invalid regex — mark as non-matching instead of crashing the app.
        this.regexCache.set(keyword.phrase, null);
      }
    }
  }

  private normalize(value: string): string {
    return this.caseInsensitive ? normalizeText(value) : value.normalize("NFC");
  }

  /** True when the text contains any enabled exclude word (case-insensitive substring). */
  isExcluded(text: string): boolean {
    if (!text || this.excludeWords.length === 0) return false;
    const normalized = this.normalize(text);
    return this.excludeWords.some((word) => {
      const w = this.normalize(word);
      return w.length > 0 && normalized.includes(w);
    });
  }

  match(text: string): MatchResult {
    const matched: Keyword[] = [];
    if (!text || this.keywords.length === 0) {
      return { matched, excluded: false };
    }

    const normalized = this.mode === "regex" ? text : this.normalize(text);

    for (const keyword of this.keywords) {
      if (!keyword.enabled) continue;
      if (this.matches(normalized, text, keyword)) {
        matched.push(keyword);
      }
    }

    return { matched, excluded: this.isExcluded(text) };
  }

  private matches(normalizedText: string, originalText: string, keyword: Keyword): boolean {
    const phrase = keyword.phrase.trim();
    if (!phrase) return false;

    switch (this.mode) {
      case "exact":
        return this.normalize(phrase) === normalizedText;
      case "regex": {
        const regex = this.regexCache.get(keyword.phrase);
        // Test against the original text (regexes may use case-sensitive constructs).
        return regex ? regex.test(originalText) : false;
      }
      case "substring":
      default:
        return normalizedText.includes(this.normalize(phrase));
    }
  }
}
