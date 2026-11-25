/**
 * Wall-clock arithmetic on the API's local time strings (`2026-11-04T16:30:00`,
 * or a date `2026-11-04`). Time zones play no part: events edit in their own
 * zone's clock, so adding 90 minutes is adding 90 minutes to the wall reading.
 */
import { addDays } from "./dates";

export type Wall = { day: string; minutes: number };

export function parseWall(s: string): Wall {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?$/.exec(s);
  if (!m) throw new RangeError(`not a wall time: ${JSON.stringify(s)}`);
  return { day: m[1], minutes: m[2] ? Number(m[2]) * 60 + Number(m[3]) : 0 };
}

function normalize(day: string, minutes: number): Wall {
  const dayShift = Math.floor(minutes / 1440);
  return { day: addDays(day, dayShift), minutes: minutes - dayShift * 1440 };
}

export function wallString(day: string, minutes: number): string {
  const w = normalize(day, minutes);
  return `${w.day}T${formatTimeInput(w.minutes)}:00`;
}

export function shiftWall(s: string, deltaMinutes: number): Wall {
  const w = parseWall(s);
  return normalize(w.day, w.minutes + deltaMinutes);
}

export function diffMinutes(a: string, b: string): number {
  const pa = parseWall(a);
  const pb = parseWall(b);
  const days = Math.round((Date.parse(pb.day) - Date.parse(pa.day)) / 86_400_000);
  return days * 1440 + (pb.minutes - pa.minutes);
}

/** 990 -> "16:30", for an `<input type="time">`. */
export function formatTimeInput(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "16:30" -> 990; null for anything that is not HH:MM. */
export function parseTimeInput(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
