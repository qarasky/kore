import { describe, expect, it } from "vitest";
import {
  allowedDeleteScopes,
  droppedOverrides,
  formFromEvent,
  newFormValues,
  nextAttempt,
  planCreate,
  planDelete,
  planMove,
  planUpdate,
  validateForm,
  type FormValues,
} from "@/lib/editPlan";
import type { Event, Occurrence } from "@/lib/types";

function event(p: Partial<Event> = {}): Event {
  return {
    id: "g1", calendar_id: "c1", title: "Gym", notes: "", location: "", start: "2026-11-04T16:00:00", end: "2026-11-04T17:00:00",
    tz: "Europe/Berlin", all_day: false, rrule: "FREQ=WEEKLY;BYDAY=WE,FR", rdates: [], exdates: [], reminders: [{ minutes_before: 30 }],
    version: 3, created_by: "user", updated_by: "user", created_at: 1, updated_at: 1, ...p,
  };
}

/** The occurrence of `master` on `key` (its original start), as the API lists it. */
function occurrence(master: Event, key: string, p: Partial<Occurrence> = {}): Occurrence {
  const dur = master.all_day ? 0 : 60;
  void dur;
  return {
    event_id: master.id, calendar_id: master.calendar_id, key, title: master.title, notes: master.notes, location: master.location,
    start: key, end: key.replace("T16:00:00", "T17:00:00"), tz: master.tz, all_day: master.all_day, is_recurring: master.rrule !== "",
    is_override: false, start_utc: "", end_utc: "", reminders: master.reminders, ...p,
  };
}

const gym = event();
const nov11 = occurrence(gym, "2026-11-11T16:00:00");

/** The form for the occurrence with `edit` applied. */
function form(master: Event, occ: Occurrence | null, edit: Partial<FormValues> = {}): FormValues {
  return { ...formFromEvent(master, occ), ...edit };
}
const only = (plan: ReturnType<typeof planUpdate>) => {
  expect(plan.requests).toHaveLength(1);
  return plan.requests[0];
};

describe("formFromEvent", () => {
  it("shows the occurrence's own time, title and reminders", () => {
    const f = formFromEvent(gym, occurrence(gym, "2026-11-11T16:00:00", { title: "Gym (late)", start: "2026-11-11T18:00:00", end: "2026-11-11T19:00:00" }));
    expect(f).toMatchObject({ title: "Gym (late)", startDay: "2026-11-11", startTime: "18:00", endDay: "2026-11-11", endTime: "19:00", tz: "Europe/Berlin", reminders: [30] });
    expect(f.recurrence).toMatchObject({ kind: "rule", freq: "WEEKLY", byDay: [3, 5] });
  });

  it("shows an all-day event's last day inclusively (the API's end is exclusive)", () => {
    const trip = event({ all_day: true, start: "2026-12-24", end: "2026-12-27", rrule: "" });
    expect(formFromEvent(trip, null)).toMatchObject({ allDay: true, startDay: "2026-12-24", endDay: "2026-12-26" });
  });
});

describe("planCreate", () => {
  it("creates a timed event", () => {
    const plan = planCreate({ ...form(gym, null), recurrence: { kind: "none" }, title: "Lunch", startDay: "2026-11-05", startTime: "12:00", endDay: "2026-11-05", endTime: "13:00" });
    expect(plan.requests).toEqual([
      {
        method: "POST", path: "/api/events",
        body: { calendar_id: "c1", title: "Lunch", notes: "", location: "", start: "2026-11-05T12:00:00", end: "2026-11-05T13:00:00", tz: "Europe/Berlin", all_day: false, reminders: [{ minutes_before: 30 }] },
      },
    ]);
    expect(plan.allowedScopes).toEqual(["all"]);
  });

  it("creates an all-day event with an exclusive end and day-before reminders", () => {
    const f: FormValues = { ...form(gym, null), recurrence: { kind: "none" }, title: "Holiday", allDay: true, startDay: "2026-12-24", endDay: "2026-12-24", reminders: [1440] };
    expect(planCreate(f).requests[0].body).toMatchObject({
      all_day: true, start: "2026-12-24", end: "2026-12-25", reminders: [{ minutes_before: 1440 }],
    });
  });

  it("sends the rule only when the event repeats", () => {
    const weekly = planCreate({ ...form(gym, null), title: "Gym" }).requests[0].body;
    expect(weekly).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=WE,FR" });
    const single = planCreate({ ...form(gym, null), recurrence: { kind: "none" } }).requests[0].body;
    expect(single).not.toHaveProperty("rrule");
  });
});

describe("planUpdate: scope all", () => {
  it("sends only what changed, guarded by the version", () => {
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { title: "Gym 2" }), scope: "all" }));
    expect(req).toEqual({ method: "PATCH", path: "/api/events/g1", body: { title: "Gym 2" }, ifMatch: 3 });
  });

  it("does nothing when nothing changed", () => {
    expect(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11), scope: "all" }).requests).toEqual([]);
  });

  it("moves the series' start by the same amount the occurrence moved", () => {
    // the 11 Nov session moves two hours later: the series start follows, its date does not
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { startTime: "18:00", endTime: "19:00" }), scope: "all" }));
    expect(req.body).toEqual({ start: "2026-11-04T18:00:00", end: "2026-11-04T19:00:00" });
  });

  it("changes the duration of the whole series", () => {
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { endTime: "17:30" }), scope: "all" }));
    expect(req.body).toEqual({ start: "2026-11-04T16:00:00", end: "2026-11-04T17:30:00" });
  });

  it("moves a weekly series by a day and rotates its weekdays (Review Focus 3)", () => {
    const req = only(
      planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { startDay: "2026-11-12", endDay: "2026-11-12" }), scope: "all" }),
    );
    expect(req.body).toEqual({ start: "2026-11-05T16:00:00", end: "2026-11-05T17:00:00", rrule: "FREQ=WEEKLY;BYDAY=TH,SA" });
  });

  it("changes the time zone, the calendar and the reminders", () => {
    const req = only(
      planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { tz: "UTC", calendarId: "c2", reminders: [60, 10] }), scope: "all" }),
    );
    expect(req.body).toEqual({ tz: "UTC", calendar_id: "c2", reminders: [{ minutes_before: 60 }, { minutes_before: 10 }] });
  });

  it("rewrites the rule only when the person changed it", () => {
    const daily = form(gym, nov11, { recurrence: { kind: "rule", freq: "DAILY", interval: 1, byDay: [], monthly: "dayOfMonth", end: { type: "never" } } });
    expect(only(planUpdate({ master: gym, occurrence: nov11, form: daily, scope: "all" })).body).toEqual({ rrule: "FREQ=DAILY" });
    const none = form(gym, nov11, { recurrence: { kind: "none" } });
    expect(only(planUpdate({ master: gym, occurrence: nov11, form: none, scope: "all" })).body).toEqual({ rrule: "" });
  });

  it("switching a single event to all-day converts its times to dates", () => {
    const once = event({ rrule: "", start: "2026-12-24T09:00:00", end: "2026-12-24T10:00:00" });
    const f = form(once, null, { allDay: true });
    const req = only(planUpdate({ master: once, occurrence: null, form: f, scope: "all" }));
    expect(req.body).toEqual({ all_day: true, start: "2026-12-24", end: "2026-12-25" });
  });

  it("switching an all-day event to timed gives it times", () => {
    const trip = event({ rrule: "", all_day: true, start: "2026-12-24", end: "2026-12-25" });
    const f = form(trip, null, { allDay: false, startTime: "09:00", endTime: "10:00" });
    const req = only(planUpdate({ master: trip, occurrence: null, form: f, scope: "all" }));
    expect(req.body).toEqual({ all_day: false, start: "2026-12-24T09:00:00", end: "2026-12-24T10:00:00" });
  });
});

describe("planUpdate: scope this", () => {
  const q = "?scope=this&occurrence=2026-11-11T16%3A00%3A00";

  it("moves one occurrence and leaves the duration to the API", () => {
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { startTime: "18:00", endTime: "19:00" }), scope: "this" }));
    expect(req).toEqual({ method: "PATCH", path: `/api/events/g1${q}`, body: { start: "2026-11-11T18:00:00" }, ifMatch: 3 });
  });

  it("sends the end when the duration changed", () => {
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { startTime: "18:00", endTime: "19:30" }), scope: "this" }));
    expect(req.body).toEqual({ start: "2026-11-11T18:00:00", end: "2026-11-11T19:30:00" });
  });

  it("changes the text of one occurrence and never the rule or zone", () => {
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { title: "Special", notes: "x", location: "Park" }), scope: "this" }));
    expect(req.body).toEqual({ title: "Special", notes: "x", location: "Park" });
  });
});

describe("planUpdate: scope following", () => {
  const q = "?scope=following&occurrence=2026-11-11T16%3A00%3A00";

  it("edits from this occurrence on", () => {
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { location: "Park" }), scope: "following" }));
    expect(req).toEqual({ method: "PATCH", path: `/api/events/g1${q}`, body: { location: "Park" }, ifMatch: 3 });
  });

  it("starts the new series where the occurrence now is, with its weekdays rotated", () => {
    const f = form(gym, nov11, { startDay: "2026-11-12", endDay: "2026-11-12", startTime: "17:00", endTime: "18:00" });
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: f, scope: "following" }));
    expect(req.body).toEqual({ start: "2026-11-12T17:00:00", end: "2026-11-12T18:00:00", rrule: "FREQ=WEEKLY;BYDAY=TH,SA" });
  });
});

describe("allowed scopes (Review Focus 3)", () => {
  it("a single event can only be changed as a whole", () => {
    const once = event({ rrule: "" });
    expect(planUpdate({ master: once, occurrence: null, form: form(once, null, { title: "x" }), scope: "all" }).allowedScopes).toEqual(["all"]);
    expect(allowedDeleteScopes(once)).toEqual(["all"]);
  });

  it("a series offers all three for a plain edit", () => {
    expect(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { title: "x" }), scope: "all" }).allowedScopes).toEqual(["this", "following", "all"]);
    expect(allowedDeleteScopes(gym)).toEqual(["this", "following", "all"]);
  });

  it("changing the zone, the rule or the calendar takes away 'this event'", () => {
    for (const edit of [{ tz: "UTC" }, { calendarId: "c2" }, { recurrence: { kind: "none" } as const }]) {
      expect(planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, edit), scope: "all" }).allowedScopes, JSON.stringify(edit)).toEqual(["following", "all"]);
    }
  });

  it("a rule that cannot follow a moved day only allows 'this event' for that move", () => {
    const monthly = event({ rrule: "FREQ=MONTHLY;BYDAY=2WE" });
    const occ = occurrence(monthly, "2026-11-11T16:00:00");
    const moved = form(monthly, occ, { startDay: "2026-11-12", endDay: "2026-11-12" });
    const plan = planUpdate({ master: monthly, occurrence: occ, form: moved, scope: "this" });
    expect(plan.allowedScopes).toEqual(["this"]);
    expect(plan.warnings).toEqual(["editPlan.warn.cannotMoveDay"]);
    // moving only the time of day is fine for every scope
    const later = form(monthly, occ, { startTime: "18:00", endTime: "19:00" });
    expect(planUpdate({ master: monthly, occurrence: occ, form: later, scope: "all" }).allowedScopes).toEqual(["this", "following", "all"]);
  });

  it("a counted rule cannot be split at a moved day", () => {
    const counted = event({ rrule: "FREQ=WEEKLY;BYDAY=WE,FR;COUNT=10" });
    const occ = occurrence(counted, "2026-11-11T16:00:00");
    const moved = form(counted, occ, { startDay: "2026-11-12", endDay: "2026-11-12" });
    expect(planUpdate({ master: counted, occurrence: occ, form: moved, scope: "all" }).allowedScopes).toEqual(["this", "all"]);
  });
});

describe("a rule the editor cannot express (Review Focus 4)", () => {
  const odd = event({ rrule: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", start: "2026-10-30T17:00:00", end: "2026-10-30T18:00:00" });
  const occ = occurrence(odd, "2026-11-30T17:00:00", { end: "2026-11-30T18:00:00" });

  it("shows as a raw rule", () => {
    expect(formFromEvent(odd, occ).recurrence).toEqual({ kind: "raw", rrule: odd.rrule });
  });

  it("is left alone when other fields change", () => {
    for (const scope of ["all", "following"] as const) {
      const req = only(planUpdate({ master: odd, occurrence: occ, form: form(odd, occ, { title: "Pay rent" }), scope }));
      expect(req.body, scope).toEqual({ title: "Pay rent" });
    }
  });
});

describe("planDelete", () => {
  it("builds each scope's request", () => {
    expect(planDelete({ master: gym, occurrence: nov11, scope: "all" }).requests).toEqual([{ method: "DELETE", path: "/api/events/g1", ifMatch: 3 }]);
    expect(planDelete({ master: gym, occurrence: nov11, scope: "this" }).requests).toEqual([
      { method: "DELETE", path: "/api/events/g1?scope=this&occurrence=2026-11-11T16%3A00%3A00", ifMatch: 3 },
    ]);
    expect(planDelete({ master: gym, occurrence: nov11, scope: "following" }).requests[0].path).toBe("/api/events/g1?scope=following&occurrence=2026-11-11T16%3A00%3A00");
  });

  it("deleting a single event ignores the scope the dialog never offered", () => {
    const once = event({ rrule: "" });
    expect(planDelete({ master: once, occurrence: null, scope: "this" }).requests[0].path).toBe("/api/events/g1");
  });
});

describe("planMove (drag and resize)", () => {
  it("moves one occurrence by days and minutes", () => {
    const plan = planMove({ master: gym, occurrence: nov11, deltaDays: 1, deltaMinutes: 30, scope: "this" });
    expect(only(plan).body).toEqual({ start: "2026-11-12T16:30:00" });
    expect(only(plan).path).toBe("/api/events/g1?scope=this&occurrence=2026-11-11T16%3A00%3A00");
  });

  it("moves a whole weekly series a day later and rotates it", () => {
    const plan = planMove({ master: gym, occurrence: nov11, deltaDays: 1, deltaMinutes: 0, scope: "all" });
    expect(only(plan).body).toEqual({ start: "2026-11-05T16:00:00", end: "2026-11-05T17:00:00", rrule: "FREQ=WEEKLY;BYDAY=TH,SA" });
  });

  it("resizes by setting a new duration", () => {
    const plan = planMove({ master: gym, occurrence: nov11, deltaDays: 0, deltaMinutes: 0, newDurationMinutes: 90, scope: "this" });
    expect(only(plan).body).toEqual({ end: "2026-11-11T17:30:00" });
  });

  it("moves an all-day event by whole days only", () => {
    const trip = event({ rrule: "", all_day: true, start: "2026-12-24", end: "2026-12-26" });
    const plan = planMove({ master: trip, occurrence: null, deltaDays: 2, deltaMinutes: 45, scope: "all" });
    expect(only(plan).body).toEqual({ start: "2026-12-26", end: "2026-12-28" });
  });

  it("reports which scopes a drop may use", () => {
    const monthly = event({ rrule: "FREQ=MONTHLY;BYDAY=2WE" });
    const occ = occurrence(monthly, "2026-11-11T16:00:00");
    expect(planMove({ master: monthly, occurrence: occ, deltaDays: 1, deltaMinutes: 0, scope: "this" }).allowedScopes).toEqual(["this"]);
    expect(planMove({ master: gym, occurrence: nov11, deltaDays: 0, deltaMinutes: 60, scope: "this" }).allowedScopes).toEqual(["this", "following", "all"]);
  });
});

describe("validateForm", () => {
  it("needs a title and an end that is not before the start", () => {
    expect(validateForm(form(gym, nov11))).toEqual({});
    expect(validateForm(form(gym, nov11, { title: "  " }))).toEqual({ title: "editor.error.title" });
    expect(validateForm(form(gym, nov11, { endTime: "15:00" }))).toEqual({ end: "editor.error.endBeforeStart" });
    expect(validateForm(form(gym, nov11, { endDay: "2026-11-10" }))).toEqual({ end: "editor.error.endBeforeStart" });
    expect(validateForm(form(gym, nov11, { startTime: "" }))).toEqual({ end: "editor.error.time" });
  });

  it("allows an all-day event on a single day", () => {
    expect(validateForm({ ...form(gym, nov11), allDay: true, startDay: "2026-11-11", endDay: "2026-11-11" })).toEqual({});
    expect(validateForm({ ...form(gym, nov11), allDay: true, startDay: "2026-11-11", endDay: "2026-11-10" })).toEqual({ end: "editor.error.endBeforeStart" });
  });
});

describe("when the requested scope is not allowed", () => {
  it("falls back to a scope that is (never to a narrower change than asked for)", () => {
    // 'this event' was requested, but the zone changed: it becomes a whole-series change
    const req = planUpdate({ master: gym, occurrence: nov11, form: form(gym, nov11, { tz: "UTC" }), scope: "this" }).requests[0];
    expect(req.path).toBe("/api/events/g1");
    expect(req.body).toEqual({ tz: "UTC" });
  });

  it("never puts the zone, the rule or the calendar in a one-occurrence change", () => {
    const f = form(gym, nov11, { title: "Special", startTime: "18:00", endTime: "19:00" });
    const req = planUpdate({ master: gym, occurrence: nov11, form: f, scope: "this" }).requests[0];
    for (const forbidden of ["tz", "rrule", "calendar_id"]) expect(req.body).not.toHaveProperty(forbidden);
  });

  it("rewrites a rule's UNTIL when the zone changes under it", () => {
    const until = event({ rrule: "FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261231T225959Z" });
    const occ = occurrence(until, "2026-11-11T16:00:00");
    const req = only(planUpdate({ master: until, occurrence: occ, form: form(until, occ, { tz: "UTC" }), scope: "all" }));
    expect(req.body).toEqual({ tz: "UTC", rrule: "FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261231T235959Z" });
  });

  it("a new series made by 'following' with a changed rule gets a rule built from the occurrence's day", () => {
    const f = form(gym, nov11, { recurrence: { kind: "rule", freq: "WEEKLY", interval: 2, byDay: [3], monthly: "dayOfMonth", end: { type: "never" } } });
    const req = only(planUpdate({ master: gym, occurrence: nov11, form: f, scope: "following" }));
    expect(req.path).toBe("/api/events/g1?scope=following&occurrence=2026-11-11T16%3A00%3A00");
    expect(req.body).toEqual({ rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE" });
  });
});

describe("newFormValues", () => {
  const base = { tz: "Europe/Berlin", calendarId: "c1" };

  it("starts where the person clicked, for the length they dragged", () => {
    expect(newFormValues({ ...base, day: "2026-11-05", minutes: 13 * 60 + 30, durationMinutes: 90 })).toMatchObject({
      title: "", allDay: false, startDay: "2026-11-05", startTime: "13:30", endDay: "2026-11-05", endTime: "15:00",
      tz: "Europe/Berlin", calendarId: "c1", recurrence: { kind: "none" }, reminders: [],
    });
  });

  it("defaults to an hour, and rolls over midnight", () => {
    expect(newFormValues({ ...base, day: "2026-11-05", minutes: 9 * 60 })).toMatchObject({ endTime: "10:00" });
    expect(newFormValues({ ...base, day: "2026-11-05", minutes: 23 * 60 + 30 })).toMatchObject({ endDay: "2026-11-06", endTime: "00:30" });
  });

  it("makes an all-day event on one day", () => {
    expect(newFormValues({ ...base, day: "2026-11-05", minutes: 0, allDay: true })).toMatchObject({ allDay: true, startDay: "2026-11-05", endDay: "2026-11-05" });
  });
});

describe("nextAttempt (one Idempotency-Key per distinct create)", () => {
  const form = (title: string) => planCreate({ ...newFormValues({ calendarId: "c1", tz: "UTC", day: "2026-11-04", minutes: 540, durationMinutes: 60 }), title });
  const req = (title: string) => form(title).requests[0];

  it("gives the first attempt a fresh key", () => {
    expect(nextAttempt(null, req("Dentist"), () => "k1")).toEqual({ fingerprint: expect.any(String), key: "k1" });
  });

  it("keeps the key when the same request is sent again (a retry after a timeout must be replayed, not duplicated)", () => {
    const first = nextAttempt(null, req("Dentist"), () => "k1");
    expect(nextAttempt(first, req("Dentist"), () => "k2").key).toBe("k1");
  });

  it("takes a new key once the person has changed what is being created (the API refuses a key reused with another body)", () => {
    const first = nextAttempt(null, req("Dentist"), () => "k1");
    expect(nextAttempt(first, req("Dentist (changed)"), () => "k2").key).toBe("k2");
  });
});

describe("droppedOverrides (changed occurrences a series edit reset)", () => {
  it("counts the keys the API lists in dropped_overrides", () => {
    expect(droppedOverrides([{ id: "g1", dropped_overrides: ["2026-11-09T09:00:00", "2026-11-16T09:00:00"] }])).toBe(2);
  });
  it("adds up across the requests of a plan and ignores responses without the field", () => {
    expect(droppedOverrides([{ id: "a" }, { id: "b", dropped_overrides: ["x"] }, null, undefined, { dropped_overrides: ["y", "z"] }])).toBe(3);
  });
  it("is zero when nothing was dropped", () => {
    expect(droppedOverrides([])).toBe(0);
    expect(droppedOverrides([{ dropped_overrides: [] }])).toBe(0);
  });
});
