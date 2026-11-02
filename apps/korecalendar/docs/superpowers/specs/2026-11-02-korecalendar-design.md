# KoreCalendar: design

A self-hosted personal calendar whose API is the product. An AI agent or a custom integration can do everything the UI can do through one stable, documented HTTP API. The web UI and the Android app are ordinary clients of that same API.

Calls marked **(my call)** were made by the designer, not the owner. Everything else was decided by the owner.

## Why

The owner wants a calendar that looks and feels like Proton Calendar or Google Calendar, but neither has a stable, easy API for AI agents or custom integrations. Google's is heavy (OAuth, quotas, verification); Proton's has no public API. The owner wants an agent to be able to add and manage events, handle recurring series properly, and trigger notifications, without scraping or glue.

## Who and how it is used

- One owner, on a home or office server. Used from a browser and from an Android phone, and by AI agents and scripts through the API.
- Multiple accounts are supported the way Kore does it (login, sessions, the first account is the owner, an admin can add users), but this is not the point. Calendars are private to their account. Another user's data is a 404, never a 403 **(my call, copied from Kore's rule)**.

## Goals

- **API-first.** Every UI action is available through the public API. No private endpoints for the clients **(my call)**.
- **Stable and easy for agents.** One documented contract, long-lived access tokens, predictable JSON errors, safe retries.
- **Recurring events done properly**: full iCalendar-style rules, a single occurrence excluded from a series, a single occurrence changed, "this and following" edits.
- **Reminders that reach the owner** in the browser and on the phone.
- **A UI that is very close to Proton Calendar / Google Calendar** in polish, density and familiarity, drawn in Kore's visual language.
- **Same shape as Kore**: Go API, SQLite, Next.js SSR, Caddy, Docker Compose, same tokens and conventions.

## Non-goals and anti-goals

Not in v1, and not to be built:

- Invitations, attendees, free/busy, meeting rooms, or shared calendars between users **(my call)**.
- CalDAV/CardDAV server **(my call)**. `.ics` import and export is in; the CalDAV protocol is out.
- Telegram and email reminders. They come later, so reminders must go through a channel interface that makes adding them cheap.
- iOS. A light theme. Public-internet tunnel or TLS setup beyond what Kore's Caddy stack does.
- Google Play Services, FCM, or any Google dependency on Android.
- Third-party fonts, scripts, analytics or CDNs (Kore's "no external loads" posture).

Failures even if every feature works:

- **A UI that does not read as Proton/Google-grade.** This is the owner's main fear: clunky grids, awkward event creation, a design that feels like a generic admin tool.
- An API that needs tribal knowledge: undocumented fields, surprising recurrence behaviour, or errors an agent cannot act on.
- Recurrence that is wrong around DST, month ends or exclusions.

## Architecture

Same as Kore, with one added client. The owner chose Go and the Kore shape explicitly.

| Part | Decision |
| --- | --- |
| API | **Go** (current stable, as Kore uses), `net/http` mux, **SQLite** (`modernc.org/sqlite`), `_txlock=immediate`, same transaction rules as Kore's `AGENTS.md`. |
| Web UI | **Next.js 16** App Router, React 19, Tailwind v4, SSR. Data pages are Server Components; mutations call the API then `router.refresh()`. |
| Proxy / deploy | **Caddy** in front (the only published service), `docker-compose.yml`, `install.sh`, a data-dir volume marker written by an `init` command, as in Kore. |
| Android | **Native Kotlin + Jetpack Compose** **(my call, matches Zero)**. Dark only. |

Layout **(my call)**: `api/`, `web/`, `android/`, `docs/`, as in Kore and Zero. Reuse Kore's repo conventions (`AGENTS.md`, `web/lib/i18n/en.ts` for every string, the custom `Select`, no `dangerouslySetInnerHTML`, `retry()` in error boundaries, test conventions).

## Calendar model and recurrence

This is the core and the riskiest part. Build and test it first.

- A user has several **calendars**, each with a name and a colour (the mockup shows Personal, Work, Health, Appointments). Events belong to one calendar.
- An **event** has: title, notes, location, start, end, an IANA time zone, all-day flag, calendar, reminders, and an optional recurrence rule.
- **Recurrence follows RFC 5545**: `RRULE` (daily/weekly/monthly/yearly, interval, `BYDAY`, `BYMONTHDAY`, `COUNT`/`UNTIL`), plus `EXDATE` (excluded occurrences) and overrides keyed by `RECURRENCE-ID` (one occurrence changed). Storage may be the iCalendar model or an equivalent; the API's behaviour must match it.
- **Rule coverage (my call):** support the rules real calendars use, not only the basic list: `FREQ` daily/weekly/monthly/yearly, `INTERVAL`, `COUNT`/`UNTIL`, `BYDAY` including ordinals ("2nd Tuesday", "last Friday"), `BYMONTHDAY`, `BYMONTH`, `BYSETPOS` (e.g. last weekday), `WKST`, and `RDATE`. Hourly and finer frequencies are out. The raw RRULE string is the stored source of truth, and the API accepts and returns it (with a structured form being a convenience the builder may add). On `.ics` import, a rule outside this set is **rejected for that event with a clear per-event error**; it is never silently approximated.
- Recurring events expand in the **event's own time zone**, so "9:00 stand-up" stays at 9:00 across DST changes. Times are stored with their zone; instants are UTC. All-day events are dates, not instants.
- The three edit and delete scopes, shown in the approved mockup, are API operations, not just UI:
  - **This event only.** Delete adds an exclusion. Edit stores an override for that occurrence.
  - **This and following.** The old series ends the day before; a new series starts at that occurrence **(my call on the split mechanism)**.
  - **All events.** The whole series.
- The API returns **expanded occurrences for a time range** (`from`, `to`), each tagged with its series id and whether it is an override, so clients and agents never implement recurrence themselves **(my call)**. Series themselves are read and written as rules.
- **Deleted events are soft-deleted and restorable for 30 days** **(my call)**, because agents will make mistakes.
- Each event records who made the last change (a user session or a named token) **(my call)**, so the owner can see what an agent did.

## API for agents and integrations

- REST over JSON under `/api/`. Auth by `Authorization: Bearer <token>`. Web clients may also use a session cookie as in Kore (`kore_session`-style); the Android app uses a bearer token from login, as Zero does **(my call)**.
- **Personal access tokens**: created in the UI, shown once, named, revocable, long-lived. Scopes (read-only vs read-write) are a nice-to-have left to the builder.
- Errors are always `{"error":{"code":"…","message":"…"}}` with a proper status, and codes are stable, documented identifiers. Rate-limit errors carry `retryAfterSec` (Zero's shape).
- **Safe retries**: create operations accept an `Idempotency-Key` header. Updates use a version or `ETag` check so two writers cannot silently overwrite each other **(my call)**.
- **Documented contract**: an OpenAPI document served by the API (and checked into `docs/`) is the source of truth, with worked examples, as `docs/api.md` is in Zero.
- Operations cover at least: calendars, events and series (create, read, update with scope, delete with scope, restore), occurrences in a range, search by text and range, reminders, tokens, push subscriptions, `.ics` import/export, and a change feed for sync.
- A thin **CLI and/or MCP server** over this API is likely valuable (the owner's Wakako, Falco and Flatline are "built for AI agents") but is **not in the first phase** **(my call)**. The API must be good enough that it is a small wrapper.

## Reminders and notifications

- Each event has zero or more reminders as offsets before the start (e.g. 30 minutes, at start). Recurring events apply them to every occurrence, and an override can change them.
- The **server** is the scheduler for server-delivered channels. It must survive restarts without losing or duplicating reminders.
- **Browser:** standard Web Push (VAPID, service worker). Browsers only allow this on a secure context, and, as in Kore, Caddy itself speaks plain HTTP: HTTPS comes from a Cloudflare Tunnel or Tailscale HTTPS in front of it. **(my call)** Build it unconditionally, and when the page is not a secure context show "browser notifications need HTTPS" in settings instead of failing silently. Phone reminders do not depend on HTTPS.
- **Phone:** no push service (Google-free is a requirement). The Android app syncs a window of upcoming **server-expanded occurrences** and sets its own **exact alarms** from them, so reminders fire on time even offline. It refreshes through **background sync about every 15 minutes** (Android decides exact timing; opening the app syncs immediately) **(my call on window size, e.g. the next 30–60 days)**.
- **Known limit, accepted by the owner:** an event an agent adds shortly before it starts may not reach the phone in time. UnifiedPush or ntfy could close this later; it is out of scope now.
- Delivery goes through a **channel interface** so Telegram and email can be added later without touching the scheduler.

## UI (web)

The owner picked the **Proton-like** direction from two mockups (the approved mockups are in `.superpowers/brainstorm/` and summarised here).

- Top bar: brand mark, current period title, previous/next, Today, view switcher (**Day / Week / Month / Agenda**), primary **New event** button, account menu.
- A left panel with a **mini month** (current week highlighted) and **My calendars** with colour swatches and visibility toggles. The sidebar and the grid are two soft panels (`surface`) on the base background, not a full-bleed grid.
- The week grid: hour lines, a now-line, today's date number in the accent. Events are **tinted blocks with a coloured left edge**, the time in the event colour, a repeat glyph on recurring ones.
- **Event editor** (title, when, repeats, calendar, reminders, notes) and the **recurring delete/edit prompt** (This event only / This and following / All events) as in the approved mockup.
- Visual language is Kore's, from `ai-docs/projects/kore/README.md`: dark only, `bg #16181d`, `surface #1d2026`, `raised #23262d`, `border #2c3038`, `text #e6e8ee`, `muted #8a8f9a`, accent `#5b8def`, 6px radius, Inter (local), lucide icons, 15px root. Use tokens, not pixel literals. Calendar colours (violet `#7b6cf0`, green `#4fb286`, amber `#e5a54b`, plus blue) are **my call**, taken from the mockup; semantic status colours stay separate.
- Keyboard and speed matter for a Proton/Google feel: quick-create by clicking or dragging on the grid, drag to move, drag to resize, keyboard shortcuts for views and Today **(my call)**.
- English at launch with every string externalised, as in Kore.

## Android

- Native, Kotlin + Jetpack Compose, dark only, Kore palette, mirroring the web UI's structure at phone scale: agenda and day views first, week and month after **(my call)**.
- Talks to the same API with a bearer token; keeps a local cache (Room or equivalent) for offline reading and alarm scheduling.
- Permissions: exact-alarm and notification permissions handled gracefully; if exact alarms are denied, say so in settings rather than failing silently.
- Backend URL is typed in on first run, as in Zero. No tunnel or TLS setup in the app. **(my call)** Allow cleartext HTTP to the typed backend URL, since LAN and Tailscale installs are plain HTTP, and say so plainly when the URL is not HTTPS.

## Branding

- The scaffold `assets/icon.svg` (a green "K") is a **placeholder from the project template**. Replace it following the ai-docs pattern: a single geometric glyph on a dark rounded tile, accent-blue, generated by a script to every raster size. The exact mark is left to the builder (a calendar-grid take on Kore's four-tile mark is one option).
- Product name in the UI: "Calendar" with the Kore-style wordmark treatment **(my call)**; the repo is KoreCalendar.

## Phasing

One project, three phases, each getting its own plan:

1. **API and core.** Accounts and sessions, calendars, events, full recurrence with exclusions/overrides/this-and-following, occurrence expansion, tokens, OpenAPI, soft delete, `.ics` import/export, reminder scheduler, Web Push, Docker/Caddy install. Heavy tests on recurrence and DST.
2. **Web UI.** All four views, editor, recurring prompts, drag interactions, settings (tokens, notifications, time zone), e2e tests.
3. **Android app.** Sync, local cache, alarms, background sync, views.

## Left to the builder

- Go and library choices within the Kore shape; the SQLite schema; the recurrence-expansion implementation (use a well-tested RFC 5545 library if a good Go one exists, otherwise write it with heavy tests).
- Token scopes, sync cursor design, exact reminder-scheduler design.
- The logo.
- Android library choices and how the sync window is sized.

## Known limits

- Reminders for events added shortly before they start may be late on Android (no push).
- No sharing, invites or CalDAV in v1.
