/**
 * Turns what a person did (edited the form, dragged an event, pressed Delete)
 * into the API requests that do exactly that, and says which scopes are safe.
 * Pure and exhaustively tested: this is where "change this event" must not
 * silently change the whole series.
 *
 * Times here are wall-clock strings in the event's own zone, like the API's.
 * An occurrence is identified by its key (its original start).
 */
import { addDays, diffDays } from "./dates";
import { t, type MessageKey } from "./i18n";
import { buildRule, parseRule, shiftRuleByDays, type Recurrence, type RuleContext } from "./rrule";
import type { Event, Occurrence } from "./types";
import { diffMinutes, formatTimeInput, parseTimeInput, parseWall, shiftWall, wallString } from "./wall";

export type Scope = "this" | "following" | "all";

/** The editor's values. For all-day events `endDay` is the last day, inclusive (the API's end is exclusive). */
export type FormValues = {
  title: string;
  notes: string;
  location: string;
  calendarId: string;
  allDay: boolean;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  tz: string;
  recurrence: Recurrence;
  /** Minutes before the start. */
  reminders: number[];
};

export type Request = {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  ifMatch?: number;
  /** Sent as `Idempotency-Key` so a retried create is replayed, not repeated. */
  idempotencyKey?: string;
};
export type Plan = { requests: Request[]; allowedScopes: Scope[]; warnings: MessageKey[] };

const ALL_SCOPES: Scope[] = ["this", "following", "all"];
const DEFAULT_START = "09:00";
const DEFAULT_END = "10:00";

const isRecurring = (master: Event, occ: Occurrence | null) => occ?.is_recurring ?? master.rrule !== "";

/** The form for an event, or for one occurrence of a series. */
export function formFromEvent(master: Event, occ: Occurrence | null): FormValues {
  const src = occ ?? master;
  const reminders = (occ ? occ.reminders : master.reminders).map((r) => r.minutes_before);
  const base = {
    title: src.title,
    notes: src.notes,
    location: src.location,
    calendarId: master.calendar_id,
    tz: master.tz,
    recurrence: parseRule(master.rrule, parseWall(master.start).day, { tz: master.tz, allDay: master.all_day }),
    reminders,
  };
  if (src.all_day) {
    const start = parseWall(src.start).day;
    const last = addDays(parseWall(src.end).day, -1);
    return { ...base, allDay: true, startDay: start, startTime: DEFAULT_START, endDay: diffDays(start, last) < 0 ? start : last, endTime: DEFAULT_END };
  }
  const s = parseWall(src.start);
  const e = parseWall(src.end);
  return { ...base, allDay: false, startDay: s.day, startTime: formatTimeInput(s.minutes), endDay: e.day, endTime: formatTimeInput(e.minutes) };
}

/** The form for a new event that starts at `minutes` on `day` and lasts `durationMinutes` (default an hour). */
export function newFormValues({
  day,
  minutes,
  durationMinutes = 60,
  allDay = false,
  tz,
  calendarId,
}: {
  day: string;
  minutes: number;
  durationMinutes?: number;
  allDay?: boolean;
  tz: string;
  calendarId: string;
}): FormValues {
  const end = shiftWall(wallString(day, minutes), durationMinutes);
  return {
    title: "",
    notes: "",
    location: "",
    calendarId,
    allDay,
    startDay: day,
    startTime: allDay ? DEFAULT_START : formatTimeInput(minutes),
    endDay: allDay ? day : end.day,
    endTime: allDay ? DEFAULT_END : formatTimeInput(end.minutes),
    tz,
    recurrence: { kind: "none" },
    reminders: [],
  };
}

export function validateForm(f: FormValues): { title?: MessageKey; end?: MessageKey } {
  const errors: { title?: MessageKey; end?: MessageKey } = {};
  if (f.title.trim() === "") errors.title = "editor.error.title";
  if (f.allDay) {
    if (diffDays(f.startDay, f.endDay) < 0) errors.end = "editor.error.endBeforeStart";
    return errors;
  }
  const s = parseTimeInput(f.startTime);
  const e = parseTimeInput(f.endTime);
  if (s === null || e === null) errors.end = "editor.error.time";
  else if (diffMinutes(wallString(f.startDay, s), wallString(f.endDay, e)) < 0) errors.end = "editor.error.endBeforeStart";
  return errors;
}

/** The start and the (exclusive, for all-day) end the API wants. */
function apiTimes(f: FormValues): { start: string; end: string } {
  if (f.allDay) return { start: f.startDay, end: addDays(f.endDay, 1) };
  return { start: wallString(f.startDay, parseTimeInput(f.startTime) ?? 0), end: wallString(f.endDay, parseTimeInput(f.endTime) ?? 0) };
}

const reminderBody = (minutes: number[]) => minutes.map((m) => ({ minutes_before: m }));

const canonical = (r: Recurrence): string => {
  const sorted = (o: unknown): unknown =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.fromEntries(Object.entries(o as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]))
      : o;
  return JSON.stringify(sorted(r));
};

export function planCreate(f: FormValues): Plan {
  const { start, end } = apiTimes(f);
  const rrule = buildRule(f.recurrence, f.startDay, { tz: f.tz, allDay: f.allDay });
  const body: Record<string, unknown> = {
    calendar_id: f.calendarId,
    title: f.title.trim(),
    notes: f.notes,
    location: f.location,
    start,
    end,
    tz: f.tz,
    all_day: f.allDay,
    reminders: reminderBody(f.reminders),
  };
  if (rrule !== "") body.rrule = rrule;
  return { requests: [{ method: "POST", path: "/api/events", body }], allowedScopes: ["all"], warnings: [] };
}

/** The last create the person tried and the key it was sent with. */
export type Attempt = { fingerprint: string; key: string };

/**
 * The key for sending `req`: the same one as the previous attempt when it is the
 * same request (a retry after a timeout, whose first try may have landed), a new
 * one when the person changed something (the API refuses a key reused with a
 * different body).
 */
export function nextAttempt(prev: Attempt | null, req: Request, newKey: () => string): Attempt {
  const fingerprint = `${req.method} ${req.path} ${JSON.stringify(req.body ?? null)}`;
  return prev && prev.fingerprint === fingerprint ? prev : { fingerprint, key: newKey() };
}

/** How many changed occurrences a series edit reset, from the PATCH responses (`dropped_overrides`). */
export function droppedOverrides(results: readonly unknown[]): number {
  let n = 0;
  for (const r of results) {
    const list = (r as { dropped_overrides?: unknown } | null | undefined)?.dropped_overrides;
    if (Array.isArray(list)) n += list.length;
  }
  return n;
}

/** "N changed occurrences … were reset", or null when a series edit reset none. */
export function droppedMessage(results: readonly unknown[]): string | null {
  const n = droppedOverrides(results);
  if (n === 0) return null;
  return n === 1 ? t("toast.droppedOne") : t("toast.droppedMany", { count: n });
}

function occurrenceQuery(scope: Scope, key: string): string {
  return scope === "all" ? "" : `?scope=${scope}&occurrence=${encodeURIComponent(key)}`;
}

/** Which scopes a delete may use. */
export function allowedDeleteScopes(master: Event, occ: Occurrence | null = null): Scope[] {
  return isRecurring(master, occ) ? [...ALL_SCOPES] : ["all"];
}

export function planDelete({ master, occurrence, scope }: { master: Event; occurrence: Occurrence | null; scope: Scope }): Plan {
  const allowed = allowedDeleteScopes(master, occurrence);
  const effective = allowed.includes(scope) && occurrence ? scope : "all";
  const path = `/api/events/${master.id}${occurrenceQuery(effective, occurrence?.key ?? "")}`;
  return { requests: [{ method: "DELETE", path, ifMatch: master.version }], allowedScopes: allowed, warnings: [] };
}

const sameList = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * The request for saving `form` over the event (or occurrence) it came from,
 * at `scope`, plus the scopes that are allowed for these particular changes.
 * `requests` is empty when nothing changed.
 */
export function planUpdate({
  master,
  occurrence,
  form,
  scope,
}: {
  master: Event;
  occurrence: Occurrence | null;
  form: FormValues;
  scope: Scope;
}): Plan {
  const orig = formFromEvent(master, occurrence);
  const recurring = isRecurring(master, occurrence);
  const masterCtx: RuleContext = { tz: master.tz, allDay: master.all_day };
  const masterStartDay = parseWall(master.start).day;
  const key = occurrence?.key ?? master.start;

  const changed = {
    title: form.title.trim() !== orig.title,
    notes: form.notes !== orig.notes,
    location: form.location !== orig.location,
    calendar: form.calendarId !== orig.calendarId,
    tz: form.tz !== orig.tz,
    allDay: form.allDay !== orig.allDay,
    start: form.startDay !== orig.startDay || (!form.allDay && form.startTime !== orig.startTime),
    end: form.endDay !== orig.endDay || (!form.allDay && form.endTime !== orig.endTime),
    reminders: !sameList(form.reminders, orig.reminders),
    recurrence: canonical(form.recurrence) !== canonical(orig.recurrence),
  };
  const dayDelta = diffDays(orig.startDay, form.startDay);
  const warnings: MessageKey[] = [];

  // --- which scopes are safe for these changes
  let allowed: Scope[] = recurring ? [...ALL_SCOPES] : ["all"];
  if (recurring) {
    if (changed.tz || changed.calendar || changed.recurrence) allowed = allowed.filter((s) => s !== "this");
    if (dayDelta !== 0 && !changed.recurrence) {
      if (shiftRuleByDays(master.rrule, dayDelta, masterStartDay, masterCtx) === null) {
        allowed = allowed.filter((s) => s === "this");
        warnings.push("editPlan.warn.cannotMoveDay");
      } else if (/(^|;)COUNT=/i.test(master.rrule)) {
        allowed = allowed.filter((s) => s !== "following");
      }
    }
  }

  const anyChange = Object.values(changed).some(Boolean);
  const effective: Scope = allowed.includes(scope) ? scope : (allowed[allowed.length - 1] ?? "all");
  if (!anyChange) return { requests: [], allowedScopes: allowed, warnings };

  const times = apiTimes(form);
  const origTimes = apiTimes(orig);
  const body: Record<string, unknown> = {};
  if (changed.title) body.title = form.title.trim();
  if (changed.notes) body.notes = form.notes;
  if (changed.location) body.location = form.location;
  if (changed.reminders) body.reminders = reminderBody(form.reminders);
  if (changed.allDay) body.all_day = form.allDay;

  const duration = (t: { start: string; end: string }) => (form.allDay ? diffDays(t.start, t.end) : diffMinutes(t.start, t.end));
  const durationChanged = changed.allDay || duration(times) !== (orig.allDay ? diffDays(origTimes.start, origTimes.end) : diffMinutes(origTimes.start, origTimes.end));

  if (effective === "this") {
    if (changed.start || changed.allDay) body.start = times.start;
    if (durationChanged || (changed.end && !changed.start)) body.end = times.end;
  } else {
    // The whole series, or the new series that starts at this occurrence.
    if (changed.tz) body.tz = form.tz;
    if (changed.calendar) body.calendar_id = form.calendarId;
    const timeTouched = changed.start || changed.end || changed.allDay;
    let newMasterStartDay = effective === "following" ? times.start.slice(0, 10) : masterStartDay;
    if (timeTouched) {
      if (effective === "following") {
        body.start = times.start;
        body.end = times.end;
      } else {
        // The series start moves by what the occurrence moved by.
        const dur = duration(times);
        newMasterStartDay = addDays(masterStartDay, dayDelta);
        if (form.allDay) {
          body.start = newMasterStartDay;
          body.end = addDays(newMasterStartDay, dur);
        } else {
          const minutesDelta = parseTimeInput(form.startTime)! - parseTimeInput(orig.startTime)!;
          const start = changed.allDay
            ? wallString(newMasterStartDay, parseTimeInput(form.startTime) ?? 0)
            : (() => {
                const w = shiftWall(master.start, dayDelta * 1440 + minutesDelta);
                return wallString(w.day, w.minutes);
              })();
          const s = parseWall(start);
          newMasterStartDay = s.day;
          body.start = start;
          const e = shiftWall(start, dur);
          body.end = wallString(e.day, e.minutes);
        }
      }
    }
    // The rule: rewritten only if the person changed it (or it embeds the zone/format that just changed);
    // otherwise a moved day carries the weekdays along. A rule the editor cannot express is never touched.
    const rewrites = changed.recurrence || ((changed.tz || changed.allDay) && form.recurrence.kind === "rule" && form.recurrence.end.type === "until");
    if (recurring && rewrites) {
      const rule = buildRule(form.recurrence, effective === "following" ? times.start.slice(0, 10) : newMasterStartDay, { tz: form.tz, allDay: form.allDay });
      if (rule !== master.rrule) body.rrule = rule;
    } else if (!recurring && changed.recurrence) {
      body.rrule = buildRule(form.recurrence, newMasterStartDay, { tz: form.tz, allDay: form.allDay });
    } else if (recurring && dayDelta !== 0) {
      const from = effective === "following" ? orig.startDay : masterStartDay;
      const shifted = shiftRuleByDays(master.rrule, dayDelta, from, masterCtx);
      if (shifted !== null && shifted !== master.rrule) body.rrule = shifted;
    }
  }

  if (Object.keys(body).length === 0) return { requests: [], allowedScopes: allowed, warnings };
  return {
    requests: [{ method: "PATCH", path: `/api/events/${master.id}${occurrenceQuery(effective, key)}`, body, ifMatch: master.version }],
    allowedScopes: allowed,
    warnings,
  };
}

/**
 * A drag or resize: move the occurrence by whole days and minutes (all-day
 * events by days only), or give it a new length. Planned like any other edit,
 * so the same scope rules apply.
 */
export function planMove({
  master,
  occurrence,
  deltaDays,
  deltaMinutes,
  newDurationMinutes,
  scope,
}: {
  master: Event;
  occurrence: Occurrence | null;
  deltaDays: number;
  deltaMinutes: number;
  newDurationMinutes?: number;
  scope: Scope;
}): Plan {
  const f = formFromEvent(master, occurrence);
  if (f.allDay) {
    return planUpdate({ master, occurrence, scope, form: { ...f, startDay: addDays(f.startDay, deltaDays), endDay: addDays(f.endDay, deltaDays) } });
  }
  const startWall = wallString(f.startDay, parseTimeInput(f.startTime) ?? 0);
  const duration = newDurationMinutes ?? diffMinutes(startWall, wallString(f.endDay, parseTimeInput(f.endTime) ?? 0));
  const start = shiftWall(startWall, deltaDays * 1440 + deltaMinutes);
  const end = shiftWall(wallString(start.day, start.minutes), duration);
  return planUpdate({
    master,
    occurrence,
    scope,
    form: { ...f, startDay: start.day, startTime: formatTimeInput(start.minutes), endDay: end.day, endTime: formatTimeInput(end.minutes) },
  });
}
