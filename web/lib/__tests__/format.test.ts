import { describe, expect, it } from "vitest";
import { formatBytes, formatFullDate, formatModified } from "../format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [4 * 1024, "4 KB"],
    [10 * 1024 - 1, "10 KB"],
    [2.1 * 1024 * 1024, "2.1 MB"],
    [380 * 1024 * 1024, "380 MB"],
    [1024 * 1024 - 1, "1 MB"], // 1023.999 KB rounds up a unit, not "1024 KB"
    [5 * 1024 ** 3, "5 GB"],
    [1.25 * 1024 ** 4, "1.3 TB"],
  ])("%d -> %s", (n, want) => {
    expect(formatBytes(n, "en")).toBe(want);
  });

  it("treats negative and non-finite input as zero", () => {
    expect(formatBytes(-5, "en")).toBe("0 B");
    expect(formatBytes(Number.NaN, "en")).toBe("0 B");
  });
});

describe("formatModified", () => {
  const opts = { locale: "en", timeZone: "UTC" };
  const now = new Date(Date.UTC(2026, 9, 22, 15, 30)); // Oct 22 2026 15:30 UTC
  const at = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo, d, h, mi) / 1000;

  it("shows time for today", () => {
    expect(formatModified(at(2026, 9, 22, 14, 5), now, opts)).toBe("Today 14:05");
    expect(formatModified(at(2026, 9, 22, 0, 0), now, opts)).toBe("Today 00:00");
  });

  it("shows yesterday with time", () => {
    expect(formatModified(at(2026, 9, 21, 9, 12), now, opts)).toBe("Yesterday 09:12");
  });

  it("shows month and day within the year", () => {
    expect(formatModified(at(2026, 9, 3, 12), now, opts)).toBe("Oct 3");
    expect(formatModified(at(2026, 0, 1), now, opts)).toBe("Jan 1");
  });

  it("adds the year for other years", () => {
    expect(formatModified(at(2024, 9, 3), now, opts)).toBe("Oct 3, 2024");
  });

  it("uses the given time zone for day boundaries", () => {
    // 23:30 UTC on Oct 21 is already Oct 22 in UTC+3.
    const ts = at(2026, 9, 21, 23, 30);
    expect(formatModified(ts, now, opts)).toBe("Yesterday 23:30");
    expect(formatModified(ts, now, { locale: "en", timeZone: "Europe/Moscow" })).toBe("Today 02:30");
  });

  it("formats a full date for tooltips", () => {
    expect(formatFullDate(at(2026, 9, 3, 14, 5), opts)).toBe("Oct 3, 2026, 14:05");
  });
});
