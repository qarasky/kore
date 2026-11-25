# KoreCalendar Android, Stage 2 Implementation Plan (editing, release `android-v0.2.0`)

> **Status:** executed (released as `android-v0.2.0`).

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, with a ledger). Steps use checkbox syntax.

**Goal:** Everything the web editor does to an event, the phone does: create, edit (one occurrence / this and following / all), delete with undo, repeat rules, reminders, with the web app's safety (`If-Match`, `Idempotency-Key`, no lost typing), proven against the real API.

**Architecture:** The web app's pure planning code (`web/lib/editPlan.ts`, `rrule.ts`, `reminders.ts`, `wall.ts`) is ported to plain Kotlin under `edit/` with the web's unit cases ported 1:1 as JVM tests. `CalendarApi` gains the write calls. An `EditorSession` (no Android) drives load → form → plan → send → sync, and the Compose screens only render it. Contract tests run each case of `event-crud.spec.ts` and `recurring.spec.ts` through the same planner and `HttpApi` against the real Go server.

**Spec:** `docs/superpowers/specs/2026-11-03-android-design.md` (Screens › Event editor, Writing, Delete; Stage 2). Rules: `AGENTS.md`. API: `docs/openapi.yaml`.

## Global Constraints

- Recurrence is never computed on the phone; a rule the editor cannot express (`Raw`) is passed through untouched. `buildRule`/`parseRule` only write/read the shapes the web writes.
- Writes go straight to the server: `If-Match: "<version>"` on PATCH/DELETE, `Idempotency-Key` on create (same key for an identical retry, new key when the form changed), API error codes mapped to readable strings (`error.*` of `web/lib/i18n/en.ts`).
- On any failed save the editor stays open with everything typed. A 412 `version_conflict` offers "Reload" (reloads the event, keeps the typed text where the field is unchanged on the server — simplest correct: re-fetch and show the message; typed values are kept in the form until the person chooses to discard them).
- After a successful write the app syncs, so screens and widget agree. Delete shows Undo via `POST /api/events/{id}/restore` (30 days).
- All strings in `strings.xml`; 48 dp targets; TalkBack labels; motion ≤ 250 ms, no bounce.
- Times are edited in the **event's own zone** (as on the web); lists/agenda still show account-zone times.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A retried create after a dropped connection does not create twice (same key), and a changed form gets a new key [Task 4, 5].
2. A save that fails (offline, 5xx, 412) keeps every typed value and the editor open [Task 6].
3. "This event" never carries `tz`, `rrule`, `calendar_id`; a moved weekday rotates a weekly rule; a counted/nth rule cannot be split at a moved day [Task 4, 5].
4. A raw rule survives an edit of the title unchanged [Task 4, 5].
5. All-day end is exclusive on the wire and inclusive in the form; DST day edits do not shift the wall time [Task 1, 4].
6. A delete of a series occurrence offers the three scopes and Undo restores the series [Task 5, 6].

## Tasks

### Task 1: Wall time and recurrence (`edit/Wall.kt`, `edit/Rrule.kt`)
- Tests (ported from `web/lib/__tests__/rrule.test.ts`): parse/build round trips for presets (none, daily, weekly, weekdays, monthly day / nth weekday incl. "last", yearly, interval, count, until timed + all-day), raw for BYSETPOS/unknown keys/duplicate keys/COUNT+UNTIL, `shiftRuleByDays`, `describeRule`-equivalent label ids.
- Produces: `sealed Recurrence {None; Rule(freq, interval, byDay, monthly, end); Raw(rrule)}`, `parseRule(rrule, startDay: LocalDate, ctx: RuleContext)`, `buildRule(...)`, `shiftRuleByDays(...)`, `presets(startDay)`, `RuleContext(tz: ZoneId, allDay)`; `Wall` helpers over `LocalDateTime`/`LocalDate` (`wallString`, `parseWall`, `shiftWall`, `diffMinutes`, `parseTime`).

### Task 2: Reminders and error mapping (`edit/Reminders.kt`, `edit/ErrorKind.kt`)
- Tests: presets, `toMinutes` bounds (0–40320), `addReminder` (no duplicates, longest first, max 20), `describeReminderParts` (unit + amount), `errorKind(ApiException|NetworkException)` for every code in the web's table.

### Task 3: Write API (`data/Models.kt`, `data/Api.kt`)
- `Event` becomes the full series (title, notes, location, start, end, tz, all_day, rrule, rdates, exdates, reminders, version, deleted_at). `EditResult(event, createdId, dropped)`.
- `CalendarApi`: `event(id)`, `createEvent(body, idempotencyKey)`, `updateEvent(id, scope, occurrence, ifMatch, body)`, `deleteEvent(id, scope, occurrence, ifMatch)`, `restoreEvent(id)`.
- Tests (`HttpApiTest`): headers (`If-Match: "3"`, `Idempotency-Key`), query (`scope`, `occurrence` encoded), bodies, error mapping, `dropped_overrides` parsed; FakeApi extended.

### Task 4: Planner (`edit/EditPlan.kt`)
- Port of `editPlan.ts`: `FormValues`, `formFromEvent`, `newFormValues`, `validateForm`, `planCreate`, `planUpdate`, `planDelete`, `allowedDeleteScopes`, `nextAttempt`, `droppedOverrides`, `Scope`, `PlannedRequest(method, path, body, ifMatch, idempotencyKey)`. Tests: every case of `editPlan.test.ts` (minus drag/resize `planMove`, which the phone has no use for yet).

### Task 5: Contract tests against the real server (`contract/EditContractTest.kt`)
- One test per case of `event-crud.spec.ts` (create with every field; edit; delete + undo; end-before-start refused client-side and nothing saved; title required; all-day; visible via the API) and `recurring.spec.ts` (weekly Wed+Fri; edit one occurrence; this and following splits; all events; delete this / following / all + undo; raw rule survives title edit), plus: 412 on a stale version, create replay with the same key creates once, a changed body with the same key is `idempotency_conflict`.

### Task 6: Editor session (`edit/EditorSession.kt`, `ui/AppController` hooks)
- `EditorSession(api, plan inputs, now/uuid)`: `open(occurrence?)` loads `GET /api/events/{id}`; `state` (Loading / Editing(form, errors, saving, banner) / LoadFailed); `save(scope)`; `delete(scope)`; `undoDelete()`. Failures keep the form. After success: `onWritten()` (the controller syncs).
- Tests with `FakeApi`: save success → sync called; network failure keeps form + banner, retry reuses the key; 412 shows conflict and `reload()` refetches; validation blocks the request; delete → undo calls restore; dropped overrides message.

### Task 7: Screens (`ui/EditorScreen.kt`, `ui/ScopeDialog.kt`, details/agenda hooks, `strings.xml`)
- Editor: title, calendar, all-day switch, start/end date+time pickers, time zone picker (searchable list), repeat (presets + custom dialog; raw shown read-only), reminders (presets + custom), location, notes, Save. Scope dialog (Edit/Delete wording). Details gets Edit and Delete. Agenda gets a "New event" button. Delete uses a snackbar-style Undo bar.
- Device tests (Compose, emulator): create → appears; edit a series occurrence with scope; delete + undo — against an in-process fake API.

### Task 8: Docs, version, review, release
- `docs/android.md` (editing), `README`, spec status, version `0.2.0`; one whole-branch review; fixes; PR; `android-v0.2.0`.
