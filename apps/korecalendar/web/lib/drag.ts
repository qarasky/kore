/** The geometry of dragging events around the grid. Pure: no DOM, no React. */
import { diffDays } from "./dates";

/** Pixels a pointer must travel before a press becomes a drag (below it, it is a click). */
export const DRAG_THRESHOLD = 4;
export const STEP = 15;
export const MIN_DURATION = 15;
const DAY = 1440;

export type Slot = { dayIndex: number; minutes: number };
export type Point = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** Rounds to the nearest `step` minutes, inside 0–1440. */
export function snapMinutes(minutes: number, step = STEP): number {
  return clamp(Math.round(minutes / step) * step, 0, DAY);
}

export function exceedsThreshold(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;
}

/**
 * The day column and (unsnapped) minutes under a point. `area` is the
 * bounding box of the day columns, full 24 hours tall (so it already moves
 * with scrolling).
 */
export function pointToSlot(p: Point, area: { left: number; top: number; width: number; height: number }, dayCount: number): Slot {
  const col = Math.floor(((p.x - area.left) / area.width) * dayCount);
  return {
    dayIndex: clamp(col, 0, dayCount - 1),
    minutes: clamp(((p.y - area.top) / area.height) * DAY, 0, DAY),
  };
}

/** The time range a drag-to-create covers: on the day it started, snapped, at least 15 minutes. */
export function rangeFromDrag(a: Slot, b: Slot): { dayIndex: number; startMinutes: number; endMinutes: number } {
  let start = snapMinutes(Math.min(a.minutes, b.minutes));
  let end = snapMinutes(Math.max(a.minutes, b.minutes));
  if (end - start < MIN_DURATION) end = start + MIN_DURATION;
  if (end > DAY) {
    end = DAY;
    start = DAY - MIN_DURATION;
  }
  return { dayIndex: a.dayIndex, startMinutes: start, endMinutes: end };
}

/** How far a drag moved an event: whole days and snapped minutes. */
export function moveDelta(from: Slot, to: Slot): { deltaDays: number; deltaMinutes: number } {
  const raw = to.minutes - from.minutes;
  return { deltaDays: to.dayIndex - from.dayIndex, deltaMinutes: Math.round(raw / STEP) * STEP };
}

/** Where an event is drawn while dragged: moved by the delta, kept inside the visible days and the day. */
export function applyDelta(
  box: { dayIndex: number; top: number; height: number },
  deltaDays: number,
  deltaMinutes: number,
  dayCount: number,
): { dayIndex: number; top: number; height: number } {
  return {
    dayIndex: clamp(box.dayIndex + deltaDays, 0, dayCount - 1),
    top: clamp(box.top + deltaMinutes, 0, DAY - box.height),
    height: box.height,
  };
}

/** The length after dragging an event's bottom edge to `pointerMinutes`. */
export function resizeDuration(startMinutes: number, pointerMinutes: number): number {
  const end = snapMinutes(pointerMinutes);
  return clamp(end - startMinutes, MIN_DURATION, DAY - startMinutes);
}

/** Days from one month-grid cell to another. */
export function monthMoveDelta(fromDay: string, toDay: string): number {
  return diffDays(fromDay, toDay);
}
