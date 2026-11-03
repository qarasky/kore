# KoreCalendar Android, Stage 4 Implementation Plan (reminders and polish; release `android-v0.4.0`)

> **Status:** executed (released as `android-v0.4.0`). Written compactly and executed inline with a ledger; the code and `docs/android.md` are authoritative where they differ.

**Goal:** Reminders that fire on time as Android alarms from the local copy, a Settings "Reminders" status that says what is wrong and how to fix it, the daily update check, and an accessibility pass.

**Architecture:** `reminders/ReminderEngine.kt` is pure (triggers from the occurrences, the "due" window, the status decision) and tested on the JVM. `ReminderRunner` (Android) sets only the *next* alarm as an exact alarm (`setExactAndAllowWhileIdle`; no per-reminder alarms, so no alarm-count limit) and, whenever it runs, first shows what came due since its last check. It runs from the alarm, from the system events that change the clock or restart the app (boot, time set, time zone, package replaced, exact-alarm permission change) and from every sync. `update/UpdateCheck.kt` reads GitHub's release list once a day.

**Spec:** `docs/superpowers/specs/2026-11-03-android-design.md` (Reminders, Update check, Stage 4).

## Decisions

- "Due" means the reminder time fell in `(last check, now]` and the event has not ended: a reminder missed while the phone was off still shows once; nothing shows twice (the check moves the baseline); the first check after sign-in shows nothing from the past.
- Hidden calendars are not muted: the engine gets every occurrence of the local copy.
- An all-day reminder counts back from midnight of the first day in the event's own zone.
- Without the exact-alarm permission the app falls back to an inexact alarm and the Settings line says so; the notification permission is asked once after sign-in, never nagged, and Settings shows the state with a Fix button to the right system screen.
- The update check is on by default, asks GitHub once a day (two hours after a failure), only offers newer `android-v*` releases (pre-releases only to someone running one) and never installs anything.

## Tasks (all done)

1. `ReminderEngine` + `ReminderEngineTest` (11).
2. `UpdateCheck` + `UpdateCheckTest` (8).
3. Controller hooks (`Background.syncReminders/reminderStatus`, update state, prefs) + tests.
4. `ReminderRunner`, receiver, manifest permissions (`POST_NOTIFICATIONS`, `USE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`), Settings section, permission request; `RemindersTest` on the emulator (notification posted once, ended events skipped, status names the next reminder).
5. Accessibility and large-font pass; docs; review; release.
