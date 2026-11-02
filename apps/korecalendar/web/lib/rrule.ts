/**
 * Recurrence rules for the editor. `parseRule` recognises exactly the shapes
 * `buildRule` writes (plus their obvious spellings, such as a bare
 * `FREQ=WEEKLY`); anything else, including every rule the editor cannot
 * express, comes back as `{kind: "raw"}` and is passed through untouched, so
 * editing an event never rewrites or drops a rule the UI does not understand.
 *
 * Weekdays are 0 = Sunday … 6 = Saturday, as in `dates.ts`.
 */
import { addDays, isValidDay, parseDay, weekday } from "./dates";
import { formatFullDate, monthName, weekdayLong, weekdayShort } from "./format";
import { t, type MessageKey } from "./i18n";
import { localToUTC, utcToLocal } from "./tz";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type End = { type: "never" } | { type: "until"; date: string } | { type: "count"; count: number };
export type Recurrence =
  | { kind: "none" }
  | { kind: "rule"; freq: Freq; interval: number; byDay: number[]; monthly: "dayOfMonth" | "nthWeekday"; end: End }
  | { kind: "raw"; rrule: string };

export type RuleRecurrence = Extract<Recurrence, { kind: "rule" }>;

/** What the rule needs to know about the event it belongs to. */
export type RuleContext = { tz: string; allDay: boolean };

const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const FREQS: readonly string[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

function strip(rule: string): string {
  const r = rule.trim();
  return /^rrule:/i.test(r) ? r.slice(6) : r;
}

function split(rule: string): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const part of strip(rule).split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) return null;
    const key = part.slice(0, i).toUpperCase();
    if (out.has(key)) return null;
    out.set(key, part.slice(i + 1));
  }
  return out;
}

/** 1–4 for the first to fourth such weekday of its month, -1 for the fifth ("last"). */
function ordinalOf(start: string): number {
  const n = Math.ceil(parseDay(start).day / 7);
  return n === 5 ? -1 : n;
}

function isLastWeekdayOfMonth(start: string): boolean {
  return parseDay(addDays(start, 7)).month !== parseDay(start).month;
}

const positiveInt = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) && Number(s) >= 1 ? Number(s) : null);

function parseUntil(v: string, ctx: RuleContext): string | null {
  if (/^\d{8}$/.test(v)) {
    const d = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return isValidDay(d) ? d : null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(v);
  if (!m) return null;
  const instant = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  if (Number.isNaN(instant.getTime())) return null;
  return ctx.allDay ? `${m[1]}-${m[2]}-${m[3]}` : utcToLocal(instant, ctx.tz).day;
}

/** Reads a rule for an event starting on `start` (a day, `YYYY-MM-DD`). */
export function parseRule(rrule: string, start: string, ctx: RuleContext): Recurrence {
  const raw: Recurrence = { kind: "raw", rrule };
  if (rrule.trim() === "") return { kind: "none" };
  const p = split(rrule);
  if (!p) return raw;
  const allowed = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL"]);
  for (const key of p.keys()) if (!allowed.has(key)) return raw;

  const freq = p.get("FREQ")?.toUpperCase() ?? "";
  if (!FREQS.includes(freq)) return raw;
  const interval = p.has("INTERVAL") ? positiveInt(p.get("INTERVAL")) : 1;
  if (interval === null) return raw;

  let end: End = { type: "never" };
  if (p.has("COUNT") && p.has("UNTIL")) return raw;
  if (p.has("COUNT")) {
    const count = positiveInt(p.get("COUNT"));
    if (count === null) return raw;
    end = { type: "count", count };
  } else if (p.has("UNTIL")) {
    const date = parseUntil(p.get("UNTIL")!, ctx);
    if (date === null) return raw;
    end = { type: "until", date };
  }

  const byDay = p.get("BYDAY");
  const byMonthDay = p.get("BYMONTHDAY");
  const byMonth = p.get("BYMONTH");
  const rule = (f: Freq, days: number[], monthly: "dayOfMonth" | "nthWeekday"): Recurrence => ({
    kind: "rule", freq: f, interval, byDay: days, monthly, end,
  });
  const { month, day } = parseDay(start);

  switch (freq) {
    case "DAILY":
      return byDay !== undefined || byMonthDay !== undefined || byMonth !== undefined ? raw : rule("DAILY", [], "dayOfMonth");
    case "WEEKLY": {
      if (byMonthDay !== undefined || byMonth !== undefined) return raw;
      if (byDay === undefined) return rule("WEEKLY", [weekday(start)], "dayOfMonth");
      const days = byDay.split(",").map((c) => CODES.indexOf(c.toUpperCase()));
      if (days.some((d) => d < 0) || new Set(days).size !== days.length) return raw;
      return rule("WEEKLY", [...days].sort((a, b) => a - b), "dayOfMonth");
    }
    case "MONTHLY": {
      if (byMonth !== undefined) return raw;
      if (byDay !== undefined && byMonthDay !== undefined) return raw;
      if (byDay === undefined) {
        if (byMonthDay !== undefined && byMonthDay !== String(day)) return raw;
        return rule("MONTHLY", [], "dayOfMonth");
      }
      const m = /^(-?\d)([A-Za-z]{2})$/.exec(byDay);
      if (!m || CODES.indexOf(m[2].toUpperCase()) !== weekday(start)) return raw;
      const n = Number(m[1]);
      const fits = n === ordinalOf(start) || (n === -1 && isLastWeekdayOfMonth(start));
      return fits ? rule("MONTHLY", [], "nthWeekday") : raw;
    }
    default: {
      if (byDay !== undefined) return raw;
      if ((byMonth === undefined) !== (byMonthDay === undefined)) return raw;
      if (byMonth !== undefined && (byMonth !== String(month) || byMonthDay !== String(day))) return raw;
      return rule("YEARLY", [], "dayOfMonth");
    }
  }
}

function untilValue(date: string, ctx: RuleContext): string {
  if (ctx.allDay) return date.replaceAll("-", "");
  // The end of that local day, as an instant in UTC (23:59:59 local).
  const instant = new Date(localToUTC(date, 24 * 60 - 1, ctx.tz).getTime() + 59_000);
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Writes the rule text the API takes; "" for no repeat; a raw rule as it is. */
export function buildRule(r: Recurrence, start: string, ctx: RuleContext): string {
  if (r.kind === "none") return "";
  if (r.kind === "raw") return r.rrule;
  if (!Number.isInteger(r.interval) || r.interval < 1) throw new RangeError("interval must be a whole number of at least 1");
  if (r.end.type === "count" && (!Number.isInteger(r.end.count) || r.end.count < 1)) throw new RangeError("count must be a whole number of at least 1");
  if (r.end.type === "until" && !isValidDay(r.end.date)) throw new RangeError("until must be a date");

  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY") {
    if (r.byDay.length === 0) throw new RangeError("choose at least one weekday");
    parts.push(`BYDAY=${MONDAY_FIRST.filter((d) => r.byDay.includes(d)).map((d) => CODES[d]).join(",")}`);
  } else if (r.freq === "MONTHLY") {
    parts.push(r.monthly === "nthWeekday" ? `BYDAY=${ordinalOf(start)}${CODES[weekday(start)]}` : `BYMONTHDAY=${parseDay(start).day}`);
  }
  if (r.end.type === "count") parts.push(`COUNT=${r.end.count}`);
  if (r.end.type === "until") parts.push(`UNTIL=${untilValue(r.end.date, ctx)}`);
  return parts.join(";");
}

const base = (freq: Freq): RuleRecurrence => ({ kind: "rule", freq, interval: 1, byDay: [], monthly: "dayOfMonth", end: { type: "never" } });

export type Preset = { id: string; label: string; recurrence: Recurrence };

const ordinalWord = (n: number) => t(`rrule.ordinal.${n}` as MessageKey);

/** The quick choices for an event that starts on `start`. */
export function presets(start: string): Preset[] {
  const wd = weekday(start);
  const { day, month } = parseDay(start);
  return [
    { id: "none", label: t("rrule.none"), recurrence: { kind: "none" } },
    { id: "daily", label: t("rrule.daily"), recurrence: base("DAILY") },
    { id: "weekly", label: t("rrule.weeklyOn", { days: weekdayLong(wd) }), recurrence: { ...base("WEEKLY"), byDay: [wd] } },
    { id: "monthly-day", label: t("rrule.monthlyDay", { d: day }), recurrence: base("MONTHLY") },
    {
      id: "monthly-nth",
      label: t("rrule.monthlyNth", { ordinal: ordinalWord(ordinalOf(start)), day: weekdayLong(wd) }),
      recurrence: { ...base("MONTHLY"), monthly: "nthWeekday" },
    },
    { id: "yearly", label: t("rrule.yearly", { date: `${day} ${monthName(month - 1)}` }), recurrence: base("YEARLY") },
    { id: "weekdays", label: t("rrule.weekdays"), recurrence: { ...base("WEEKLY"), byDay: [1, 2, 3, 4, 5] } },
  ];
}

/** The id of the preset `r` equals, or null when it is a custom rule. */
export function matchPreset(r: Recurrence, start: string): string | null {
  return presets(start).find((p) => JSON.stringify(p.recurrence) === JSON.stringify(r))?.id ?? null;
}

/** A sentence for a rule: "Every week on Wed, Fri, until 31 Dec 2026". */
export function describeRule(rrule: string, start: string, ctx: RuleContext): string {
  const r = parseRule(rrule, start, ctx);
  if (r.kind === "none") return t("rrule.none");
  if (r.kind === "raw") return t("rrule.customRule", { rule: strip(r.rrule) });
  const { day, month } = parseDay(start);
  const n = r.interval;
  let text: string;
  switch (r.freq) {
    case "DAILY":
      text = n === 1 ? t("rrule.daily") : t("rrule.dailyN", { n });
      break;
    case "WEEKLY": {
      const days = MONDAY_FIRST.filter((d) => r.byDay.includes(d)).map(weekdayShort).join(", ");
      text = n === 1 ? t("rrule.weeklyOn", { days }) : t("rrule.weeklyNOn", { n, days });
      break;
    }
    case "MONTHLY":
      if (r.monthly === "nthWeekday") {
        const vars = { ordinal: ordinalWord(ordinalOf(start)), day: weekdayLong(weekday(start)) };
        text = n === 1 ? t("rrule.monthlyNth", vars) : t("rrule.monthlyNthN", { n, ...vars });
      } else {
        text = n === 1 ? t("rrule.monthlyDay", { d: day }) : t("rrule.monthlyDayN", { n, d: day });
      }
      break;
    default: {
      const date = `${day} ${monthName(month - 1)}`;
      text = n === 1 ? t("rrule.yearly", { date }) : t("rrule.yearlyN", { n, date });
    }
  }
  if (r.end.type === "count") text += `, ${t("rrule.times", { n: r.end.count })}`;
  if (r.end.type === "until") text += `, ${t("rrule.until", { date: formatFullDate(r.end.date) })}`;
  return text;
}

/**
 * The rule after the whole series moves by `dayDelta` days (so its start is
 * `addDays(start, dayDelta)`): weekdays rotate, day-of-month and yearly rules
 * follow the new start. `null` when the shape cannot be moved safely (nth
 * weekdays, custom rules): the caller then offers only "this event".
 */
export function shiftRuleByDays(rrule: string, dayDelta: number, start: string, ctx: RuleContext): string | null {
  if (dayDelta === 0) return rrule;
  const r = parseRule(rrule, start, ctx);
  if (r.kind === "none") return rrule;
  if (r.kind === "raw") return null;
  const moved = addDays(start, dayDelta);
  switch (r.freq) {
    case "DAILY":
      return rrule;
    case "WEEKLY":
      return buildRule({ ...r, byDay: r.byDay.map((d) => (((d + dayDelta) % 7) + 7) % 7) }, moved, ctx);
    case "MONTHLY":
      return r.monthly === "nthWeekday" ? null : buildRule(r, moved, ctx);
    default:
      return buildRule(r, moved, ctx);
  }
}
