import { describe, expect, it } from "vitest";
import { buildRule, describeRule, parseRule, presets, shiftRuleByDays, type Recurrence } from "@/lib/rrule";

const WED = "2026-11-04"; // a Wednesday, the 4th: the first Wednesday
const opts = { tz: "Europe/Berlin", allDay: false };
const weekly = (byDay: number[], extra: Partial<Extract<Recurrence, { kind: "rule" }>> = {}): Recurrence => ({
  kind: "rule", freq: "WEEKLY", interval: 1, byDay, monthly: "dayOfMonth", end: { type: "never" }, ...extra,
});

describe("parseRule: the shapes the editor can express", () => {
  it("reads daily, weekly, monthly and yearly rules", () => {
    expect(parseRule("FREQ=DAILY", WED, opts)).toMatchObject({ kind: "rule", freq: "DAILY", interval: 1 });
    expect(parseRule("FREQ=DAILY;INTERVAL=3", WED, opts)).toMatchObject({ freq: "DAILY", interval: 3 });
    expect(parseRule("FREQ=WEEKLY;BYDAY=WE,FR", WED, opts)).toEqual(weekly([3, 5]));
    expect(parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", WED, opts)).toMatchObject({ freq: "WEEKLY", interval: 2, byDay: [1] });
    expect(parseRule("FREQ=MONTHLY;BYMONTHDAY=4", WED, opts)).toMatchObject({ freq: "MONTHLY", monthly: "dayOfMonth" });
    expect(parseRule("FREQ=MONTHLY;BYDAY=1WE", WED, opts)).toMatchObject({ freq: "MONTHLY", monthly: "nthWeekday" });
    expect(parseRule("FREQ=YEARLY", WED, opts)).toMatchObject({ freq: "YEARLY" });
  });

  it("treats a plain FREQ=WEEKLY as the start's weekday and FREQ=MONTHLY as the start's day", () => {
    expect(parseRule("FREQ=WEEKLY", WED, opts)).toEqual(weekly([3]));
    expect(parseRule("FREQ=MONTHLY", WED, opts)).toMatchObject({ monthly: "dayOfMonth" });
  });

  it("tolerates an RRULE: prefix", () => {
    expect(parseRule("RRULE:FREQ=WEEKLY;BYDAY=WE", WED, opts)).toEqual(weekly([3]));
  });

  it("reads COUNT and UNTIL as the end", () => {
    expect(parseRule("FREQ=DAILY;COUNT=10", WED, opts)).toMatchObject({ end: { type: "count", count: 10 } });
    expect(parseRule("FREQ=DAILY;UNTIL=20261231", WED, { tz: "UTC", allDay: true })).toMatchObject({
      end: { type: "until", date: "2026-12-31" },
    });
    // a timed series ends at the end of the local day, written in UTC
    expect(parseRule("FREQ=DAILY;UNTIL=20261231T225959Z", WED, opts)).toMatchObject({ end: { type: "until", date: "2026-12-31" } });
  });
});

describe("parseRule: shapes it cannot express stay raw (Review Focus 4)", () => {
  const raw = (s: string, start = WED) => parseRule(s, start, opts);
  it.each([
    "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
    "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
    "FREQ=WEEKLY;BYDAY=WE,FR;WKST=SU",
    "FREQ=MONTHLY;BYMONTHDAY=4,18",
    "FREQ=MONTHLY;BYMONTHDAY=5", // not the start's day
    "FREQ=MONTHLY;BYDAY=2WE", // the start is the first Wednesday, not the second
    "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
    "FREQ=WEEKLY;BYDAY=2WE",
    "FREQ=DAILY;COUNT=0",
    "FREQ=HOURLY",
    "garbage",
    "FREQ=DAILY;BYHOUR=9",
  ])("%s", (rule) => {
    expect(raw(rule)).toEqual({ kind: "raw", rrule: rule });
  });

  it("never rewrites a raw rule", () => {
    const rule = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1";
    const r = parseRule(rule, "2026-10-30", opts);
    expect(r).toEqual({ kind: "raw", rrule: rule });
    expect(buildRule(r, "2026-10-30", opts)).toBe(rule);
  });
});

describe("buildRule", () => {
  it("writes each shape the API accepts", () => {
    expect(buildRule({ kind: "none" }, WED, opts)).toBe("");
    expect(buildRule(weekly([3, 5]), WED, opts)).toBe("FREQ=WEEKLY;BYDAY=WE,FR");
    expect(buildRule(weekly([5, 3]), WED, opts)).toBe("FREQ=WEEKLY;BYDAY=WE,FR");
    expect(buildRule(weekly([0, 1]), WED, opts)).toBe("FREQ=WEEKLY;BYDAY=MO,SU"); // Monday first
    expect(buildRule(weekly([1], { interval: 2 }), WED, opts)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
    expect(buildRule({ kind: "rule", freq: "DAILY", interval: 1, byDay: [], monthly: "dayOfMonth", end: { type: "never" } }, WED, opts)).toBe("FREQ=DAILY");
    expect(buildRule({ kind: "rule", freq: "MONTHLY", interval: 1, byDay: [], monthly: "dayOfMonth", end: { type: "never" } }, WED, opts)).toBe("FREQ=MONTHLY;BYMONTHDAY=4");
    expect(buildRule({ kind: "rule", freq: "MONTHLY", interval: 1, byDay: [], monthly: "nthWeekday", end: { type: "never" } }, WED, opts)).toBe("FREQ=MONTHLY;BYDAY=1WE");
    expect(buildRule({ kind: "rule", freq: "YEARLY", interval: 1, byDay: [], monthly: "dayOfMonth", end: { type: "never" } }, WED, opts)).toBe("FREQ=YEARLY");
  });

  it("uses the last weekday of the month when the start is the fifth one", () => {
    const fifth = "2026-09-30"; // the 5th Wednesday of September 2026
    const r: Recurrence = { kind: "rule", freq: "MONTHLY", interval: 1, byDay: [], monthly: "nthWeekday", end: { type: "never" } };
    expect(buildRule(r, fifth, opts)).toBe("FREQ=MONTHLY;BYDAY=-1WE");
    expect(parseRule("FREQ=MONTHLY;BYDAY=-1WE", fifth, opts)).toMatchObject({ monthly: "nthWeekday" });
  });

  it("writes COUNT and UNTIL (end of the local day in UTC for timed events, a date for all-day)", () => {
    expect(buildRule(weekly([3], { end: { type: "count", count: 5 } }), WED, opts)).toBe("FREQ=WEEKLY;BYDAY=WE;COUNT=5");
    expect(buildRule(weekly([3], { end: { type: "until", date: "2026-12-31" } }), WED, opts)).toBe("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T225959Z");
    expect(buildRule(weekly([3], { end: { type: "until", date: "2026-12-31" } }), WED, { tz: "UTC", allDay: true })).toBe("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231");
  });

  it("round-trips every preset", () => {
    for (const p of presets(WED)) {
      const rule = buildRule(p.recurrence, WED, opts);
      expect(parseRule(rule, WED, opts), p.id).toEqual(p.recurrence);
    }
  });

  it("round-trips rules with ends and intervals", () => {
    for (const r of [
      weekly([1, 3, 5], { interval: 2, end: { type: "count", count: 8 } }),
      weekly([3], { end: { type: "until", date: "2027-03-01" } }),
    ]) {
      expect(parseRule(buildRule(r, WED, opts), WED, opts)).toEqual(r);
    }
  });

  it("rejects values the API would refuse", () => {
    expect(() => buildRule(weekly([3], { interval: 0 }), WED, opts)).toThrow();
    expect(() => buildRule(weekly([3], { end: { type: "count", count: 0 } }), WED, opts)).toThrow();
    expect(() => buildRule(weekly([]), WED, opts)).toThrow();
  });
});

describe("presets", () => {
  it("offers the usual choices, worded for the start date", () => {
    const labels = presets(WED).map((p) => p.label);
    expect(labels).toEqual([
      "Doesn't repeat",
      "Every day",
      "Every week on Wednesday",
      "Every month on day 4",
      "Every month on the first Wednesday",
      "Every year on 4 November",
      "Every weekday (Mon–Fri)",
    ]);
  });

  it("says 'last' for a fifth weekday", () => {
    expect(presets("2026-09-30").map((p) => p.label)).toContain("Every month on the last Wednesday");
  });
});

describe("describeRule", () => {
  it("writes a sentence", () => {
    expect(describeRule("", WED, opts)).toBe("Doesn't repeat");
    expect(describeRule("FREQ=DAILY", WED, opts)).toBe("Every day");
    expect(describeRule("FREQ=DAILY;INTERVAL=2", WED, opts)).toBe("Every 2 days");
    expect(describeRule("FREQ=WEEKLY;BYDAY=WE,FR", WED, opts)).toBe("Every week on Wed, Fri");
    expect(describeRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", WED, opts)).toBe("Every 2 weeks on Mon");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=4", WED, opts)).toBe("Every month on day 4");
    expect(describeRule("FREQ=YEARLY", WED, opts)).toBe("Every year on 4 November");
    expect(describeRule("FREQ=WEEKLY;BYDAY=WE;COUNT=10", WED, opts)).toBe("Every week on Wed, 10 times");
    expect(describeRule("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T225959Z", WED, opts)).toBe("Every week on Wed, until 31 Dec 2026");
  });

  it("shows an unrecognised rule as the rule itself", () => {
    expect(describeRule("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", WED, opts)).toBe("Custom rule: FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1");
  });
});

describe("shiftRuleByDays", () => {
  it("rotates the weekdays of a weekly rule", () => {
    expect(shiftRuleByDays("FREQ=WEEKLY;BYDAY=WE,FR", 1, WED, opts)).toBe("FREQ=WEEKLY;BYDAY=TH,SA");
    expect(shiftRuleByDays("FREQ=WEEKLY;BYDAY=WE,FR", -3, WED, opts)).toBe("FREQ=WEEKLY;BYDAY=TU,SU");
    expect(shiftRuleByDays("FREQ=WEEKLY;BYDAY=SA,SU", 2, "2026-11-07", opts)).toBe("FREQ=WEEKLY;BYDAY=MO,TU");
  });

  it("moves the day of a monthly day-of-month rule with the new start", () => {
    expect(shiftRuleByDays("FREQ=MONTHLY;BYMONTHDAY=4", 3, WED, opts)).toBe("FREQ=MONTHLY;BYMONTHDAY=7");
    expect(shiftRuleByDays("FREQ=MONTHLY;BYMONTHDAY=30", 3, "2026-11-30", opts)).toBe("FREQ=MONTHLY;BYMONTHDAY=3");
  });

  it("leaves daily and yearly rules as they are (the yearly one follows the new start)", () => {
    expect(shiftRuleByDays("FREQ=DAILY;INTERVAL=2", 5, WED, opts)).toBe("FREQ=DAILY;INTERVAL=2");
    expect(shiftRuleByDays("FREQ=YEARLY", 1, WED, opts)).toBe("FREQ=YEARLY");
  });

  it("keeps the end of the rule", () => {
    expect(shiftRuleByDays("FREQ=WEEKLY;BYDAY=WE;COUNT=5", 1, WED, opts)).toBe("FREQ=WEEKLY;BYDAY=TH;COUNT=5");
  });

  it("returns null when the rule cannot be moved safely", () => {
    expect(shiftRuleByDays("FREQ=MONTHLY;BYDAY=1WE", 1, WED, opts)).toBeNull();
    expect(shiftRuleByDays("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", 1, WED, opts)).toBeNull();
  });

  it("is the identity for a zero shift, whatever the rule", () => {
    expect(shiftRuleByDays("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", 0, WED, opts)).toBe("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1");
  });
});
