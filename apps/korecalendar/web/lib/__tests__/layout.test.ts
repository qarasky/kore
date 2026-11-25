import { describe, expect, it } from "vitest";
import { placeAllDay, placeTimed } from "@/lib/layout";
import type { Occurrence } from "@/lib/types";

let n = 0;
/** A timed occurrence given by UTC instants (what the API sends). */
function occ(startUTC: string, endUTC: string, extra: Partial<Occurrence> = {}): Occurrence {
  return {
    event_id: `e${++n}`, calendar_id: "c1", key: startUTC, title: `Event ${n}`, notes: "", location: "",
    start: "", end: "", tz: "UTC", all_day: false, is_recurring: false, is_override: false,
    start_utc: startUTC, end_utc: endUTC, reminders: [], ...extra,
  };
}
const at = (h: number, m = 0) => `2026-11-04T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const day = ["2026-11-04"];
const by = (placed: ReturnType<typeof placeTimed>, id: string) => placed.find((p) => p.occ.event_id === id)!;

describe("placeTimed: position", () => {
  it("places an event by its start and length in the user's zone", () => {
    const e = occ(at(15), at(16)); // 16:00-17:00 in Berlin (CET)
    const [p] = placeTimed([e], day, "Europe/Berlin");
    expect(p).toMatchObject({ day: "2026-11-04", top: 960, height: 60, col: 0, cols: 1, span: 1, continuesBefore: false, continuesAfter: false });
  });

  it("gives a 5-minute event a 15-minute height", () => {
    const [p] = placeTimed([occ(at(9), at(9, 5))], day, "UTC");
    expect(p.height).toBe(15);
  });

  it("keeps a minimum-height event inside the day", () => {
    const [p] = placeTimed([occ(at(23, 58), at(23, 59))], day, "UTC");
    expect(p.top + p.height).toBe(1440);
  });

  it("ignores all-day events and days that are not shown", () => {
    const allDay = occ(at(0), at(0), { all_day: true, start: "2026-11-04", end: "2026-11-05" });
    const elsewhere = occ("2026-11-09T10:00:00Z", "2026-11-09T11:00:00Z");
    expect(placeTimed([allDay, elsewhere], day, "UTC")).toEqual([]);
  });
});

describe("placeTimed: midnight and zones", () => {
  it("splits an event that crosses local midnight into one segment per day", () => {
    const days = ["2026-11-04", "2026-11-05"];
    // 23:00 Berlin to 01:00 Berlin
    const late = occ("2026-11-04T22:00:00Z", "2026-11-05T00:00:00Z", { event_id: "late" });
    const placed = placeTimed([late], days, "Europe/Berlin");
    expect(placed).toHaveLength(2);
    expect(placed[0]).toMatchObject({ day: "2026-11-04", top: 1380, height: 60, continuesBefore: false, continuesAfter: true });
    expect(placed[1]).toMatchObject({ day: "2026-11-05", top: 0, height: 60, continuesBefore: true, continuesAfter: false });
  });

  it("treats an end exactly at midnight as the end of that day, not a sliver of the next", () => {
    const e = occ("2026-11-04T22:00:00Z", "2026-11-04T23:00:00Z"); // Berlin 23:00 - 00:00
    const placed = placeTimed([e], ["2026-11-04", "2026-11-05"], "Europe/Berlin");
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ day: "2026-11-04", top: 1380, height: 60, continuesAfter: false });
  });

  it("puts the same instant on different days for people in different zones", () => {
    const e = occ("2026-11-04T22:00:00Z", "2026-11-04T23:00:00Z");
    const days = ["2026-11-04", "2026-11-05"];
    expect(placeTimed([e], days, "Asia/Tokyo")[0]).toMatchObject({ day: "2026-11-05", top: 420 }); // 07:00 JST
    expect(placeTimed([e], days, "America/New_York")[0]).toMatchObject({ day: "2026-11-04", top: 17 * 60 }); // 17:00 EST
  });

  it("clips a multi-day event to the days shown", () => {
    const e = occ("2026-11-03T10:00:00Z", "2026-11-06T10:00:00Z");
    const placed = placeTimed([e], ["2026-11-04", "2026-11-05"], "UTC");
    expect(placed.map((p) => [p.day, p.top, p.height])).toEqual([["2026-11-04", 0, 1440], ["2026-11-05", 0, 1440]]);
    expect(placed.every((p) => p.continuesBefore && p.continuesAfter)).toBe(true);
  });

  it("positions by the wall clock across a spring-forward (grid rows are wall hours)", () => {
    // 2026-03-08 New York: 01:00 EST = 06:00Z, 04:00 EDT = 08:00Z
    const e = occ("2026-03-08T06:00:00Z", "2026-03-08T08:00:00Z");
    const [p] = placeTimed([e], ["2026-03-08"], "America/New_York");
    expect(p).toMatchObject({ top: 60, height: 180 });
  });

  it("shows an event the API moved out of the nonexistent 02:30 at 03:30", () => {
    // The API maps 02:30 (does not exist) to 03:30 EDT = 07:30Z.
    const [p] = placeTimed([occ("2026-03-08T07:30:00Z", "2026-03-08T08:30:00Z")], ["2026-03-08"], "America/New_York");
    expect(p).toMatchObject({ top: 210, height: 60 });
  });

  it("keeps an event that ends inside the repeated hour visible", () => {
    // Fall back 2026-11-01 New York: 01:30 EDT = 05:30Z to 01:30 EST = 06:30Z (wall length 0)
    const [p] = placeTimed([occ("2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z")], ["2026-11-01"], "America/New_York");
    expect(p.top).toBe(90);
    expect(p.height).toBeGreaterThanOrEqual(15);
  });
});

describe("placeTimed: overlaps", () => {
  it("puts two overlapping events side by side", () => {
    const a = occ(at(9), at(10), { event_id: "a" });
    const b = occ(at(9, 30), at(10, 30), { event_id: "b" });
    const placed = placeTimed([a, b], day, "UTC");
    expect([by(placed, "a").col, by(placed, "b").col]).toEqual([0, 1]);
    expect(placed.every((p) => p.cols === 2)).toBe(true);
  });

  it("does not treat back-to-back events as overlapping", () => {
    const placed = placeTimed([occ(at(9), at(10)), occ(at(10), at(11))], day, "UTC");
    expect(placed.every((p) => p.col === 0 && p.cols === 1)).toBe(true);
  });

  it("lays out a long event beside two stacked short ones", () => {
    const a = occ(at(9), at(12), { event_id: "a" });
    const b = occ(at(9), at(10), { event_id: "b" });
    const c = occ(at(10, 30), at(11, 30), { event_id: "c" });
    const placed = placeTimed([a, b, c], day, "UTC");
    expect(by(placed, "a")).toMatchObject({ col: 0, cols: 2 });
    expect(by(placed, "b")).toMatchObject({ col: 1, cols: 2 });
    expect(by(placed, "c")).toMatchObject({ col: 1, cols: 2 });
  });

  it("lets an event widen over free columns to its right", () => {
    const a = occ(at(9), at(12), { event_id: "a" });
    const b = occ(at(9), at(10), { event_id: "b" });
    const c = occ(at(9), at(10), { event_id: "c" });
    const d = occ(at(11), at(12), { event_id: "d" });
    const placed = placeTimed([a, b, c, d], day, "UTC");
    expect(by(placed, "a")).toMatchObject({ col: 0, span: 1, cols: 3 });
    expect(by(placed, "d")).toMatchObject({ col: 1, span: 2, cols: 3 });
  });

  it("separates clusters: an unrelated later event keeps the full width", () => {
    const placed = placeTimed([occ(at(9), at(10)), occ(at(9), at(10)), occ(at(14), at(15), { event_id: "later" })], day, "UTC");
    expect(by(placed, "later")).toMatchObject({ col: 0, cols: 1 });
  });

  it("gives twelve simultaneous events twelve distinct columns", () => {
    const placed = placeTimed(Array.from({ length: 12 }, () => occ(at(9), at(10))), day, "UTC");
    expect(placed.every((p) => p.cols === 12)).toBe(true);
    expect(new Set(placed.map((p) => p.col)).size).toBe(12);
  });

  it("is stable regardless of input order", () => {
    const a = occ(at(9), at(10), { event_id: "a" });
    const b = occ(at(9), at(10), { event_id: "b" });
    const one = placeTimed([a, b], day, "UTC").map((p) => [p.occ.event_id, p.col]);
    const two = placeTimed([b, a], day, "UTC").map((p) => [p.occ.event_id, p.col]);
    expect(one).toEqual(two);
  });
});

describe("placeAllDay", () => {
  const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  const allDay = (start: string, end: string, id: string) => occ(at(0), at(0), { event_id: id, all_day: true, start, end });

  it("spans a multi-day event across the days it covers", () => {
    const [p] = placeAllDay([allDay("2026-11-03", "2026-11-06", "x")], week);
    expect(p).toMatchObject({ startIdx: 1, span: 3, lane: 0, clippedBefore: false, clippedAfter: false });
  });

  it("clips at the edges of the visible days", () => {
    const [p] = placeAllDay([allDay("2026-10-30", "2026-11-04", "x")], week);
    expect(p).toMatchObject({ startIdx: 0, span: 2, clippedBefore: true, clippedAfter: false });
    const [q] = placeAllDay([allDay("2026-11-07", "2026-11-12", "y")], week);
    expect(q).toMatchObject({ startIdx: 5, span: 2, clippedAfter: true });
  });

  it("puts overlapping bars in separate lanes and reuses freed lanes", () => {
    const placed = placeAllDay(
      [allDay("2026-11-03", "2026-11-06", "a"), allDay("2026-11-04", "2026-11-05", "b"), allDay("2026-11-06", "2026-11-07", "c")],
      week,
    );
    const lane = (id: string) => placed.find((p) => p.occ.event_id === id)!.lane;
    expect([lane("a"), lane("b"), lane("c")]).toEqual([0, 1, 0]);
  });

  it("skips events outside the visible days and timed events", () => {
    expect(placeAllDay([allDay("2026-12-01", "2026-12-02", "x"), occ(at(9), at(10))], week)).toEqual([]);
  });
});
