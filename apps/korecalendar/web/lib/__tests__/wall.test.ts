import { describe, expect, it } from "vitest";
import { diffMinutes, formatTimeInput, parseTimeInput, parseWall, shiftWall, wallString } from "@/lib/wall";

describe("wall time", () => {
  it("parses timed and all-day strings", () => {
    expect(parseWall("2026-11-04T16:30:00")).toEqual({ day: "2026-11-04", minutes: 990 });
    expect(parseWall("2026-11-04")).toEqual({ day: "2026-11-04", minutes: 0 });
  });

  it("writes the API's wall-time string", () => {
    expect(wallString("2026-11-04", 990)).toBe("2026-11-04T16:30:00");
    expect(wallString("2026-11-04", 0)).toBe("2026-11-04T00:00:00");
  });

  it("shifts across midnight, month and year ends without a time zone", () => {
    expect(shiftWall("2026-11-04T23:30:00", 60)).toEqual({ day: "2026-11-05", minutes: 30 });
    expect(shiftWall("2026-11-05T00:15:00", -30)).toEqual({ day: "2026-11-04", minutes: 1425 });
    expect(shiftWall("2026-12-31T23:00:00", 120)).toEqual({ day: "2027-01-01", minutes: 60 });
    expect(shiftWall("2026-11-04T10:00:00", 3 * 1440)).toEqual({ day: "2026-11-07", minutes: 600 });
  });

  it("measures the gap between two wall times", () => {
    expect(diffMinutes("2026-11-04T16:00:00", "2026-11-04T17:30:00")).toBe(90);
    expect(diffMinutes("2026-11-04T23:00:00", "2026-11-05T01:00:00")).toBe(120);
    expect(diffMinutes("2026-11-04T17:00:00", "2026-11-04T16:00:00")).toBe(-60);
  });

  it("converts between minutes and <input type=time> values", () => {
    expect(formatTimeInput(990)).toBe("16:30");
    expect(formatTimeInput(5)).toBe("00:05");
    expect(parseTimeInput("16:30")).toBe(990);
    expect(parseTimeInput("00:00")).toBe(0);
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("25:00")).toBeNull();
    expect(parseTimeInput("9:5")).toBeNull();
  });
});
