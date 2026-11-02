/**
 * Where events go on the time grid. Pure: no DOM, no clock.
 *
 * The grid is a wall-clock grid, like Google's and Proton's: 24 hour rows in
 * the person's own zone, every day the same shape. An event sits where its
 * start and end read on the wall clock (so on a DST day the gap hour is still
 * a row), and `top`/`height` are in minutes of that clock.
 */
import { addDays, compare, diffDays } from "./dates";
import { utcToLocal } from "./tz";
import type { Occurrence } from "./types";

export const MINUTES_PER_DAY = 1440;
/** The shortest an event is drawn, so a 5-minute event can still be seen and clicked. */
export const MIN_HEIGHT = 15;

export type Placed = {
  occ: Occurrence;
  day: string;
  /** Minutes after midnight (wall clock). */
  top: number;
  /** Minutes (at least {@link MIN_HEIGHT}). */
  height: number;
  /** Column among the events it overlaps, from 0. */
  col: number;
  /** How many columns that group of overlapping events has. */
  cols: number;
  /** How many columns wide it is drawn (>1 when the columns to its right are free). */
  span: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

type Segment = Omit<Placed, "col" | "cols" | "span">;

const overlaps = (a: { top: number; height: number }, b: { top: number; height: number }) =>
  a.top < b.top + b.height && b.top < a.top + a.height;

const identity = (o: Occurrence) => `${o.event_id}|${o.key}`;

/** One segment per visible day each timed occurrence touches. */
function segmentsOf(occ: Occurrence, days: string[], tz: string): Segment[] {
  const s = utcToLocal(new Date(occ.start_utc), tz);
  const e = utcToLocal(new Date(occ.end_utc), tz);
  let endDay = e.day;
  let endMin = e.minutes;
  if (endMin === 0 && compare(endDay, s.day) > 0) {
    // Ends exactly at midnight: the end of the previous day, not a sliver of the next.
    endDay = addDays(endDay, -1);
    endMin = MINUTES_PER_DAY;
  }
  const out: Segment[] = [];
  const first = compare(s.day, days[0]) < 0 ? days[0] : s.day;
  const last = compare(endDay, days[days.length - 1]) > 0 ? days[days.length - 1] : endDay;
  for (let d = first; compare(d, last) <= 0; d = addDays(d, 1)) {
    if (!days.includes(d)) continue;
    const startMin = d === s.day ? s.minutes : 0;
    const endM = d === endDay ? endMin : MINUTES_PER_DAY;
    const height = Math.max(endM - startMin, MIN_HEIGHT);
    out.push({
      occ,
      day: d,
      top: Math.min(startMin, MINUTES_PER_DAY - height),
      height,
      continuesBefore: d !== s.day,
      continuesAfter: d !== endDay,
    });
  }
  return out;
}

/** Splits a day's segments into clusters of transitively overlapping events and
 *  assigns each a column. */
function columnsFor(segs: Segment[]): Placed[] {
  const sorted = [...segs].sort(
    (a, b) => a.top - b.top || b.height - a.height || (identity(a.occ) < identity(b.occ) ? -1 : 1),
  );
  const placed: Placed[] = [];
  let cluster: Segment[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    const cols = cluster.map((seg) => {
      let c = colEnds.findIndex((end) => end <= seg.top);
      if (c === -1) c = colEnds.length;
      colEnds[c] = seg.top + seg.height;
      return c;
    });
    cluster.forEach((seg, i) => {
      let span = 1;
      for (let c = cols[i] + 1; c < colEnds.length; c++) {
        const blocked = cluster.some((other, j) => cols[j] === c && overlaps(seg, other));
        if (blocked) break;
        span++;
      }
      placed.push({ ...seg, col: cols[i], cols: colEnds.length, span });
    });
    cluster = [];
  };

  for (const seg of sorted) {
    if (seg.top >= clusterEnd) flush();
    cluster.push(seg);
    clusterEnd = cluster.length === 1 ? seg.top + seg.height : Math.max(clusterEnd, seg.top + seg.height);
  }
  flush();
  return placed;
}

/** Places the timed occurrences on the given days, in the person's zone `tz`. */
export function placeTimed(occs: Occurrence[], days: string[], tz: string): Placed[] {
  if (days.length === 0) return [];
  const byDay = new Map<string, Segment[]>();
  for (const occ of occs) {
    if (occ.all_day) continue;
    for (const seg of segmentsOf(occ, days, tz)) {
      const list = byDay.get(seg.day);
      if (list) list.push(seg);
      else byDay.set(seg.day, [seg]);
    }
  }
  return days.flatMap((d) => columnsFor(byDay.get(d) ?? []));
}

export type AllDayPlaced = {
  occ: Occurrence;
  /** Index of the first visible day it covers. */
  startIdx: number;
  span: number;
  lane: number;
  clippedBefore: boolean;
  clippedAfter: boolean;
};

/** Places the all-day occurrences as bars across the visible days, packed into lanes. */
export function placeAllDay(occs: Occurrence[], days: string[]): AllDayPlaced[] {
  if (days.length === 0) return [];
  const items: Omit<AllDayPlaced, "lane">[] = [];
  for (const occ of occs) {
    if (!occ.all_day) continue;
    const start = diffDays(days[0], occ.start);
    const end = Math.max(diffDays(days[0], occ.end), start + 1); // `end` is exclusive
    if (end <= 0 || start >= days.length) continue;
    const startIdx = Math.max(0, start);
    const endIdx = Math.min(days.length, end);
    items.push({ occ, startIdx, span: endIdx - startIdx, clippedBefore: start < 0, clippedAfter: end > days.length });
  }
  items.sort((a, b) => a.startIdx - b.startIdx || b.span - a.span || (identity(a.occ) < identity(b.occ) ? -1 : 1));
  const laneEnds: number[] = [];
  return items.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startIdx);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.startIdx + item.span;
    return { ...item, lane };
  });
}
