export { cn } from "cn"

/**
 * Formats an elapsed duration as weeks/days/hours, skipping zero units:
 * 5h, 1 day 2h, 3 days, 1 week 5h, 2 weeks 3 days 4h. Under an hour it is "Xm".
 */
export function formatElapsedDuration(ms: number): string {
  const MINUTE_MS = 60_000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  const WEEK_MS = 7 * DAY_MS;

  const safeMs = Math.max(0, ms);
  if (safeMs < HOUR_MS) return `${Math.floor(safeMs / MINUTE_MS)}m`;

  const weeks = Math.floor(safeMs / WEEK_MS);
  const days = Math.floor((safeMs % WEEK_MS) / DAY_MS);
  const hours = Math.floor((safeMs % DAY_MS) / HOUR_MS);

  const parts: string[] = [];
  if (weeks) parts.push(`${weeks} ${weeks === 1 ? "week" : "weeks"}`);
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours}h`);
  return parts.join(" ");
}
