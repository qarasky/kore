import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD,
  applyDelta,
  exceedsThreshold,
  moveDelta,
  monthMoveDelta,
  pointToSlot,
  rangeFromDrag,
  resizeDuration,
  snapMinutes,
} from "@/lib/drag";

describe("snapMinutes", () => {
  it("rounds to the nearest 15 minutes", () => {
    expect(snapMinutes(37)).toBe(30);
    expect(snapMinutes(38)).toBe(45);
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
  });

  it("stays inside the day", () => {
    expect(snapMinutes(-20)).toBe(0);
    expect(snapMinutes(1500)).toBe(1440);
    expect(snapMinutes(1439)).toBe(1440);
  });

  it("takes another step", () => {
    expect(snapMinutes(40, 30)).toBe(30);
    expect(snapMinutes(50, 30)).toBe(60);
  });
});

describe("exceedsThreshold", () => {
  it("separates a click from a drag", () => {
    expect(DRAG_THRESHOLD).toBe(4);
    expect(exceedsThreshold({ x: 10, y: 10 }, { x: 12, y: 13 })).toBe(false);
    expect(exceedsThreshold({ x: 10, y: 10 }, { x: 10, y: 14 })).toBe(true);
    expect(exceedsThreshold({ x: 10, y: 10 }, { x: 6, y: 10 })).toBe(true);
  });
});

describe("pointToSlot", () => {
  // seven 100px columns from x=50, a 2400px tall day starting at y=100 (100px per hour)
  const area = { left: 50, top: 100, width: 700, height: 2400 };

  it("maps a point to a day column and the minutes after midnight", () => {
    expect(pointToSlot({ x: 60, y: 100 }, area, 7)).toEqual({ dayIndex: 0, minutes: 0 });
    expect(pointToSlot({ x: 360, y: 100 + 1050 }, area, 7)).toEqual({ dayIndex: 3, minutes: 630 });
    expect(pointToSlot({ x: 749, y: 100 + 2399 }, area, 7)).toMatchObject({ dayIndex: 6 });
  });

  it("clamps points outside the grid", () => {
    expect(pointToSlot({ x: 0, y: 0 }, area, 7)).toEqual({ dayIndex: 0, minutes: 0 });
    expect(pointToSlot({ x: 5000, y: 9000 }, area, 7)).toEqual({ dayIndex: 6, minutes: 1440 });
  });
});

describe("rangeFromDrag", () => {
  it("snaps a downward drag", () => {
    expect(rangeFromDrag({ dayIndex: 2, minutes: 541 }, { dayIndex: 2, minutes: 667 })).toEqual({ dayIndex: 2, startMinutes: 540, endMinutes: 660 });
  });

  it("swaps the ends of an upward drag", () => {
    expect(rangeFromDrag({ dayIndex: 2, minutes: 667 }, { dayIndex: 2, minutes: 541 })).toEqual({ dayIndex: 2, startMinutes: 540, endMinutes: 660 });
  });

  it("keeps the range on the day it started, whatever column the pointer is over", () => {
    expect(rangeFromDrag({ dayIndex: 1, minutes: 600 }, { dayIndex: 4, minutes: 700 })).toMatchObject({ dayIndex: 1 });
  });

  it("is never shorter than 15 minutes and never leaves the day", () => {
    expect(rangeFromDrag({ dayIndex: 0, minutes: 600 }, { dayIndex: 0, minutes: 603 })).toEqual({ dayIndex: 0, startMinutes: 600, endMinutes: 615 });
    expect(rangeFromDrag({ dayIndex: 0, minutes: 1435 }, { dayIndex: 0, minutes: 1439 })).toEqual({ dayIndex: 0, startMinutes: 1425, endMinutes: 1440 });
  });
});

describe("moveDelta", () => {
  it("is the snapped distance between two slots", () => {
    expect(moveDelta({ dayIndex: 1, minutes: 600 }, { dayIndex: 3, minutes: 667 })).toEqual({ deltaDays: 2, deltaMinutes: 60 });
    expect(moveDelta({ dayIndex: 3, minutes: 600 }, { dayIndex: 1, minutes: 590 })).toEqual({ deltaDays: -2, deltaMinutes: -15 });
    expect(moveDelta({ dayIndex: 1, minutes: 600 }, { dayIndex: 1, minutes: 604 })).toEqual({ deltaDays: 0, deltaMinutes: 0 });
  });
});

describe("applyDelta", () => {
  it("shows an event where a drag would put it, inside the grid", () => {
    expect(applyDelta({ dayIndex: 2, top: 600, height: 60 }, 1, 30, 7)).toEqual({ dayIndex: 3, top: 630, height: 60 });
    expect(applyDelta({ dayIndex: 0, top: 600, height: 60 }, -3, 0, 7).dayIndex).toBe(0);
    expect(applyDelta({ dayIndex: 6, top: 600, height: 60 }, 5, 0, 7).dayIndex).toBe(6);
    expect(applyDelta({ dayIndex: 0, top: 30, height: 60 }, 0, -120, 7).top).toBe(0);
    expect(applyDelta({ dayIndex: 0, top: 1380, height: 60 }, 0, 120, 7).top).toBe(1380);
  });
});

describe("resizeDuration", () => {
  it("is the new end minus the start, snapped", () => {
    expect(resizeDuration(600, 667)).toBe(60);
    expect(resizeDuration(600, 690)).toBe(90);
  });

  it("never goes below 15 minutes or past the end of the day", () => {
    expect(resizeDuration(600, 590)).toBe(15);
    expect(resizeDuration(600, 600)).toBe(15);
    expect(resizeDuration(1380, 1500)).toBe(60);
  });
});

describe("monthMoveDelta", () => {
  it("counts days between two cells", () => {
    expect(monthMoveDelta("2026-11-04", "2026-11-11")).toBe(7);
    expect(monthMoveDelta("2026-11-30", "2026-12-01")).toBe(1);
    expect(monthMoveDelta("2026-11-04", "2026-11-02")).toBe(-2);
  });
});
