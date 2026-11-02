import { describe, expect, it } from "vitest";
import { calendarHref, navigate, parseView, viewDays, viewRange } from "@/lib/range";

const hours = (r: { from: Date; to: Date }) => (r.to.getTime() - r.from.getTime()) / 3_600_000;

describe("viewDays", () => {
  it("lists the visible days of each view", () => {
    expect(viewDays("day", "2026-11-04", "mon")).toEqual(["2026-11-04"]);
    expect(viewDays("week", "2026-11-04", "mon")).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08",
    ]);
    expect(viewDays("week", "2026-11-04", "sun")[0]).toBe("2026-11-01");
    expect(viewDays("month", "2026-11-04", "mon")).toHaveLength(42);
    expect(viewDays("month", "2026-11-04", "mon")[0]).toBe("2026-10-26");
    const agenda = viewDays("agenda", "2026-11-04", "mon");
    expect(agenda).toHaveLength(30);
    expect(agenda[0]).toBe("2026-11-04");
    expect(agenda[29]).toBe("2026-12-03");
  });
});

describe("viewRange", () => {
  it("covers local midnight to local midnight in the user's zone", () => {
    const r = viewRange("week", "2026-11-04", "Europe/Berlin", "mon");
    expect(r.from.toISOString()).toBe("2026-11-01T23:00:00.000Z"); // Mon 2 Nov 00:00 CET
    expect(r.to.toISOString()).toBe("2026-11-08T23:00:00.000Z"); // Mon 9 Nov 00:00 CET
    expect(r.days).toHaveLength(7);
  });

  it("is an hour longer in the week DST ends", () => {
    // Sun 1 Nov 2026 clocks go back in New York: that week is 169 hours.
    expect(hours(viewRange("week", "2026-11-01", "America/New_York", "sun"))).toBe(7 * 24 + 1);
    expect(hours(viewRange("week", "2026-11-04", "America/New_York", "mon"))).toBe(7 * 24);
    // and an hour shorter when they go forward (8 Mar 2026)
    expect(hours(viewRange("week", "2026-03-08", "America/New_York", "sun"))).toBe(7 * 24 - 1);
    expect(hours(viewRange("day", "2026-03-08", "America/New_York", "mon"))).toBe(23);
  });

  it("stays within the API's 400-day limit for every view", () => {
    for (const view of ["day", "week", "month", "agenda"] as const) {
      expect(hours(viewRange(view, "2026-11-04", "UTC", "mon")) / 24).toBeLessThan(400);
    }
  });
});

describe("navigate", () => {
  it("moves by the view's natural step", () => {
    expect(navigate("week", "2026-11-04", 1)).toBe("2026-11-11");
    expect(navigate("week", "2026-11-04", -1)).toBe("2026-10-28");
    expect(navigate("day", "2026-11-04", 1)).toBe("2026-11-05");
    expect(navigate("month", "2026-11-15", 1)).toBe("2026-12-15");
    expect(navigate("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(navigate("agenda", "2026-11-04", 1)).toBe("2026-12-04");
    expect(navigate("agenda", "2026-11-04", -1)).toBe("2026-10-05");
    expect(navigate("week", "2026-11-04", 0)).toBe("2026-11-04");
  });
});

describe("calendarHref and parseView", () => {
  it("builds and validates URLs", () => {
    expect(calendarHref("week", "2026-11-04")).toBe("/calendar/week?date=2026-11-04");
    expect(parseView("month")).toBe("month");
    expect(parseView("year")).toBeNull();
    expect(parseView(undefined)).toBeNull();
  });
});
