import { describe, expect, it } from "vitest";
import { tintOf } from "@qarasky/kore-ui";
import { CALENDAR_COLORS, DEFAULT_CALENDAR_COLOR } from "@/lib/colors";

describe("colors", () => {
  it("defaults to the first built-in colour, Kore's accent", () => {
    expect(DEFAULT_CALENDAR_COLOR).toBe(CALENDAR_COLORS[0]);
    expect(DEFAULT_CALENDAR_COLOR).toBe("#5b8def");
  });

  it("tints from the calendar's colour, never from unvalidated text", () => {
    const t = tintOf("#7b6cf0");
    expect(t.edge).toBe("#7b6cf0");
    expect(t.background).toContain("#7b6cf0");
    const evil = tintOf("red; background:url(//x)");
    expect(evil.edge).toBe("var(--color-accent)");
    expect(evil.background).not.toContain("url");
  });
});
