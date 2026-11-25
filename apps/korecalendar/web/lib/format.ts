/** Display formatting for times, dates and ranges. English only. */
import { addDays, parseDay, startOfWeek, weekday } from "./dates";
import { utcToLocal } from "./tz";
import type { Clock, View, WeekStart } from "./types";

const names = new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short" });
const months = new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "long" });
const monthsShort = new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short" });

/** 0 = Sunday. */
export function weekdayShort(i: number): string {
  return names.format(new Date(Date.UTC(2026, 10, 1 + i))); // 2026-11-01 is a Sunday
}

const namesLong = new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "long" });

/** 0 = Sunday: "Wednesday". */
export function weekdayLong(i: number): string {
  return namesLong.format(new Date(Date.UTC(2026, 10, 1 + i)));
}

/** 0 = January. */
export function monthName(i: number): string {
  return months.format(new Date(Date.UTC(2026, i, 1)));
}

/** 0 = January: "Nov". */
export function monthShortName(i: number): string {
  return monthsShort.format(new Date(Date.UTC(2026, i, 1)));
}

function monthShort(month: number): string {
  return monthsShort.format(new Date(Date.UTC(2026, month - 1, 1)));
}

function parts12(minutes: number): { h: number; m: number; period: string } {
  const h24 = Math.floor(minutes / 60) % 24;
  return { h: h24 % 12 === 0 ? 12 : h24 % 12, m: minutes % 60, period: h24 < 12 ? "AM" : "PM" };
}

const two = (n: number) => String(n).padStart(2, "0");

export function formatTime(minutes: number, clock: Clock): string {
  if (clock === "24h") return `${two(Math.floor(minutes / 60) % 24)}:${two(minutes % 60)}`;
  const { h, m, period } = parts12(minutes);
  return `${h}:${two(m)} ${period}`;
}

/** The label on an hour line of the grid. */
export function hourLabel(hour: number, clock: Clock): string {
  if (clock === "24h") return `${two(hour)}:00`;
  const { h, period } = parts12(hour * 60);
  return `${h} ${period}`;
}

/** "Wed, 4 Nov" (and the year when it is not the current one's concern: callers add it). */
export function formatDayShort(day: string): string {
  const { month, day: d } = parseDay(day);
  return `${weekdayShort(weekday(day))}, ${d} ${monthShort(month)}`;
}

/** "4 Nov 2026". */
export function formatFullDate(day: string): string {
  return dmy(day, true);
}

function dmy(day: string, withYear: boolean): string {
  const { year, month, day: d } = parseDay(day);
  return `${d} ${monthShort(month)}${withYear ? ` ${year}` : ""}`;
}

/** The period shown in the top bar. */
export function formatDayTitle(day: string, view: View, weekStart: WeekStart, compact = false): string {
  const { year, month } = parseDay(day);
  switch (view) {
    case "month":
      return `${monthName(month - 1)} ${year}`;
    case "day":
      return `${formatDayShort(day)} ${year}`;
    case "week": {
      // A phone shows three days around the selected one, so its title does too.
      if (compact) return formatSpan(addDays(day, -1), addDays(day, 1));
      const first = startOfWeek(day, weekStart);
      return formatSpan(first, addDays(first, 6));
    }
    case "agenda":
      return formatSpan(day, addDays(day, 29));
  }
}

function formatSpan(a: string, b: string): string {
  const pa = parseDay(a);
  const pb = parseDay(b);
  if (pa.year !== pb.year) return `${dmy(a, true)} – ${dmy(b, true)}`;
  if (pa.month !== pb.month) return `${dmy(a, false)} – ${dmy(b, true)}`;
  return `${pa.day}–${dmy(b, true)}`;
}

/** An event's time range in `tz`: "Wed, 4 Nov · 16:00–17:00" or across days. */
export function formatRange(startUTC: string, endUTC: string, tz: string, clock: Clock): string {
  const s = utcToLocal(new Date(startUTC), tz);
  const e = utcToLocal(new Date(endUTC), tz);
  if (s.day !== e.day) {
    return `${formatDayShort(s.day)} ${formatTime(s.minutes, clock)} – ${formatDayShort(e.day)} ${formatTime(e.minutes, clock)}`;
  }
  if (clock === "12h" && parts12(s.minutes).period === parts12(e.minutes).period) {
    const a = parts12(s.minutes);
    const b = parts12(e.minutes);
    return `${formatDayShort(s.day)} · ${a.h}:${two(a.m)}–${b.h}:${two(b.m)} ${b.period}`;
  }
  return `${formatDayShort(s.day)} · ${formatTime(s.minutes, clock)}–${formatTime(e.minutes, clock)}`;
}
