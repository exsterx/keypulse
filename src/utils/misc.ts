/** Convert a GramJS value (number, bigint, big-integer object or string) to a JS number. */
export function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object") {
    const v = value as { toJSNumber?: () => number };
    if (typeof v.toJSNumber === "function") {
      try {
        return v.toJSNumber();
      } catch {
        /* fall through */
      }
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function errMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEEP_FLAG = /^(deep|--deep|deep[-_]?scan|семант[а-яё]*)$/i;
const FAST_FLAG = /^(fast|--fast|quick|kw|keywords|быстро|словами)$/i;

export interface ScanArgs {
  /** Duration argument without the flag ("7d", "24h", …); empty when omitted. */
  duration: string;
  /** `deep` asks for the semantic (cross-encoder) pass over history. */
  deep: boolean;
  /** `fast` keeps the scan keyword-only. Ignored when `deep` is also given. */
  fast: boolean;
}

/**
 * Splits `/scan` arguments into the duration and the optional flags, so both
 * the Telegram handler and the desktop command service parse it the same way:
 * `/scan 7d deep`, `/scan 7d fast`, `/scan семантика 24h`.
 */
export function parseScanArgs(raw: string): ScanArgs {
  const parts = raw.trim().split(/\s+/).filter((part) => part.length > 0);
  const deep = parts.some((part) => DEEP_FLAG.test(part));
  // A contradictory "/scan 7d deep fast" resolves in favour of the explicit
  // semantic request: silently dropping it would hide the slower path.
  const fast = !deep && parts.some((part) => FAST_FLAG.test(part));
  return {
    duration: parts.filter((part) => !DEEP_FLAG.test(part) && !FAST_FLAG.test(part)).join(" "),
    deep,
    fast,
  };
}

/** Parse durations such as "7d", "24h", "90m" or a bare number of days. Returns seconds. */
export function parseDurationSeconds(input: string | undefined, fallbackDays: number): number {
  if (!input) return fallbackDays * 86400;
  const trimmed = input.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(d|h|m|s)?$/.exec(trimmed);
  if (!match) return fallbackDays * 86400;
  const value = parseFloat(match[1]);
  const unit = match[2] ?? "d";
  switch (unit) {
    case "d":
      return Math.round(value * 86400);
    case "h":
      return Math.round(value * 3600);
    case "m":
      return Math.round(value * 60);
    case "s":
      return Math.round(value);
    default:
      return fallbackDays * 86400;
  }
}
