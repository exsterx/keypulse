export function unixSeconds(date: Date = new Date()): number {
  return Math.floor(date.getTime() / 1000);
}

export function formatDate(unixTimestamp: number | null | undefined, timezone: string): string {
  if (!unixTimestamp) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(unixTimestamp * 1000));
  } catch {
    return new Date(unixTimestamp * 1000).toISOString();
  }
}
