import { describe, expect, it } from "vitest";
import { addReminder, describeReminder, reminderPresets, toMinutes } from "@/lib/reminders";

describe("describeReminder", () => {
  it("words the common offsets", () => {
    expect(describeReminder(0, false)).toBe("At time of event");
    expect(describeReminder(5, false)).toBe("5 minutes before");
    expect(describeReminder(1, false)).toBe("1 minute before");
    expect(describeReminder(60, false)).toBe("1 hour before");
    expect(describeReminder(120, false)).toBe("2 hours before");
    expect(describeReminder(90, false)).toBe("1 hour 30 minutes before");
    expect(describeReminder(1440, false)).toBe("1 day before");
    expect(describeReminder(2880, false)).toBe("2 days before");
    expect(describeReminder(10080, false)).toBe("1 week before");
    expect(describeReminder(40320, false)).toBe("4 weeks before");
  });

  it("says all-day reminders count from midnight", () => {
    expect(describeReminder(0, true)).toBe("At midnight on the day");
    expect(describeReminder(1440, true)).toBe("1 day before (at midnight)");
  });
});

describe("reminderPresets", () => {
  it("covers at-start up to a week, ascending, all valid", () => {
    const m = reminderPresets.map((p) => p.minutes);
    expect(m).toEqual([...m].sort((a, b) => a - b));
    expect(m[0]).toBe(0);
    expect(m.every((x) => x >= 0 && x <= 40320)).toBe(true);
  });
});

describe("toMinutes and addReminder", () => {
  it("converts a custom amount", () => {
    expect(toMinutes(30, "minutes")).toBe(30);
    expect(toMinutes(2, "hours")).toBe(120);
    expect(toMinutes(3, "days")).toBe(4320);
    expect(toMinutes(2, "weeks")).toBe(20160);
    expect(toMinutes(5, "weeks")).toBeNull(); // over the API's 28-day limit
    expect(toMinutes(-1, "minutes")).toBeNull();
    expect(toMinutes(1.5, "hours")).toBe(90);
    expect(toMinutes(0.5, "minutes")).toBeNull(); // not a whole number of minutes
  });

  it("adds without duplicates, keeping the longest lead first, up to 20", () => {
    expect(addReminder([30], 10)).toEqual([30, 10]);
    expect(addReminder([30, 10], 60)).toEqual([60, 30, 10]);
    expect(addReminder([30], 30)).toEqual([30]);
    const full = Array.from({ length: 20 }, (_, i) => i * 5);
    expect(addReminder(full, 1)).toEqual(full);
  });
});
