import type { Logger } from "./logger";
import { errMsg } from "./misc";

interface ZonedParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

function zonedParts(instant: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute"), ss: get("second") };
}

/** Convert a wall-clock time (in a given IANA timezone) to a UTC epoch millis. */
function zonedToUtc(p: ZonedParts, timeZone: string): number {
  let guess = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  for (let i = 0; i < 3; i++) {
    const zp = zonedParts(guess, timeZone);
    const wall = Date.UTC(zp.y, zp.m - 1, zp.d, zp.hh, zp.mm, zp.ss);
    const diff = wall - guess;
    const targetWall = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    const next = targetWall - diff;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Compute the next instant (as a Date) at which `time` (HH:MM) occurs in `timeZone`. */
export function nextRunAt(time: string, timeZone: string, now: Date = new Date()): Date {
  const [hh, mm] = time.split(":").map((x) => parseInt(x, 10));
  const nowParts = zonedParts(now.getTime(), timeZone);
  let target = zonedToUtc({ y: nowParts.y, m: nowParts.m, d: nowParts.d, hh, mm, ss: 0 }, timeZone);
  if (target <= now.getTime()) {
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const t = zonedParts(tomorrow.getTime(), timeZone);
    target = zonedToUtc({ y: t.y, m: t.m, d: t.d, hh, mm, ss: 0 }, timeZone);
  }
  return new Date(target);
}

export interface SchedulerHandle {
  stop(): void;
}

/** Run `fn` every day at `time` (HH:MM) in `timeZone`. */
export function scheduleDaily(
  time: string,
  timeZone: string,
  fn: () => Promise<void>,
  logger: Logger
): SchedulerHandle {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const run = async () => {
    if (stopped) return;
    try {
      await fn();
    } catch (error) {
      logger.error(`Scheduled task failed: ${errMsg(error)}`);
    }
    if (stopped) return;
    const next = nextRunAt(time, timeZone);
    const delay = Math.max(1000, next.getTime() - Date.now());
    timer = setTimeout(() => void run(), delay);
  };

  const first = nextRunAt(time, timeZone);
  timer = setTimeout(() => void run(), Math.max(1000, first.getTime() - Date.now()));

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
