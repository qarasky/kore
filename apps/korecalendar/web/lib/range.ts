/** What a calendar view shows: its days, the UTC range to ask the API for,
 *  and how prev/next move. Pure. */
import { addDays, addMonths, daysFrom, monthGrid, startOfWeek } from "./dates";
import { localToUTC } from "./tz";
import { VIEWS, type View, type WeekStart } from "./types";

export type Range = { from: Date; to: Date; days: string[] };

export const AGENDA_DAYS = 30;

export function parseView(v: string | undefined | null): View | null {
  return (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : null;
}

/** The days a view shows around `day`. */
export function viewDays(view: View, day: string, weekStart: WeekStart): string[] {
  switch (view) {
    case "day":
      return [day];
    case "week":
      return daysFrom(startOfWeek(day, weekStart), 7);
    case "month":
      return monthGrid(day, weekStart).flat();
    case "agenda":
      return daysFrom(day, AGENDA_DAYS);
  }
}

/** Local midnight of the first day to local midnight after the last, in `tz`. */
export function viewRange(view: View, day: string, tz: string, weekStart: WeekStart): Range {
  const days = viewDays(view, day, weekStart);
  return { days, from: localToUTC(days[0], 0, tz), to: localToUTC(addDays(days[days.length - 1], 1), 0, tz) };
}

/** The day to show after pressing previous (-1) or next (1); 0 keeps `day`. */
export function navigate(view: View, day: string, dir: -1 | 0 | 1): string {
  switch (view) {
    case "day":
      return addDays(day, dir);
    case "week":
      return addDays(day, 7 * dir);
    case "month":
      return addMonths(day, dir);
    case "agenda":
      return addDays(day, AGENDA_DAYS * dir);
  }
}

export function calendarHref(view: View, day: string): string {
  return `/calendar/${view}?date=${day}`;
}
