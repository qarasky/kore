# KoreCalendar Phase 2: Web UI Implementation Plan

> **Status:** executed and merged (2026-11-03). Kept as the record of what was planned; the code and the docs in `docs/` are authoritative where they differ.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js web app, Proton-like in layout and Kore in look, that does everything the API does: week/day/month/agenda views, create/edit/delete with the three recurring scopes, drag to create/move/resize, search, calendars, tokens, import/export, browser notifications, installable with Docker.

**Architecture:** `web/` is a Next.js 16 App Router app with Server Components that fetch from the Go API with the user's `korecal_session` cookie; mutations call the API from the client and then `router.refresh()` (Kore's pattern). The view (`/calendar/{day|week|month|agenda}?date=`) is URL-driven. Pure logic (time zones, grid layout, recurrence rules, edit plans, drag math) lives in `web/lib` with unit tests; components are thin. Playwright runs against the real Go API.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, lucide-react, TypeScript, Vitest, Playwright. Same versions and conventions as `~/.t3/projects/kore/web` (`AGENTS.md` there is the style guide).

**Spec:** `docs/superpowers/specs/2026-11-02-korecalendar-design.md` (section "UI (web)"). Approved mockup direction: Proton-like (panels on the base background, tinted events with a coloured left edge). API contract: `docs/openapi.yaml`, `docs/api.md`.

## Global Constraints

- Next.js 16 App Router + React 19 + Tailwind v4, SSR; data pages are Server Components, mutations call the API from the client then `router.refresh()`.
- Dark only. Tokens (Tailwind `@theme`): bg `#16181d`, surface `#1d2026`, raised `#23262d`, border `#2c3038`, border-strong `#3a3f49`, text `#e6e8ee`, muted `#8a8f9a`, accent `#5b8def`, accent-hover `#7aa3f2`, danger `#f2777a`, warning `#e5a54b`; radius 6px; root font 15px; Inter only if installed (system stack); lucide-react icons wrapped in `components/icons.tsx`. Calendar colours: blue `#5b8def`, violet `#7b6cf0`, green `#4fb286`, amber `#e5a54b`. Use tokens, not pixel literals.
- Every UI string lives in `web/lib/i18n/en.ts`, read with `t(key, vars)`. English only; no string literals in components.
- No native `<select>` (a unit test enforces it): use `components/Select.tsx`. No `dangerouslySetInnerHTML`. No external resource loads (fonts, scripts, CDNs, analytics).
- API errors are `{"error":{"code","message","retryAfterSec"?}}`; the web maps codes to messages in `lib/i18n/en.ts`, never shows raw messages as the only text.
- Event times are wall-clock strings in the event's `tz`; the grid places events by `start_utc`/`end_utc` in the **user's** time zone (`GET /api/me`). All-day events are dates.
- Another user's data is a 404 from the API; the UI shows its not-found page.
- Accessibility floor: everything reachable and operable by keyboard; dialogs are native `<dialog>` with focus return; visible focus ring (`:focus-visible` accent outline); `prefers-reduced-motion` respected; colour is never the only signal.
- TDD for pure logic (Vitest, `web/lib/__tests__/*.test.ts`). Behaviour is proven end to end by Playwright against the real API. Commands: `cd web && npm run typecheck && npm run lint && npm test`, and `npm run e2e` (builds the Go API into a temp dir and the production Next build).

## Review Focus

1. **Time zones and DST in the grid.** An event at 02:30 on a spring-forward day and one spanning midnight render in the right column and position in the user's zone; a user in `America/New_York` and a user in `Asia/Tokyo` both see "today" and the now-line correctly. Task 3, 5.
2. **Overlapping events.** Many events at the same time never overlap each other's text or fall outside the column, and a long one beside short ones keeps its width. Task 5.
3. **Recurring edits and drags.** Dragging or editing one occurrence of a series never silently changes the whole series; "this and following" and "all" produce the PATCH the API expects, including when the weekday changes. Task 9, 10.
4. **Rules the UI cannot express.** An event whose `rrule` the editor cannot represent (e.g. `BYSETPOS`) is shown read-only as its raw rule and saving other fields does not rewrite or drop the rule. Task 8.
5. **Session and server failures.** An expired session returns to the login page and back to where the person was; an unreachable API shows a retry page, not a crash or a blank calendar. Task 2, 14.

## Conventions used by every task

- **Files** live under `web/`; Go changes under `api/` (Task 1 only, plus Docker in Task 15).
- **URL:** `/calendar/{view}?date=YYYY-MM-DD` where `view` is `day|week|month|agenda` (agenda covers 30 days from `date`). `/` redirects to the last view (cookie `kc_view`, default `week`) for today. `/search?q=`, `/settings` (+ `/settings/{calendars|tokens|notifications|import-export|users}`), `/login`.
- **Preferences** are cookies readable by the server: `kc_view` (day|week|month|agenda), `kc_weekstart` (`mon|sun|sat`, default `mon`), `kc_clock` (`24h|12h`, default `24h`), `kc_hidden` (comma-separated hidden calendar ids). Written by `lib/prefs.ts` (client) and read by `lib/prefs-server.ts`.
- **Dates:** a "day" is `YYYY-MM-DD` interpreted in the user's zone. Pure helpers live in `lib/dates.ts` (calendar arithmetic, no `Date` local-zone use) and `lib/tz.ts` (zone ↔ UTC via `Intl`).
- **API types** mirror `docs/openapi.yaml` in `lib/types.ts` (`Event`, `Occurrence`, `Calendar`, `Reminder`, `User`, `Token`, `ChangeSet`).
- **Client mutations** go through `lib/mutations.ts` (one function per API call, each returns the parsed result or throws `ApiError`) and the `useMutate` hook, which shows a toast with the mapped error message on failure and calls `router.refresh()` on success.

## File structure

```
web/package.json, tsconfig.json, eslint.config.mjs, vitest.config.mts, playwright.config.ts, next.config.ts, proxy.ts, Dockerfile
web/app/layout.tsx, globals.css, icon.svg, apple-icon.png, manifest.ts, error.tsx, global-error.tsx, not-found.tsx, page.tsx
web/app/(auth)/login/, (auth)/setup/             login + first-run account creation
web/app/(app)/layout.tsx                          shell: top bar + sidebar, loads me + calendars
web/app/(app)/calendar/[view]/page.tsx            SSR occurrences for the range
web/app/(app)/search/, (app)/settings/…           search results, settings pages
web/public/sw.js                                  push + notificationclick
web/lib/api.ts, session.ts, routes.ts, safe-next.ts, redirect.ts, types.ts, mutations.ts, errors.ts, prefs.ts, prefs-server.ts
web/lib/dates.ts, tz.ts, layout.ts (grid), rrule.ts, editPlan.ts, drag.ts, shortcuts.ts, push.ts, format.ts
web/lib/i18n/index.ts, en.ts
web/components/ (shell, views, editor, dialogs, primitives, icons)
web/e2e/harness/, e2e/*.spec.ts
install.sh, docker-compose.yml (web service), Caddyfile (route /, /api), .env.example
```

---

### Task 1: API: first-run status

The login page must know whether to offer "Create account", and the API has no way to say.

**Files:**
- Create: `api/internal/httpapi/setup_status_test.go`
- Modify: `api/internal/httpapi/accounts.go`, `api/internal/httpapi/httpapi.go`, `api/internal/httpapi/openapi.yaml`, `docs/api.md`

**Interfaces:**
- Produces: `GET /api/setup` (public) → `200 {"setup_required": true|false}`; true only while no account exists. Registered in the route table as `accessPublic` and documented (the existing contract tests enforce both).

- [ ] **Step 1: Write failing tests.** `TestSetupStatusTrueOnFreshInstall`, `TestSetupStatusFalseAfterSetup` (status 200 both, no auth needed, body exactly `{"setup_required":…}`), in `package httpapi_test` using `testsrv`.
- [ ] **Step 2: Run** `cd api && go test ./internal/httpapi/ -run SetupStatus -v` — Expected: FAIL (404).
- [ ] **Step 3: Implement** `(*server).handleSetupStatus` using `users.Count`; add the route and the OpenAPI operation (`x-access: public`, `security: []`), mention it in `docs/api.md` "Get a token".
- [ ] **Step 4: Run** `cd api && go vet ./... && go test -race -count=1 ./...` — Expected: PASS (including `TestEveryRouteIsDocumented`).
- [ ] **Step 5: Commit** `git commit -am "feat(api): GET /api/setup reports whether first-run setup is open"`

### Task 2: Scaffold, tokens, API client, session, auth pages, proxy

**Files:**
- Create: `web/package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `next.config.ts`, `proxy.ts`, `app/layout.tsx`, `app/globals.css`, `app/icon.svg`, `app/manifest.ts`, `app/page.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/login/login-form.tsx`, `app/(auth)/setup/page.tsx`, `app/(auth)/setup/setup-form.tsx`, `lib/api.ts`, `lib/session.ts`, `lib/routes.ts`, `lib/safe-next.ts`, `lib/redirect.ts`, `lib/types.ts`, `lib/errors.ts`, `lib/i18n/index.ts`, `lib/i18n/en.ts`, `components/icons.tsx`, `components/wordmark.tsx`, `components/Logo.tsx`; `assets/icon.svg` (replace the template "K")
- Test: `lib/__tests__/safe-next.test.ts`, `lib/__tests__/errors.test.ts`, `lib/__tests__/api.test.ts`

**Interfaces:**
- Produces: `api<T>(path, init?) → Promise<T>`; `class ApiError{status:number; code:string; retryAfterSec?:number}`; `isApiError(e, status?)`; `SESSION_COOKIE = "korecal_session"`; `requireUser(): Promise<User>` (server-only, cached per request, redirects to `/login?next=…&expired=1` on 401); `errorMessage(e: unknown): string` mapping API codes to `t()` strings (every code in `x-error-codes` has a string); `safeNext(raw) → string` (default `/`); `t(key, vars?)`.
- `proxy.ts` gate: no cookie → `/login?next=`; cookie on `/login` or `/setup` → redirect to `safeNext(next)`; `/_next`, `/api`, `/sw.js`, `/icon.svg`, `/manifest.webmanifest` bypass.

- [ ] **Step 1: Write failing tests.** `safeNext` (same cases as Kore's: absolute URL, `//host`, backslash, control chars, `/login` → default; keeps `/calendar/week?date=2026-11-04`); `errorMessage` returns the mapped string for each documented code, a generic string for unknown codes, and a "can't reach the server" string for `ApiError(503,"unreachable")`; `api()` against a fake `fetch` parses `{"error":{"code":…}}` into `ApiError.code`, adds `retryAfterSec`, treats a network failure as `unreachable`, and sends `credentials: same-origin` in the browser and the cookie header on the server.
- [ ] **Step 2: Run** `cd web && npm test` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** by adapting Kore's files (`lib/api.ts`, `session.ts`, `routes.ts`, `redirect.ts`, `safe-next.ts`, `app/layout.tsx`, `globals.css`, `error.tsx`) to this API: the error body is `{error:{code,message}}` (Kore's was `{error:"code"}`), the cookie is `korecal_session`, `requireUser` calls `/api/me`. Login page: server component asks `GET /api/setup`; if `setup_required` it redirects to `/setup`. `login-form.tsx` posts `/api/login` (cookie is set by the API; on success `router.replace(safeNext(next))`; 401 `bad_credentials` and 429 `rate_limited` (show `retryAfterSec`) have inline messages). `setup-form.tsx` posts `/api/setup`. Both forms are centred panels with the wordmark. Replace `assets/icon.svg` and `app/icon.svg` with the new mark: a dark `#16181d` 64×64 tile (rx 14, 1 px `#2c3038` inner stroke) holding a 3×3 grid of 10×10 rounded squares (rx 2.5, 4 px gutter, inset 9), accent `#5b8def`, opacities stepping 1.0 (today tile, row 2 col 2), 0.6 (its row and column), 0.3 (the rest).
- [ ] **Step 4: Run** `cd web && npm ci && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(web): scaffold Next app, tokens, API client, login and setup"`

### Task 3: Dates and time zones (pure)

**Files:**
- Create: `web/lib/dates.ts`, `web/lib/tz.ts`, `web/lib/prefs.ts`, `web/lib/prefs-server.ts`, `web/lib/format.ts`
- Test: `web/lib/__tests__/dates.test.ts`, `web/lib/__tests__/tz.test.ts`, `web/lib/__tests__/format.test.ts`

**Interfaces:**
- Produces (`dates.ts`, all on `YYYY-MM-DD` strings, no `Date` local-zone use): `addDays(d, n)`, `diffDays(a, b)`, `weekday(d): 0..6` (0 = Sunday), `startOfWeek(d, weekStart: "mon"|"sun"|"sat")`, `monthGrid(d, weekStart): string[][]` (6 rows × 7 days covering the month), `startOfMonth(d)`, `addMonths(d, n)` (clamps the day), `isSameMonth(a, b)`, `compare(a, b)`.
- Produces (`tz.ts`): `localToUTC(day: string, minutes: number, tz: string): Date` (wall time in `tz` to an instant, using RFC 5545 rules for gaps/overlaps: gap → offset before the gap, overlap → first), `utcToLocal(instant: Date, tz: string): {day: string; minutes: number}`, `todayIn(tz, now = new Date()): string`, `dayRange(day, tz): {from: Date; to: Date}` (local midnight to next local midnight), `offsetLabel(tz, at?: Date): string` ("GMT+1"), `isValidTZ(tz)`.
- Produces (`format.ts`): `formatTime(minutes, clock)`, `formatDayTitle(day, view, weekStart)` (e.g. "November 2026", "2–8 Nov 2026", "Wed, 4 Nov 2026"), `formatRange(startUTC, endUTC, tz, clock)`, `weekdayShort(i)`, `monthName(i)` via `Intl` with the `en` locale.
- Produces (`prefs.ts`): `readPrefs(cookieHeader?)`, `writePref(key, value)`; (`prefs-server.ts`): `getPrefs()` reading `next/headers` cookies.

- [ ] **Step 1: Write failing tests.** `dates`: `startOfWeek("2026-11-04","mon")=="2026-11-02"`, `"sun"→"2026-11-01"`, `"sat"→"2026-10-31"`; `monthGrid("2026-11-04","mon")` is 6×7 starting `2026-10-26`; `addMonths("2026-01-31",1)=="2026-02-28"`; `diffDays` across a year end and leap day; `weekday("2026-11-01")==0`. `tz`: `localToUTC("2026-03-08", 150, "America/New_York")` is `2026-03-08T07:30:00Z` (gap: 02:30 → 03:30 EDT); `localToUTC("2026-11-01", 90, "America/New_York")` is `05:30:00Z` (first of the overlap); `utcToLocal(new Date("2026-11-04T15:00:00Z"), "Europe/Berlin")` → `{day:"2026-11-04", minutes: 960}`; across midnight (`2026-11-04T23:30:00Z` in `Asia/Tokyo` → day `2026-11-05`, minutes 510); `dayRange("2026-03-08","America/New_York")` is 23 hours long, `("2026-11-01", …)` 25 hours; `todayIn` for `Pacific/Kiritimati` vs `Pacific/Pago_Pago` at one instant differ by a day. `format`: 24h/12h strings, week title crossing a month and a year boundary.
- [ ] **Step 2: Run** `cd web && npm test -- dates tz format` — Expected: FAIL.
- [ ] **Step 3: Implement** `localToUTC` without a date library: guess `Date.UTC(day, minutes)` minus the zone offset at ±24 h (read with `Intl.DateTimeFormat(..., {timeZoneName: "longOffset"})` or `formatToParts`), then validate both candidate offsets exactly as `api/internal/recur` does (`instant()` there is the reference).
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(web): date and time zone helpers"`

### Task 4: App shell: sidebar, top bar, routing, SSR data

**Files:**
- Create: `web/app/(app)/layout.tsx`, `web/app/(app)/calendar/[view]/page.tsx`, `web/app/(app)/not-found.tsx`, `web/components/AppShell.tsx`, `TopBar.tsx`, `Sidebar.tsx`, `MiniMonth.tsx`, `CalendarList.tsx`, `AccountMenu.tsx`, `ViewSwitcher.tsx`, `lib/range.ts`, `lib/mutations.ts`, `hooks/useMutate.ts`, `components/Toast.tsx`, `components/Menu.tsx`
- Modify: `web/app/page.tsx` (redirect), `web/lib/types.ts`
- Test: `web/lib/__tests__/range.test.ts`

**Interfaces:**
- Consumes: `dates`, `tz`, `prefs-server`, `requireUser`.
- Produces: `viewRange(view, day, tz, weekStart): {from: Date; to: Date; days: string[]}` (week = 7 days from `startOfWeek`; day = 1; month = the 6-row grid; agenda = 30 days); `navigate(view, day, dir: -1|1|0): string` (prev/next/today target day: week ±7, day ±1, month ±1 month, agenda ±30); `calendarHref(view, day): string`. The `(app)` layout loads `me` and `calendars` (`GET /api/calendars`) and renders `AppShell`; the page loads `GET /api/occurrences?from&to&calendar_id…` for visible (not hidden) calendars and passes `{view, day, occurrences, calendars, me, prefs}` to the (placeholder until Task 5/6) view component. Top bar: brand, period title, ◀ ▶, Today, view segmented control, search box, "+ New event" button, account menu (email, Settings, Sign out). Sidebar: mini month (current period highlighted, click a day → that day in the current view), "My calendars" with colour swatch + visibility toggle (writes `kc_hidden`, refreshes), a link to Settings.

- [ ] **Step 1: Write failing tests.** `viewRange` for each view with `weekStart` variants and a DST-change week (`2026-11-01` week in `America/New_York`: `to − from` is 169 hours for the week); `navigate` month end clamping (`2026-01-31` + month → `2026-02-28`); agenda ±30; `calendarHref`.
- [ ] **Step 2: Run** `cd web && npm test -- range` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above. `/` redirects to `calendarHref(kc_view, todayIn(me.timezone))`. An unknown `view` or unparseable `date` is the not-found page. API 404s inside pages show the app's not-found view; `ApiError(503)` flows to `app/error.tsx` (retry button via `retry()`).
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): app shell with navigation, mini month and calendar list"`

### Task 5: Week and day grid

**Files:**
- Create: `web/lib/layout.ts`, `web/components/TimeGrid.tsx`, `EventBlock.tsx`, `AllDayRow.tsx`, `NowLine.tsx`, `DayHeader.tsx`
- Test: `web/lib/__tests__/layout.test.ts`

**Interfaces:**
- Produces (`layout.ts`, pure): `type Placed = {occ: Occurrence; day: string; top: number; height: number; col: number; cols: number; continuesBefore: boolean; continuesAfter: boolean}`; `placeTimed(occs: Occurrence[], days: string[], tz: string): Placed[]` — converts `start_utc`/`end_utc` to the user's zone, splits events that cross midnight into one segment per day (`continues*` flags), clips to `[0, 1440)` minutes, enforces a minimum height of 15 minutes, and lays out overlaps in columns: events are grouped into clusters of transitively-overlapping segments, each cluster assigns the lowest free column, and `cols` is the cluster's column count (Google-style: width = 1/cols; a segment may extend over free columns to its right). `placeAllDay(occs, days): {occ; startIdx: number; span: number; lane: number}[]` for all-day and multi-day events across the visible days with greedy lane packing; `eventsByDay(occs, days, tz)`.
- Produces components: `TimeGrid({days, occurrences, tz, clock, onSelectRange, onOpenEvent, …handlers added in Task 10})` renders the hour gutter, 24 hour rows (`--hour: 3.25rem`), day columns with `EventBlock`s (tinted background `color-mix(in srgb, var(--cal) 24%, var(--color-surface))`, 3 px left border in the calendar colour, time in the calendar colour, a repeat glyph for recurring events, the title truncated), the all-day row, a now-line (red `danger`, only in today's column, updates each minute), auto-scroll to 07:00 (or the now-line when today is visible) on mount.

- [ ] **Step 1: Write failing tests (`layout.test.ts`).** Two overlapping events → `cols=2`, columns 0 and 1; three where A overlaps B and C but B and C do not overlap → A col 0, B and C col 1, `cols=2`; a long event beside two stacked short ones; a back-to-back pair (end == start) does not overlap; a 5-minute event gets `height` of 15 minutes; an event 23:00–01:00 in `Europe/Berlin` yields two segments on consecutive days with `continuesAfter`/`continuesBefore`; the same event viewed by a `Asia/Tokyo` user lands on different days; an event on a spring-forward day (`2026-03-08` New York, 01:00–04:00 local) has 2 hours of height, not 3 **(Review Focus 1)**; 12 events at the same time give `cols=12` and every `col` unique **(Review Focus 2)**; `placeAllDay`: a 3-day event starting Tuesday in a Mon–Sun week → `startIdx 1, span 3`, clipped at week edges, two overlapping bars get lanes 0 and 1.
- [ ] **Step 2: Run** `cd web && npm test -- layout` — Expected: FAIL.
- [ ] **Step 3: Implement** `layout.ts`, then the components using it (no layout maths in components). Keyboard: an event block is a `button`; Enter opens it.
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): week and day grid with overlap layout"`

### Task 6: Month grid, agenda, search

**Files:**
- Create: `web/components/MonthGrid.tsx`, `AgendaList.tsx`, `EventChip.tsx`, `MoreEvents.tsx`, `app/(app)/search/page.tsx`, `components/SearchBox.tsx`, `lib/agenda.ts`
- Test: `web/lib/__tests__/agenda.test.ts`

**Interfaces:**
- Produces: `groupByDay(occs, days, tz): {day: string; items: Occurrence[]}[]` (multi-day events appear on every day they cover; all-day first, then by start; empty days dropped for the agenda); `chipsForDay(items, max): {shown: Occurrence[]; more: number}`. `MonthGrid` shows 6 weeks, today ringed, days outside the month dimmed, up to 3 chips per cell then "+N more" which opens a popover listing the day's events (and the day name links to the day view). `AgendaList` lists 30 days with date headings. Search: the top bar box submits to `/search?q=`; the page queries `GET /api/occurrences` for `today − 90 d … today + 300 d` (≤ 400 days) with `q`, groups results by date, each row opens the event on its day; an empty result and an over-long query have friendly states.

- [ ] **Step 1: Write failing tests.** `groupByDay`: a 3-day all-day event appears on 3 days; ordering all-day → timed; `chipsForDay` with 5 items and max 3 → `more: 2`; event crossing midnight in the user's zone appears on both days.
- [ ] **Step 2: Run** `cd web && npm test -- agenda` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): month view, agenda and search"`

### Task 7: UI primitives

**Files:**
- Create: `web/components/Select.tsx`, `Modal.tsx`, `ConfirmDialog.tsx`, `Popover.tsx`, `Field.tsx`, `Button.tsx`, `Switch.tsx`, `ColorPicker.tsx`, `lib/listbox.ts`, `lib/colors.ts`
- Test: `web/lib/__tests__/no-native-select.test.ts`, `web/lib/__tests__/listbox.test.ts`

**Interfaces:**
- Produces: `Select<V>({value, options, onChange, …aria})`, `Modal({open, onClose, title, children, footer, size})` (native `<dialog>`, `showModal`, focus returns to the opener, Esc closes unless a child popup is open), `ConfirmDialog`, `Popover({anchor, open, onClose, children})`, `Switch`, `ColorPicker({value, onChange})` over the four calendar colours plus a hex input validating `^#[0-9a-fA-F]{6}$`, `calendarTint(hex): {bg, edge}`. `no-native-select.test.ts` fails if any `.tsx` under `components/` or `app/` contains `<select`.

- [ ] **Step 1: Write failing tests.** The no-native-select scan; `listbox` helpers (`stepIndex`, `typeaheadIndex`, `opensAbove`) copied from Kore's behaviour tests; `calendarTint`.
- [ ] **Step 2: Run** `cd web && npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** by adapting Kore's `Select`, `Modal`, `ConfirmDialog`, `listbox` (strings via `t()`).
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): select, modal and form primitives"`

### Task 8: Recurrence rules (pure) and the recurrence editor

**Files:**
- Create: `web/lib/rrule.ts`, `web/components/RecurrenceEditor.tsx`, `web/components/RemindersEditor.tsx`, `web/lib/reminders.ts`
- Test: `web/lib/__tests__/rrule.test.ts`, `web/lib/__tests__/reminders.test.ts`

**Interfaces:**
- Produces (`rrule.ts`): `type Recurrence = {kind: "none"} | {kind: "rule"; freq: "DAILY"|"WEEKLY"|"MONTHLY"|"YEARLY"; interval: number; byDay: number[] /*0=Sun..6*/; monthly: "dayOfMonth"|"nthWeekday"; end: {type: "never"} | {type: "until"; date: string} | {type: "count"; count: number}} | {kind: "raw"; rrule: string}`. `parseRule(rrule: string, start: string): Recurrence` — recognises exactly the shapes the builder emits; anything else (BYSETPOS, BYMONTH+BYDAY combos, multiple BYMONTHDAY, `WKST`, ordinal sets) is `{kind:"raw"}` **(Review Focus 4)**. `buildRule(r: Recurrence, start: string, tz: string): string` (`""` for none; `UNTIL` is written as `YYYYMMDDT235959Z`-style in UTC for timed series via the end of that local day, as a date `YYYYMMDD` for all-day). `presets(start): {id, label, recurrence}[]` ("Doesn't repeat", "Daily", "Weekly on Wednesday", "Monthly on day 4", "Monthly on the first Wednesday", "Yearly on November 4", "Every weekday (Mon–Fri)"). `describe(rrule, start, clock): string` ("Every week on Wed, Fri until 31 Dec 2026"). `shiftRuleByDays(rrule, dayDelta, start): string | null` — weekly: rotates `BYDAY`; monthly by day-of-month and yearly: moves the day; daily: unchanged; returns `null` when the shape cannot be shifted safely (nth-weekday etc.).
- Produces (`reminders.ts`): `reminderPresets` (At time of event, 5/10/15/30 minutes, 1/2 hours, 1/2 days, 1 week before) and `describeReminder(minutes, allDay)`; the editor adds/removes rows (max 20, no duplicates) and a custom row (number + unit).

- [ ] **Step 1: Write failing tests.** Round trips `parse(build(x)) == x` for each preset; `parseRule("FREQ=WEEKLY;BYDAY=WE,FR","2026-11-04")` → weekly Wed+Fri; `parseRule("FREQ=MONTHLY;BYDAY=2WE", …)` → monthly `nthWeekday`; `parseRule("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", …)` → `{kind:"raw"}` and `buildRule(raw)` returns the original string unchanged; `UNTIL` and `COUNT` ends; `describe` strings; `shiftRuleByDays("FREQ=WEEKLY;BYDAY=WE,FR", +1, …)` → `BYDAY=TH,SA`; `("FREQ=MONTHLY;BYMONTHDAY=4", +3)` → `BYMONTHDAY=7`; `("FREQ=MONTHLY;BYDAY=2WE", +1)` → `null`; reminders: presets sorted, `describeReminder(1440,false)` "1 day before", `(0,false)` "At time of event", all-day wording "1 day before (at midnight)".
- [ ] **Step 2: Run** `cd web && npm test -- rrule reminders` — Expected: FAIL.
- [ ] **Step 3: Implement** `rrule.ts` as plain string handling (no dependency); then the two editors (Select for presets with a "Custom…" option opening a small panel: "Repeat every [n] [days|weeks|months|years]", weekday toggle buttons for weekly, "on day N / the nth weekday" for monthly, "Ends: never / on [date] / after [n] times").
- [ ] **Step 4: Run** the same + `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): recurrence rules and reminder editors"`

### Task 9: Edit plans and the event editor

**Files:**
- Create: `web/lib/editPlan.ts`, `web/components/EventEditor.tsx`, `EventPopover.tsx`, `ScopeDialog.tsx`, `TimezoneSelect.tsx`, `lib/zones.ts`, `hooks/useEventEditor.tsx`
- Modify: `web/lib/mutations.ts`
- Test: `web/lib/__tests__/editPlan.test.ts`

**Interfaces:**
- Produces (`editPlan.ts`, pure, **the part that must be right**): `type FormValues = {title, notes, location, calendarId, allDay, startDay, startTime, endDay, endTime, tz, recurrence: Recurrence, reminders: number[]}`; `type Plan = {requests: {method: "POST"|"PATCH"|"DELETE"; path: string; body?: object; ifMatch?: number}[]; allowedScopes: Scope[]; warnings: string[]}`; `planCreate(form): Plan`; `planUpdate({master: Event, occurrence: Occurrence|null, form, scope}): Plan`; `allowedScopes({master, occurrence, form}): ("this"|"following"|"all")[]`; `planDelete({master, occurrence, scope}): Plan`; `planMove({master, occurrence, deltaMinutes, deltaDays, newDurationMinutes?, scope}): Plan` (also used by drag/resize). Rules: a non-recurring event allows only `all`; editing `tz` or the recurrence rule removes `this` from the allowed scopes; scope `this` PATCHes `?scope=this&occurrence=<key>` with `start`/`end`/`title`/`notes`/`location`/`all_day`/`reminders` only (never `tz`/`rrule`); scope `all` on a recurring event with a changed start sends `start = master.start + (new occurrence start − original occurrence start)` (wall arithmetic, keeping the master's date) and `end` likewise, and rewrites the rule with `shiftRuleByDays` when the day moved (if that returns `null` the plan drops `following`/`all` from `allowedScopes` for day changes and adds a warning) **(Review Focus 3)**; scope `following` PATCHes `?scope=following&occurrence=<key>` with the new start as the new series' start and the shifted rule; unchanged fields are omitted; every update carries `ifMatch: master.version`; all-day toggles convert `start`/`end` to dates/times in the same request; a `raw` recurrence is never rewritten unless the user edited it **(Review Focus 4)**.
- Produces components: `EventEditor` (modal): title, calendar `Select` with swatch, all-day switch, start/end date + time inputs (end follows start by the previous duration; end before start is blocked inline), timezone `Select` (searchable list from `Intl.supportedValuesOf("timeZone")`, default `me.timezone`; label shows the offset), `RecurrenceEditor`, `RemindersEditor`, location, notes; Save/Cancel/Delete. Saving a recurring event opens `ScopeDialog` ("This event / This and following events / All events") listing only `allowedScopes`. `EventPopover` (click an event): title, calendar swatch, formatted range in the user's zone (and the event's own zone when it differs), `describe(rrule)`, location, notes, reminders, Edit and Delete buttons. `useEventEditor()` context opens the editor for "new at (day,minutes)" or "edit occurrence".

- [ ] **Step 1: Write failing tests (`editPlan.test.ts`),** using a fixture series Gym (Wed+Fri 16:00–17:00 Europe/Berlin, version 3): `planUpdate` title change, scope `all` → one PATCH `{title}` with `ifMatch 3`; scope `this` on the 11 Nov occurrence moving to 18:00 → `PATCH …?scope=this&occurrence=2026-11-11T16:00:00 {start:"2026-11-11T18:00:00"}` and no `end` (duration kept by the API); scope `all` with the occurrence moved +2 h → master `start 18:00` (date unchanged), `end 19:00`; moving one occurrence one day later with scope `all` → master `start` +1 day and `rrule BYDAY=TH,SA`; the same with a `FREQ=MONTHLY;BYDAY=2WE` series → `allowedScopes == ["this"]` and a warning; changing `tz` or rule → no `this`; non-recurring event → only `all`; `planDelete` scope `this` → `DELETE …?scope=this&occurrence=…`, `following`, `all` (no query); `planCreate` all-day → `{all_day:true,start:"2026-12-24",end:"2026-12-25"}` (end exclusive, +1 day when the UI shows a single day), with `reminders` as `{minutes_before}` objects; toggling all-day off converts to times; a `raw` recurrence untouched when only the title changes.
- [ ] **Step 2: Run** `cd web && npm test -- editPlan` — Expected: FAIL.
- [ ] **Step 3: Implement** `editPlan.ts`, `mutations.ts` helpers (`createEvent`, `patchEvent`, `deleteEvent`, `restoreEvent`, each taking a plan request and returning the parsed response), then the components. A failed `412 version_conflict` shows "This event changed elsewhere" with a Reload button. After success: toast ("Event created", "Event saved", "Event deleted" + **Undo** for full deletes via `POST /api/events/{id}/restore`), `router.refresh()`.
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): event editor, popover and scope dialog"`

### Task 10: Drag to create, move and resize

**Files:**
- Create: `web/lib/drag.ts`, `web/hooks/useGridDrag.ts`
- Modify: `web/components/TimeGrid.tsx`, `EventBlock.tsx`, `MonthGrid.tsx`
- Test: `web/lib/__tests__/drag.test.ts`

**Interfaces:**
- Produces (`drag.ts`, pure): `snapMinutes(minutes, step = 15)`, `pointToSlot({x, y}, gridRect, days, hourHeight, scrollTop): {dayIndex, minutes}`, `rangeFromDrag(start: Slot, end: Slot): {day: string; startMinutes: number; endMinutes: number}` (forward and backward drags, min 15 min), `moveDelta(from: Slot, to: Slot, days: string[]): {deltaDays: number; deltaMinutes: number}`, `resizeEnd(occ, toMinutes)`, `monthMoveDelta(fromDay, toDay)`. `useGridDrag` implements pointer events with a 4 px threshold (below it, a click), a ghost block while dragging, Esc cancels, and keyboard alternatives: with an event block focused, `Alt+↑/↓` moves ±15 min, `Alt+←/→` moves ±1 day, `Shift+↑/↓` resizes ±15 min (each commits after 600 ms idle, or on Enter).
- Behaviour: drag on empty grid → opens the editor prefilled with the range; drag an event body → move; drag the bottom edge → resize; month view: drag an event chip to another day keeps its time. Dropping a recurring occurrence opens `ScopeDialog` with `planMove` (the dialog shows "this event only" first); a non-recurring event applies at once with a toast and Undo (PATCH back with the previous values). While the request runs the block shows its new place (optimistic), and on failure snaps back with an error toast.

- [ ] **Step 1: Write failing tests (`drag.test.ts`).** `snapMinutes(37)=30`, `(38)=45`, bounds `[0,1440]`; `pointToSlot` on a 7-day grid; `rangeFromDrag` upward drag swaps ends and enforces 15 min; `moveDelta` across days and with an hour change; month move across a month boundary; `resizeEnd` never goes before start+15.
- [ ] **Step 2: Run** `cd web && npm test -- drag` — Expected: FAIL.
- [ ] **Step 3: Implement** `drag.ts`, the hook and the component wiring.
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): drag to create, move and resize events"`

### Task 11: Keyboard shortcuts and help

**Files:**
- Create: `web/lib/shortcuts.ts`, `web/hooks/useShortcuts.ts`, `web/components/ShortcutsDialog.tsx`
- Test: `web/lib/__tests__/shortcuts.test.ts`

**Interfaces:**
- Produces: `matchShortcut(e: {key, shiftKey, ctrlKey, metaKey, altKey, target: {tagName, isContentEditable}}): ShortcutId | null` ids `today, prev, next, viewDay, viewWeek, viewMonth, viewAgenda, create, search, help, goToDate`: `t` today, `←`/`k`/`p` previous, `→`/`j`/`n` next, `d`/`w`/`m`/`a` views, `c` new event, `/` search, `?` help, `g` go to date. Shortcuts are ignored when focus is in an input, textarea, select-like control, `contenteditable` or when a modal dialog is open, and with Ctrl/Meta/Alt held.

- [ ] **Step 1: Write failing tests.** Every mapping above; ignored inside `INPUT`/`TEXTAREA`/contenteditable; ignored with Ctrl/Meta; `?` needs Shift; unknown keys → `null`.
- [ ] **Step 2: Run** `cd web && npm test -- shortcuts` — Expected: FAIL.
- [ ] **Step 3: Implement** and wire into `AppShell` (navigation via `router.push`, `c` opens the editor at the next full hour in today's column, `g` opens a small "Go to date" dialog).
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): keyboard shortcuts"`

### Task 12: Settings: general, calendars, tokens, import/export, users

**Files:**
- Create: `web/app/(app)/settings/layout.tsx`, `settings/page.tsx` (General), `settings/calendars/page.tsx`, `settings/tokens/page.tsx`, `settings/import-export/page.tsx`, `settings/users/page.tsx`, `components/settings/*` (`GeneralForm`, `CalendarsManager`, `TokensManager`, `ImportExport`, `UsersManager`, `SettingsNav`), `lib/ics.ts`
- Test: `web/lib/__tests__/ics.test.ts`

**Interfaces:**
- General: time zone (`TimezoneSelect`, `PATCH /api/me`), week start, clock (cookies). Calendars: list with swatch, rename, recolour, delete (409 `calendar_not_empty` → confirm "Delete with its events? You can restore them for 30 days." → `?force=1`, then a toast with **Undo** calling `POST /api/calendars/{id}/restore`), add. Tokens (session only; the page explains that tokens cannot manage tokens): list (name, created, last used), create (one-time reveal panel with copy button and a warning), revoke (confirm). Import/Export: file picker or drop zone → `POST /api/import` (calendar `Select`), shows the summary (`created`, `updated`, each `errors[]` row "Event 3 (nostart@…): the event has no DTSTART" and warnings); Export button downloads `GET /api/export` (all, or per calendar). Users (admin only; others get the not-found page): add user form → `POST /api/admin/users` with a generated password shown once.
- Produces (`ics.ts`): `summarizeImport(result): {headline: string; issues: {label: string; reason: string}[]}`; `exportFileName(calendarName | null, date)`.

- [ ] **Step 1: Write failing tests.** `summarizeImport` (singular/plural headline, errors then warnings, orphan index −1 labelled "changed occurrence"), `exportFileName`.
- [ ] **Step 2: Run** `cd web && npm test -- ics` — Expected: FAIL.
- [ ] **Step 3: Implement** the pages and components; every mutation uses `useMutate`.
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): settings for calendars, tokens, import/export and users"`

### Task 13: Browser notifications

**Files:**
- Create: `web/public/sw.js`, `web/lib/push.ts`, `web/app/(app)/settings/notifications/page.tsx`, `web/components/settings/NotificationsPanel.tsx`
- Test: `web/lib/__tests__/push.test.ts`

**Interfaces:**
- Produces (`push.ts`): `pushSupport(env: {isSecureContext, hasServiceWorker, hasPushManager, hasNotification, permission}): "ok" | "insecure" | "unsupported" | "denied"`; `urlBase64ToUint8Array(s)` (VAPID key); `subscriptionToJSON(sub)`. The panel shows the state with an explanation (insecure → "Browser notifications need HTTPS. Put the calendar behind a tunnel or Tailscale HTTPS."), an Enable button (permission → `GET /api/push/key` → `serviceWorker.register("/sw.js")` → `pushManager.subscribe` → `POST /api/push/subscriptions`, remembers the id in `localStorage`), a Disable button (`DELETE`, `unsubscribe`), and a "Send a test" note describing that reminders arrive before events. `sw.js`: `push` → `showNotification(title, {body, tag: eventId+key, data})`, `notificationclick` → focus an open tab or open `/calendar/day?date=…`.

- [ ] **Step 1: Write failing tests.** `pushSupport` for every combination (insecure beats unsupported; denied reported even when supported); `urlBase64ToUint8Array` round trip and padding; `subscriptionToJSON` shape matches `POST /api/push/subscriptions`.
- [ ] **Step 2: Run** `cd web && npm test -- push` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(web): browser notification settings and service worker"`

### Task 14: Responsive layout, states and error handling

**Files:**
- Modify: `web/components/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `TimeGrid.tsx`, `MonthGrid.tsx`, `app/error.tsx`, `app/(app)/loading.tsx`, `app/(app)/not-found.tsx`
- Create: `web/components/MobileNav.tsx`, `web/components/EmptyState.tsx`

**Interfaces / behaviour:**
- Below 900 px the sidebar becomes a drawer opened from a menu button (focus trap, Esc closes); the top bar collapses to menu, title, prev/next, Today and a "+" button; the week grid shows 3 columns centred on the selected day (day numbers still navigable) and scrolls horizontally if narrower than 280 px per column; touch: long-press-and-drag is not supported (tapping an empty slot opens the editor, tapping an event opens the popover). `loading.tsx` shows a skeleton grid. Empty calendar list → an "Add your first calendar" state; API unreachable → retry page (`retry()`), expired session → login with `next`.

- [ ] **Step 1: Implement** the above. (Behaviour is covered by Task 16's mobile spec; there is no pure logic to unit test beyond `viewRange`'s `days` for the 3-day mobile week, which gets `range.test.ts` cases first: `mobileDays(day, 3)` centres on the day.)
- [ ] **Step 2: Run** `cd web && npm test -- range` (RED for `mobileDays` first) — Expected: FAIL then PASS after adding it to `lib/range.ts`.
- [ ] **Step 3: Run** `cd web && npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 4: Commit** `git commit -am "feat(web): responsive shell, loading and error states"`

### Task 15: End-to-end tests

**Files:**
- Create: `web/e2e/harness/{env.ts,proc.ts,api-server.ts,web-server.ts}`, `web/e2e/helpers.ts`, `web/e2e/{auth,week-view,event-crud,recurring,drag,month-agenda-search,settings,import-export,shortcuts,mobile,errors}.spec.ts`
- Modify: `web/playwright.config.ts`

**Interfaces:**
- The harness builds `../api/cmd/korecalendar` into `$TMPDIR/korecal-e2e`, wipes a data dir, writes a config (127.0.0.1:18080), runs `korecalendar init`, serves it; the web server is the production standalone build on 127.0.0.1:13000 (`API_URL=http://127.0.0.1:18080`). `helpers.ts`: `setup(page)` (first-run account `owner@korecal.test` / `owner-password-123`), `login(page)`, `createEventViaApi(request, body)` using a token, `weekOf(day)`, `chooseOption(scope, label, option)` for `Select`.
- Specs (each real flows, no mocks): **auth** first-run setup then login/logout; wrong password message; rate limit message; expired cookie redirects to login and returns to the page. **week-view** events appear at the right time in the user's zone (set the user's zone to `America/New_York` and `Asia/Tokyo` in two runs, assert the time label), the now-line is only on today, overlapping events lay side by side, an event spanning midnight shows in both columns **(Review Focus 1, 2)**. **event-crud** create via the editor (all fields), edit, delete + Undo restores it, validation (end before start). **recurring** create weekly Wed/Fri; edit one occurrence (this) changes only it; "this and following" splits; "all" changes all; delete this / following / all; a series with an unsupported rule imported from `.ics` shows its raw rule read-only and editing the title keeps the rule **(Review Focus 3, 4)**. **drag** drag-create opens the editor with the range; move an event to another slot/day; resize; recurring drag shows the scope dialog; Esc cancels; keyboard move. **month-agenda-search** month view chips and "+N more", agenda grouping, search finds by title/notes. **settings** change time zone shifts the grid; add/rename/recolour/delete (+undo) calendar and hidden calendar toggle persists after reload; create token → one-time reveal → use it against the API with `request` → revoke → 401; users (admin) create a user who then logs in and cannot see the admin's events. **import-export** import `google.ics` fixture → events appear, summary lists errors for `unsupported.ics`; export download parses. **shortcuts** `t`, `w`/`m`/`d`/`a`, `c`, `?`, `/`, and no shortcuts while typing. **mobile** (iPhone viewport) drawer, 3-day grid, tap to create. **errors** API down → retry page then recovers after the API returns (second web instance pointed at a dead API, as Kore does) **(Review Focus 5)**.

- [ ] **Step 1: Write the harness and `auth.spec.ts`;** run `cd web && npx playwright install chromium && npm run e2e -- auth` — Expected: PASS (this proves the harness).
- [ ] **Step 2: Write the remaining specs one file at a time;** after each run `npm run e2e -- <file>` — Expected: PASS. A failing spec is a bug in the app or the spec; fix the app via TDD where the bug is in `lib/` logic (add the unit test first), and record each such fix in the ledger.
- [ ] **Step 3: Run the whole suite** `cd web && npm run e2e` — Expected: all PASS, no retries needed.
- [ ] **Step 4: Commit** `git add -A && git commit -m "test(web): end-to-end suite against the real API"`

### Task 16: Docker, Caddy, installer, docs

**Files:**
- Create: `web/Dockerfile`, `install.sh`, `docs/web.md`
- Modify: `docker-compose.yml` (add `web`), `Caddyfile` (route `/` to web), `.env.example`, `README.md`, `AGENTS.md`, `web/README.md` (create)

**Interfaces:**
- `web` service: image `ghcr.io/qarasky/korecalendar-web:${KORECAL_VERSION:-latest}`, build `./web`, `API_URL=http://api:8080`, read-only, tmpfs `/tmp` and `/app/.next/cache`, `internal` network only, depends on `api` healthy; Caddy `depends_on` both. Caddyfile: `/api/*` → `api:8080`; everything else → `web:3000` with the security headers from Kore's Caddyfile (CSP `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`). `install.sh` is Kore's adapted: no admin password prompts (the first account is created in the browser), asks directory/data dir/bind/port, writes `.env`, initializes the volume with the api image's `korecalendar init`, pulls and starts, prints the URL and "open it to create your account". Env overrides use the `KORECAL_*` names plus `KORECAL_SOURCE_DIR` for local installs.
- Docs: `docs/web.md` (what the UI does, shortcuts table, notifications and HTTPS, preferences, drag behaviour including the recurring rules, known limits), README install section updated, phase status updated.

- [ ] **Step 1: Write the files.**
- [ ] **Step 2: Verify for real:** `docker compose --env-file <tmp>.env config -q`; `docker run --rm caddy:2.11-alpine caddy validate` on the new Caddyfile; `docker compose up -d --build --wait` (both services healthy), `curl` the login page and `/api/healthz` through Caddy, `KORECAL_SOURCE_DIR=. KORECAL_YES=1 ./install.sh` into a temp dir with a free port, then run `E2E_BASE_URL=http://127.0.0.1:<port> npx playwright test auth week-view event-crud` against the running stack; tear everything down and remove images — Expected: all PASS, nothing left running.
- [ ] **Step 3: Commit** `git add -A && git commit -m "feat: web service in the Docker stack, installer and docs"`

---

## Self-review notes

- **Spec coverage ("UI (web)" + phase 2):** top bar with title, prev/next, Today, view switch, New event, account menu (T4); mini month and calendars with visibility toggles (T4); week grid with hour lines, now-line, today accent, tinted blocks with repeat glyph (T5); day/month/agenda (T5, T6); event editor and the three-scope prompt (T9); quick create by dragging, drag to move, drag to resize (T10); keyboard shortcuts (T11); all-day, time zone, reminders, recurrence editor (T8, T9); settings for tokens, notifications, time zone (T12, T13); English strings externalised (all); Kore tokens and conventions (T2, T7); e2e tests (T15); install (T16). Deferred on purpose: password change (the API has no endpoint), a light theme, Russian, offline use.
- **Plan decisions flagged for review:** the `GET /api/setup` addition (T1); cookies for preferences (T3); multi-day timed events split per day (T5); recurring drags that change the weekday only offer scopes the rule can follow (T9); the new calendar-grid logo (T2).
