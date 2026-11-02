import { describe, expect, it } from "vitest";
import { placePopover } from "@/lib/popover";

const vp = { width: 1000, height: 700 };
const size = { width: 300, height: 200 };

describe("placePopover", () => {
  it("goes to the right of the anchor when there is room", () => {
    const p = placePopover({ left: 100, top: 100, width: 80, height: 40 }, size, vp);
    expect(p).toEqual({ left: 188, top: 100, side: "right" });
  });

  it("flips to the left near the right edge", () => {
    const p = placePopover({ left: 850, top: 100, width: 100, height: 40 }, size, vp);
    expect(p).toEqual({ left: 542, top: 100, side: "left" });
  });

  it("centres over the anchor when neither side fits", () => {
    const narrow = { width: 360, height: 700 };
    const p = placePopover({ left: 100, top: 50, width: 160, height: 30 }, size, narrow);
    expect(p.side).toBe("center");
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + size.width).toBeLessThanOrEqual(narrow.width - 8);
  });

  it("shifts up so it does not run off the bottom, and never above the top margin", () => {
    expect(placePopover({ left: 100, top: 650, width: 80, height: 40 }, size, vp).top).toBe(492);
    expect(placePopover({ left: 100, top: -30, width: 80, height: 40 }, size, vp).top).toBe(8);
  });
});
