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
