import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  compare,
  daysInMonth,
  diffDays,
  isSameMonth,
  isValidDay,
  monthGrid,
  startOfMonth,
  startOfWeek,
  weekday,
} from "@/lib/dates";

describe("dates", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-11-04", 1)).toBe("2026-11-05");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-04", 0)).toBe("2026-11-04");
  });

  it("counts days between two days", () => {
    expect(diffDays("2026-11-04", "2026-11-04")).toBe(0);
    expect(diffDays("2026-11-04", "2026-11-11")).toBe(7);
    expect(diffDays("2026-12-25", "2027-01-05")).toBe(11);
    expect(diffDays("2028-02-28", "2028-03-01")).toBe(2);
    expect(diffDays("2026-11-11", "2026-11-04")).toBe(-7);
  });

  it("knows the weekday (0 = Sunday)", () => {
    expect(weekday("2026-11-01")).toBe(0);
    expect(weekday("2026-11-04")).toBe(3);
    expect(weekday("2026-11-07")).toBe(6);
  });

  it("finds the start of the week for each week-start preference", () => {
    expect(startOfWeek("2026-11-04", "mon")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-04", "sun")).toBe("2026-11-01");
    expect(startOfWeek("2026-11-04", "sat")).toBe("2026-10-31");
    expect(startOfWeek("2026-11-02", "mon")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-01", "mon")).toBe("2026-10-26");
    expect(startOfWeek("2026-11-01", "sun")).toBe("2026-11-01");
  });

  it("builds a 6x7 month grid starting on the week start", () => {
    const grid = monthGrid("2026-11-04", "mon");
    expect(grid).toHaveLength(6);
    grid.forEach((row) => expect(row).toHaveLength(7));
    expect(grid[0][0]).toBe("2026-10-26");
    expect(grid[5][6]).toBe("2026-12-06");
    expect(monthGrid("2026-11-04", "sun")[0][0]).toBe("2026-11-01");
    // consecutive days, no gaps
    const flat = grid.flat();
    flat.forEach((d, i) => i > 0 && expect(diffDays(flat[i - 1], d)).toBe(1));
  });

  it("clamps the day when adding months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 1)).toBe("2026-12-15");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("compares, validates and measures months", () => {
    expect(compare("2026-11-04", "2026-11-05")).toBeLessThan(0);
    expect(compare("2026-11-05", "2026-11-04")).toBeGreaterThan(0);
    expect(compare("2026-11-04", "2026-11-04")).toBe(0);
    expect(isSameMonth("2026-11-01", "2026-11-30")).toBe(true);
    expect(isSameMonth("2026-11-30", "2026-12-01")).toBe(false);
    expect(startOfMonth("2026-11-17")).toBe("2026-11-01");
    expect(daysInMonth("2026-02-10")).toBe(28);
    expect(daysInMonth("2028-02-10")).toBe(29);
    expect(isValidDay("2026-02-29")).toBe(false);
    expect(isValidDay("2026-11-04")).toBe(true);
    expect(isValidDay("tomorrow")).toBe(false);
    expect(isValidDay("2026-1-4")).toBe(false);
  });
});
