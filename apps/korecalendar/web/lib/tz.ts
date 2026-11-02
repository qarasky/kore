/**
 * Conversions between wall-clock time in an IANA zone and instants, using
 * `Intl` only (no date library). The gap/overlap rules match the Go API
 * (`api/internal/recur`, `instant()`), per RFC 5545: a wall time that does not
 * exist uses the offset before the gap; one that happens twice means the first.
 */
import { addDays, formatDayParts, parseDay } from "./dates";

const MIN_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Zone offset from UTC at `instant`, in milliseconds. */
function offsetMs(tz: string, instant: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUTC - Math.floor(instant / 1000) * 1000;
}

export function isValidTZ(tz: string): boolean {
  if (!tz) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The instant at which the wall clock in `tz` reads `minutes` after midnight on `day`. */
export function localToUTC(day: string, minutes: number, tz: string): Date {
  const { year, month, day: d } = parseDay(day);
  const wall = Date.UTC(year, month - 1, d, 0, 0) + minutes * MIN_MS;
  const o1 = offsetMs(tz, wall - 86_400_000);
  const o2 = offsetMs(tz, wall + 86_400_000);
  const c1 = wall - o1;
  if (o1 === o2) return new Date(c1);
  const c2 = wall - o2;
  const ok1 = c1 + offsetMs(tz, c1) === wall;
  const ok2 = c2 + offsetMs(tz, c2) === wall;
  if (ok1 && ok2) return new Date(Math.min(c1, c2));
  if (ok2) return new Date(c2);
  return new Date(c1); // valid with the earlier offset, or in a gap (offset before the gap)
}

/** The local day and minutes-after-midnight at `instant` in `tz`. */
export function utcToLocal(instant: Date, tz: string): { day: string; minutes: number } {
  const local = new Date(instant.getTime() + offsetMs(tz, instant.getTime()));
  return {
    day: formatDayParts(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return utcToLocal(now, tz).day;
}

/** Local midnight to the next local midnight (23–25 hours on DST days). */
export function dayRange(day: string, tz: string): { from: Date; to: Date } {
  return { from: localToUTC(day, 0, tz), to: localToUTC(addDays(day, 1), 0, tz) };
}

/** "GMT", "GMT+1", "GMT+5:30" for the zone at `at`. */
export function offsetLabel(tz: string, at: Date = new Date()): string {
  const total = Math.round(offsetMs(tz, at.getTime()) / MIN_MS);
  if (total === 0) return "GMT";
  const sign = total > 0 ? "+" : "-";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}
