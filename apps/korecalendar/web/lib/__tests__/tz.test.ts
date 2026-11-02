import { describe, expect, it } from "vitest";
import { dayRange, isValidTZ, localToUTC, offsetLabel, todayIn, utcToLocal } from "@/lib/tz";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

describe("localToUTC", () => {
  it("converts an ordinary wall time", () => {
    expect(iso(localToUTC("2026-11-04", 16 * 60, "Europe/Berlin"))).toBe("2026-11-04T15:00:00Z");
    expect(iso(localToUTC("2026-07-04", 16 * 60, "Europe/Berlin"))).toBe("2026-07-04T14:00:00Z");
    expect(iso(localToUTC("2026-11-04", 0, "UTC"))).toBe("2026-11-04T00:00:00Z");
  });

  it("moves a time that does not exist (DST gap) forward, as the API does", () => {
    // 02:30 on 2026-03-08 does not exist in New York; RFC 5545 uses the offset before the gap.
    expect(iso(localToUTC("2026-03-08", 150, "America/New_York"))).toBe("2026-03-08T07:30:00Z");
  });

  it("takes the first of two identical times (DST overlap)", () => {
    expect(iso(localToUTC("2026-11-01", 90, "America/New_York"))).toBe("2026-11-01T05:30:00Z");
  });

  it("handles half-hour zones and minutes beyond a day", () => {
    expect(iso(localToUTC("2026-11-04", 0, "Asia/Kolkata"))).toBe("2026-11-03T18:30:00Z");
    expect(iso(localToUTC("2026-11-04", 1440, "UTC"))).toBe("2026-11-05T00:00:00Z");
  });
});

describe("utcToLocal", () => {
  it("returns the local day and minutes", () => {
    expect(utcToLocal(new Date("2026-11-04T15:00:00Z"), "Europe/Berlin")).toEqual({ day: "2026-11-04", minutes: 960 });
  });

  it("rolls over midnight in the zone, not in UTC", () => {
    expect(utcToLocal(new Date("2026-11-04T23:30:00Z"), "Asia/Tokyo")).toEqual({ day: "2026-11-05", minutes: 510 });
    expect(utcToLocal(new Date("2026-11-04T02:00:00Z"), "America/New_York")).toEqual({ day: "2026-11-03", minutes: 21 * 60 });
  });

  it("round-trips with localToUTC outside DST transitions", () => {
    for (const tz of ["Europe/Berlin", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"]) {
      const at = localToUTC("2026-09-20", 13 * 60 + 45, tz);
      expect(utcToLocal(at, tz)).toEqual({ day: "2026-09-20", minutes: 13 * 60 + 45 });
    }
  });
});

describe("todayIn and dayRange", () => {
  it("disagrees about today across the date line", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(todayIn("Pacific/Kiritimati", now)).toBe("2026-11-05");
    expect(todayIn("Pacific/Pago_Pago", now)).toBe("2026-11-04");
  });

  it("makes days 23 and 25 hours long on DST changes", () => {
    const hours = (day: string, tz: string) => {
      const r = dayRange(day, tz);
      return (r.to.getTime() - r.from.getTime()) / 3600000;
    };
    expect(hours("2026-03-08", "America/New_York")).toBe(23);
    expect(hours("2026-11-01", "America/New_York")).toBe(25);
    expect(hours("2026-11-04", "America/New_York")).toBe(24);
  });
});

describe("zone helpers", () => {
  it("labels offsets", () => {
    expect(offsetLabel("Europe/Berlin", new Date("2026-11-04T12:00:00Z"))).toBe("GMT+1");
    expect(offsetLabel("Asia/Kolkata", new Date("2026-11-04T12:00:00Z"))).toBe("GMT+5:30");
    expect(offsetLabel("UTC", new Date("2026-11-04T12:00:00Z"))).toBe("GMT");
    expect(offsetLabel("America/New_York", new Date("2026-07-04T12:00:00Z"))).toBe("GMT-4");
  });

  it("validates zone names", () => {
    expect(isValidTZ("Europe/Berlin")).toBe(true);
    expect(isValidTZ("Mars/Base")).toBe(false);
    expect(isValidTZ("")).toBe(false);
  });
});
