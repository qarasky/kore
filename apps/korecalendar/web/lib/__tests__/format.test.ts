import { describe, expect, it } from "vitest";
import { formatFullDate, formatDayTitle, formatRange, formatTime, hourLabel, monthName, weekdayShort } from "@/lib/format";

describe("format", () => {
  it("formats times in 24h and 12h", () => {
    expect(formatTime(0, "24h")).toBe("00:00");
    expect(formatTime(16 * 60 + 5, "24h")).toBe("16:05");
    expect(formatTime(16 * 60 + 5, "12h")).toBe("4:05 PM");
    expect(formatTime(0, "12h")).toBe("12:00 AM");
    expect(formatTime(12 * 60, "12h")).toBe("12:00 PM");
    expect(hourLabel(16, "24h")).toBe("16:00");
    expect(hourLabel(16, "12h")).toBe("4 PM");
    expect(hourLabel(0, "12h")).toBe("12 AM");
  });

  it("titles each view", () => {
    expect(formatDayTitle("2026-11-04", "month", "mon")).toBe("November 2026");
    expect(formatDayTitle("2026-11-04", "day", "mon")).toBe("Wed, 4 Nov 2026");
    expect(formatDayTitle("2026-11-04", "week", "mon")).toBe("2–8 Nov 2026");
    expect(formatDayTitle("2026-11-01", "week", "mon")).toBe("26 Oct – 1 Nov 2026");
    expect(formatDayTitle("2026-12-31", "week", "mon")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(formatDayTitle("2026-11-04", "agenda", "mon")).toBe("4 Nov – 3 Dec 2026");
    expect(formatDayTitle("2026-11-04", "week", "mon", true)).toBe("3–5 Nov 2026");
    expect(formatDayTitle("2026-11-30", "week", "mon", true)).toBe("29 Nov – 1 Dec 2026");
  });

  it("formats an event's time range in a zone", () => {
    expect(formatRange("2026-11-04T15:00:00Z", "2026-11-04T16:00:00Z", "Europe/Berlin", "24h")).toBe("Wed, 4 Nov · 16:00–17:00");
    expect(formatRange("2026-11-04T22:00:00Z", "2026-11-05T09:30:00Z", "UTC", "24h")).toBe("Wed, 4 Nov 22:00 – Thu, 5 Nov 09:30");
    expect(formatRange("2026-11-04T15:00:00Z", "2026-11-04T16:00:00Z", "Europe/Berlin", "12h")).toBe("Wed, 4 Nov · 4:00–5:00 PM");
  });

  it("writes a full date", () => {
    expect(formatFullDate("2026-08-04")).toBe("4 Aug 2026");
  });

  it("names weekdays and months", () => {
    expect(weekdayShort(0)).toBe("Sun");
    expect(weekdayShort(3)).toBe("Wed");
    expect(monthName(0)).toBe("January");
    expect(monthName(10)).toBe("November");
  });
});
