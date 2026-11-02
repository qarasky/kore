import { describe, expect, it } from "vitest";
import { chipsForDay, groupByDay, groupByStartDay, occurrenceDays } from "@/lib/agenda";
import type { Occurrence } from "@/lib/types";

let n = 0;
function occ(p: Partial<Occurrence> & { start_utc: string; end_utc: string }): Occurrence {
  return {
    event_id: `e${++n}`, calendar_id: "c1", key: p.start_utc, title: `Event ${n}`, notes: "", location: "",
    start: "", end: "", tz: "UTC", all_day: false, is_recurring: false, is_override: false, reminders: [], ...p,
  };
}
const allDay = (start: string, end: string, title: string) =>
  occ({ title, all_day: true, start, end, start_utc: `${start}T00:00:00Z`, end_utc: `${end}T00:00:00Z` });

const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

describe("occurrenceDays", () => {
  it("covers every day of an all-day event (end is exclusive)", () => {
    expect(occurrenceDays(allDay("2026-11-03", "2026-11-06", "x"), "UTC")).toEqual({ first: "2026-11-03", last: "2026-11-05" });
    expect(occurrenceDays(allDay("2026-11-03", "2026-11-04", "x"), "UTC")).toEqual({ first: "2026-11-03", last: "2026-11-03" });
  });

  it("uses the person's zone for timed events", () => {
    const e = occ({ start_utc: "2026-11-04T22:00:00Z", end_utc: "2026-11-04T23:00:00Z" });
    expect(occurrenceDays(e, "Asia/Tokyo")).toEqual({ first: "2026-11-05", last: "2026-11-05" });
    expect(occurrenceDays(e, "America/New_York")).toEqual({ first: "2026-11-04", last: "2026-11-04" });
  });

  it("does not spill an event ending exactly at midnight onto the next day", () => {
    const e = occ({ start_utc: "2026-11-04T22:00:00Z", end_utc: "2026-11-04T23:00:00Z" }); // Berlin 23:00-00:00
    expect(occurrenceDays(e, "Europe/Berlin")).toEqual({ first: "2026-11-04", last: "2026-11-04" });
  });
});

describe("groupByDay", () => {
  it("lists a multi-day event on every day it covers", () => {
    const g = groupByDay([allDay("2026-11-03", "2026-11-06", "Trip")], week, "UTC");
    expect(g.map((d) => d.items.length)).toEqual([0, 1, 1, 1, 0]);
  });

  it("puts an event that crosses midnight on both days", () => {
    const late = occ({ title: "Late", start_utc: "2026-11-04T22:00:00Z", end_utc: "2026-11-04T23:30:00Z" }); // Berlin 23:00-00:30
    const g = groupByDay([late], week, "Europe/Berlin");
    expect(g.find((d) => d.day === "2026-11-04")!.items).toHaveLength(1);
    expect(g.find((d) => d.day === "2026-11-05")!.items).toHaveLength(1);
  });

  it("orders all-day events first, then by start time, then by title", () => {
    const g = groupByDay(
      [
        occ({ title: "Lunch", start_utc: "2026-11-04T12:00:00Z", end_utc: "2026-11-04T13:00:00Z" }),
        occ({ title: "B early", start_utc: "2026-11-04T08:00:00Z", end_utc: "2026-11-04T09:00:00Z" }),
        occ({ title: "A early", start_utc: "2026-11-04T08:00:00Z", end_utc: "2026-11-04T09:00:00Z" }),
        allDay("2026-11-04", "2026-11-05", "Holiday"),
      ],
      week,
      "UTC",
    );
    expect(g[2].items.map((o) => o.title)).toEqual(["Holiday", "A early", "B early", "Lunch"]);
  });

  it("returns every requested day, empty ones included", () => {
    expect(groupByDay([], week, "UTC")).toHaveLength(5);
  });
});

describe("chipsForDay", () => {
  it("shows up to max and counts the rest", () => {
    const items = Array.from({ length: 5 }, (_, i) => allDay("2026-11-04", "2026-11-05", `e${i}`));
    expect(chipsForDay(items, 3)).toEqual({ shown: items.slice(0, 3), more: 2 });
    expect(chipsForDay(items.slice(0, 2), 3)).toEqual({ shown: items.slice(0, 2), more: 0 });
    expect(chipsForDay([], 3)).toEqual({ shown: [], more: 0 });
  });
});

describe("groupByStartDay", () => {
  it("groups search results by the day they start, oldest first", () => {
    const g = groupByStartDay(
      [
        occ({ title: "Later", start_utc: "2026-11-09T10:00:00Z", end_utc: "2026-11-09T11:00:00Z" }),
        occ({ title: "Sooner", start_utc: "2026-11-04T10:00:00Z", end_utc: "2026-11-04T11:00:00Z" }),
        occ({ title: "Same day", start_utc: "2026-11-04T15:00:00Z", end_utc: "2026-11-04T16:00:00Z" }),
        allDay("2026-11-04", "2026-11-05", "All day"),
      ],
      "UTC",
    );
    expect(g.map((d) => [d.day, d.items.map((o) => o.title)])).toEqual([
      ["2026-11-04", ["All day", "Sooner", "Same day"]],
      ["2026-11-09", ["Later"]],
    ]);
  });
});
