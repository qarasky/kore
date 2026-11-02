import { describe, expect, it } from "vitest";
import { CALENDAR_COLORS, calendarTint, isHexColor } from "@/lib/colors";

describe("colors", () => {
  it("validates #rrggbb", () => {
    expect(isHexColor("#5b8def")).toBe(true);
    expect(isHexColor("#5B8DEF")).toBe(true);
    for (const bad of ["5b8def", "#5b8de", "#5b8defx", "red", "", "#12345g", "url(x)", "#5b8def; background:red"]) {
      expect(isHexColor(bad)).toBe(false);
    }
  });

  it("tints from the calendar's colour, never from unvalidated text", () => {
    const t = calendarTint("#7b6cf0");
    expect(t.edge).toBe("#7b6cf0");
    expect(t.bg).toContain("#7b6cf0");
    const evil = calendarTint("red; background:url(//x)");
    expect(evil.edge).toBe(CALENDAR_COLORS[0]);
    expect(evil.bg).not.toContain("url");
  });
});
