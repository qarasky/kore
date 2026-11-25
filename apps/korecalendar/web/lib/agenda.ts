/** Grouping occurrences by day for the month grid, the agenda and search. Pure. */
import { addDays, compare } from "./dates";
import { utcToLocal } from "./tz";
import type { Occurrence } from "./types";

/** First and last local day an occurrence touches (inclusive). */
export function occurrenceDays(occ: Occurrence, tz: string): { first: string; last: string } {
  if (occ.all_day) {
    const last = addDays(occ.end, -1);
    return { first: occ.start, last: compare(last, occ.start) < 0 ? occ.start : last };
  }
  const s = utcToLocal(new Date(occ.start_utc), tz);
  const e = utcToLocal(new Date(occ.end_utc), tz);
  // Ending exactly at midnight is the end of the previous day, not a sliver of the next.
  const last = e.minutes === 0 && compare(e.day, s.day) > 0 ? addDays(e.day, -1) : e.day;
  return { first: s.day, last: compare(last, s.day) < 0 ? s.day : last };
}

function startMinutes(occ: Occurrence, day: string, tz: string): number {
  if (occ.all_day) return -1;
  const s = utcToLocal(new Date(occ.start_utc), tz);
  return s.day === day ? s.minutes : -0.5; // continued from an earlier day: before that day's own starts
}

/** All-day first, then by start time on that day, then by title. */
function byTimeThenTitle(day: string, tz: string) {
  return (a: Occurrence, b: Occurrence) =>
    startMinutes(a, day, tz) - startMinutes(b, day, tz) || a.title.localeCompare(b.title) || (a.event_id + a.key).localeCompare(b.event_id + b.key);
}

export type DayGroup = { day: string; items: Occurrence[] };

/** One group per requested day (empty days included); an occurrence appears on
 *  every day it covers. */
export function groupByDay(occs: Occurrence[], days: string[], tz: string): DayGroup[] {
  const groups = new Map<string, Occurrence[]>(days.map((d) => [d, []]));
  for (const occ of occs) {
    const { first, last } = occurrenceDays(occ, tz);
    const from = compare(first, days[0]) < 0 ? days[0] : first;
    const to = compare(last, days[days.length - 1]) > 0 ? days[days.length - 1] : last;
    for (let d = from; compare(d, to) <= 0; d = addDays(d, 1)) groups.get(d)?.push(occ);
  }
  return days.map((day) => ({ day, items: groups.get(day)!.sort(byTimeThenTitle(day, tz)) }));
}

/** Up to `max` chips for a month cell and how many were left out. */
export function chipsForDay<T>(items: T[], max: number): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** Groups by the day each occurrence starts, oldest day first (search results). */
export function groupByStartDay(occs: Occurrence[], tz: string): DayGroup[] {
  const groups = new Map<string, Occurrence[]>();
  for (const occ of occs) {
    const { first } = occurrenceDays(occ, tz);
    (groups.get(first) ?? groups.set(first, []).get(first)!).push(occ);
  }
  return [...groups.keys()].sort(compare).map((day) => ({ day, items: groups.get(day)!.sort(byTimeThenTitle(day, tz)) }));
}
