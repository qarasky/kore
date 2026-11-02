/**
 * Calendar-day arithmetic on `YYYY-MM-DD` strings.
 *
 * A "day" is a date with no time and no zone; everything here counts whole
 * days on the proleptic Gregorian calendar via UTC epoch days, so the machine's
 * own zone and DST never matter. Time-of-day and zones live in `tz.ts`.
 */
import type { WeekStart } from "./types";

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDay(d: string): boolean {
  const m = DAY_RE.exec(d);
  if (!m) return false;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, da));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da;
}

function toEpochDay(d: string): number {
  const m = DAY_RE.exec(d);
  if (!m) throw new RangeError(`not a day: ${JSON.stringify(d)}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

function fromEpochDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function parseDay(d: string): { year: number; month: number; day: number } {
  const m = DAY_RE.exec(d);
  if (!m) throw new RangeError(`not a day: ${JSON.stringify(d)}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function formatDayParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(d: string, n: number): string {
  return fromEpochDay(toEpochDay(d) + n);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function diffDays(a: string, b: string): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: string): number {
  return (((toEpochDay(d) + 4) % 7) + 7) % 7; // epoch day 0 (1970-01-01) was a Thursday
}

const WEEK_START_DAY: Record<WeekStart, number> = { sun: 0, mon: 1, sat: 6 };

export function startOfWeek(d: string, weekStart: WeekStart): string {
  const back = (weekday(d) - WEEK_START_DAY[weekStart] + 7) % 7;
  return addDays(d, -back);
}

export function startOfMonth(d: string): string {
  const { year, month } = parseDay(d);
  return formatDayParts(year, month, 1);
}

export function daysInMonth(d: string): number {
  const { year, month } = parseDay(d);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: string, n: number): string {
  const { year, month, day } = parseDay(d);
  const idx = year * 12 + (month - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return formatDayParts(y, m, Math.min(day, last));
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Six rows of seven days covering the month of `d`, starting on the week start. */
export function monthGrid(d: string, weekStart: WeekStart): string[][] {
  const first = startOfWeek(startOfMonth(d), weekStart);
  return Array.from({ length: 6 }, (_, row) => Array.from({ length: 7 }, (_, col) => addDays(first, row * 7 + col)));
}

/** `n` consecutive days from `start`. */
export function daysFrom(start: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}
