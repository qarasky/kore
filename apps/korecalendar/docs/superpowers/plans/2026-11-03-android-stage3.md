# KoreCalendar Android, Stage 3 Implementation Plan (views, search; release `android-v0.3.0`)

> **Status:** executed (released as `android-v0.3.0`). Written compactly and executed inline with a ledger; the code and `docs/android.md` are authoritative where they differ.

**Goal:** Day, week and month views with the web's view-switcher idea, search, a week-start choice and a tap on an empty slot to start an event.

**Architecture:** Pure layout and range logic ported from `web/lib/layout.ts`, `agenda.ts`, `range.ts` into `views/` with the web's unit cases ported as JVM tests. `RangeSource` serves a range from the local copy when it lies inside the kept window (14 days back, 60 ahead) and from the server (remembered in memory, never stored) otherwise; offline it shows what the phone has and says so. `SearchSource` asks the server (`q`, 90 days back, 300 ahead, as the web does) and falls back to the local copy. The Compose screens only draw it.

**Spec:** `docs/superpowers/specs/2026-11-03-android-design.md` (Screens, Stage 3).

## Decisions

- The Week view is the web's seven days; on a phone the columns are at least 96 dp wide and scroll sideways together with the day headings and the all-day strip (the web shows three days on a phone; seven readable-by-scrolling columns is closer to the Google app).
- All views draw in the account's zone on a wall-clock grid (24 rows even on a daylight-saving day), like the web.
- Hidden calendars are hidden in every view and in search; "calendars list with show/hide" stays in Settings.
- A tap on an empty slot rounds down to the half hour and opens the editor for an hour; a tap on a day of the month opens that day.
- Event details open by event id and occurrence key from the local copy or from what a view or a search showed.

## Tasks (all done)

1. Layout port: `views/Layout.kt` + `LayoutTest` (placement, midnight, zones, DST, overlaps, all-day lanes, grouping).
2. Ranges and data: `views/Range.kt` (`View`, `WeekStart`, `viewDays`, `viewRange`, `navigate`, `RangeSource`, `SearchSource`) + `RangeTest`; `q` on `CalendarApi.occurrences`.
3. Labels: `views/Labels.kt` (period title, hour labels, half-hour snapping, month chips, search grouping) + `ViewLabelsTest`.
4. Controller: view, week start, day anchor, `step/goTo/today`, `loadRange`, `search`, `findOccurrence`, `beginNew(day, time)` + `AppControllerTest`.
5. Screens: `HomeScreen` (switcher, navigation), `TimeGridView`, `MonthView`, `SearchScreen`, Settings week start; `ViewsFlowTest` on the emulator.
6. Docs, review, release.
