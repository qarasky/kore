import { describe, expect, it } from "vitest";
import { snapForClick } from "@/lib/click";

describe("snapForClick", () => {
  it("snaps down to the half hour", () => {
    expect(snapForClick(0, 1000)).toBe(0);
    expect(snapForClick(500, 1000)).toBe(720); // noon
    expect(snapForClick(510, 1000)).toBe(720); // 12:14 -> 12:00
    expect(snapForClick(530, 1000)).toBe(750); // 12:43 -> 12:30
  });
  it("stays inside the day", () => {
    expect(snapForClick(-20, 1000)).toBe(0);
    expect(snapForClick(5000, 1000)).toBe(1410);
  });
});
