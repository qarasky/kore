# KoreCalendar CalDAV Implementation Plan

> **Status:** executed and merged (2026-11-03). Kept as the record of what was planned; the code and the docs in `docs/` are authoritative where they differ.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CalDAV (RFC 4791) endpoint under `/dav/` so any CalDAV client or library can list, read, create, update and delete events in the same calendars as the web app and REST API.

**Architecture:** A new Go package `api/internal/dav` implements `github.com/emersion/go-webdav/caldav`'s `Backend` over the existing `events`, `calendars` and `ics` packages and sits behind an HTTP Basic (user name = email, password = access token) wrapper. `httpapi` mounts it at `/dav/` and `/.well-known/caldav`; Caddy and the Next dev rewrite route those paths to the API. A small change to `events` adds a `Put` (an `Import` with preconditions) so version checks and UID rules happen inside one transaction.

**Tech Stack:** Go 1.26, `github.com/emersion/go-webdav v0.7.0` (already added to `go.mod`), `go-ical` (present), SQLite via `modernc.org/sqlite`; web Settings text in Next/React; Playwright for the one UI check; Docker with python `caldav` for the real-client acceptance run.

**Spec:** `docs/superpowers/specs/2026-11-02-caldav-design.md` (approved). Main design: `docs/superpowers/specs/2026-11-02-korecalendar-design.md`. Project rules: `AGENTS.md`.

## Global Constraints

- **SQLite transactions:** the DSN uses `_txlock=immediate`; inside a tx use only the `*sql.Tx`; never hold a tx open during network or file I/O. (AGENTS.md)
- **Live events:** an event is live iff `deleted_at IS NULL`; reuse the shared constant in `events`, no ad-hoc predicates. (AGENTS.md)
- **Privacy:** another user's data is a **404**, never 403, on every method and path under `/dav/`. (AGENTS.md)
- **Credentials:** `/dav` accepts HTTP Basic only: user name = the account's email, password = an **access token** (`kcal_…`). The account password, session tokens and the session cookie are refused. Failures are rate limited like logins.
- **Times:** wall-clock strings in the event's IANA `tz`; recurrence expands in that zone; the occurrence key is the nominal start. Nothing about DST changes here: CalDAV reuses `events` and `ics`.
- **TDD for behaviour:** a failing test first, watched failing, then the code. Run `cd api && go vet ./... && go test -race -count=1 ./...`.
- **No new external behaviour beyond the spec:** no `sync-collection`, `getctag`, scheduling, `VTODO`, `MKCALENDAR`/`PROPPATCH`, calendar rename/delete through DAV.
- Errors on `/api` stay `{"error":{"code",…}}`; `/dav` answers in WebDAV/CalDAV XML (RFC 4918/4791), outside the OpenAPI contract.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## What reading the library changed in the design

Recorded here so executors treat them as decided (each becomes a `Ruling:` line in the ledger where it bites):

1. **Path scheme.** `go-webdav` derives the resource type from path depth under its `Prefix`: `/dav/{user_id}/` (principal), `/dav/{user_id}/calendars/` (home set), `/dav/{user_id}/calendars/{calendar_id}/` (collection), `/dav/{user_id}/calendars/{calendar_id}/{uid}.ics` (resource). The spec's `/dav/principals/…` and `/dav/calendars/…` become these. `/dav/` itself answers the root PROPFIND with `current-user-principal`.
2. **No calendar colour or description** is advertised: the library's `Calendar` has `Name`, `Description`, `MaxResourceSize`, `SupportedComponentSet` only. We set `Name`, `MaxResourceSize` (5 MiB, as `.ics` import) and `SupportedComponentSet: ["VEVENT"]`.
3. **`/.well-known/caldav`** is answered by our wrapper with a 301 to `/dav/` **without authentication** (clients probe before they have credentials). The library's own well-known handler needs a principal and is not used.
4. **`PUT` always answers 201** (library TODO) with `Location`; we return no `ETag` (spec), so clients re-read. Preconditions come out as **409** with the CalDAV element (library behaviour), not 403.
5. **`If-Match` on `DELETE`** is not passed to `DeleteCalendarObject(ctx, path)`: the wrapper copies the header into the request context and the backend reads it.
6. **`MKCALENDAR` / `PROPPATCH`** are answered by the library (`MKCOL` → `CreateCalendar`, `PROPPATCH` → 501); `CreateCalendar` returns 403 with a message that calendars are managed in the web app or REST API.
7. `calendar-multiget` is served by the library through `GetCalendarObject`; `calendar-query` calls our `QueryCalendarObjects`.

## Review Focus

1. **Privacy across every method.** `PROPFIND`, `REPORT`, `GET`, `PUT`, `DELETE`, `HEAD` on another user's principal, home set, calendar id or resource name is 404; so is a calendar id of your own account that is soft-deleted, and a resource name that exists only in another of your calendars. Task 1 (wrapper), 3, 4.
2. **Credential handling.** Account password, session token, session cookie, a revoked token, a token for another user's email, and an empty password are all 401 with `WWW-Authenticate: Basic`; repeated failures hit 429; nothing secret is logged. Task 1.
3. **Recurrence fidelity both ways.** A weekly series with an exclusion and a changed occurrence made through REST reads back through CalDAV with the same `EXDATE`/`RECURRENCE-ID`; the same file PUT through CalDAV reads back through REST identically; a `time-range` that crosses a DST change and excludes the removed occurrence returns the right resources; all-day events keep dates. Task 3, 4.
4. **Data safety on write.** `If-Match`/`If-None-Match: *` race outcomes (412) are decided inside the transaction; a `PUT` never silently moves an event to another calendar; the delete-then-put "move" works at once while the deleted event stays restorable; a `PUT` of `VTODO`, an unsupported rule, a name ≠ `{UID}.ics`, a body over 5 MiB or garbage is a clean 4xx (never a 500 or a panic) and changes nothing. Task 2, 4.
5. **Protocol robustness.** Wrong `Content-Type` on `PUT`, `Depth: infinity`, an unknown REPORT, a `calendar-query` with no filter, and an empty calendar all answer sensibly; `/dav/` reveals nothing without credentials. Task 1, 3.

---

### Task 1: Authenticated `/dav` shell

**Files:**
- Modify: `api/internal/auth/tokens.go` (export a token-only principal lookup)
- Create: `api/internal/dav/dav.go`, `api/internal/dav/auth.go`, `api/internal/dav/backend.go` (stub Backend), `api/internal/dav/dav_test.go`
- Modify: `api/internal/httpapi/httpapi.go` (mount)
- Modify: `api/go.mod`, `api/go.sum` (already updated by `go get`)

**Interfaces:**
- Produces in `auth`: `func TokenPrincipal(ctx context.Context, db *sql.DB, tok string) (Principal, bool)`: only an access token (`TokenPrefix`) qualifies; a session token returns `(Principal{}, false)`.
- Produces in `dav`:
  - `type Options struct { Limiter *auth.Limiter; IPLimiter *auth.Limiter; ClientKey func(*http.Request) string }`
  - `func New(db *sql.DB, o Options) http.Handler`: the whole `/dav/` + `/.well-known/caldav` handler: well-known redirect (no auth), Basic authentication, per-user path check (404), a 5 MiB body cap, `DELETE`'s `If-Match` copied into the context, then `caldav.Handler{Backend: b, Prefix: "/dav"}`.
  - `type Backend struct{ db *sql.DB }` implementing `caldav.Backend`; in this task every data method is a stub (`ListCalendars` returns none; the rest 404/403).
  - `func principalFrom(ctx context.Context) auth.Principal` (unexported; the wrapper stores it with `auth.WithPrincipal`).
- Produces in `httpapi`: in `handler()`, `mux.Handle("/dav/", dav.New(...))` and `mux.Handle("/.well-known/caldav", …)` using the server's own `ClientIP`-based `limitKey` and two new limiters (5 per `email|ip`, 30 per ip, 15 min).
- Consumes: `auth.Principal`, `auth.NewLimiter`, `users.Get(ctx, db, id) (users.User, error)` (has `Email`).

- [ ] **Step 1: Write the failing tests** in `dav_test.go` (package `dav_test`, through `testsrv.New(t)`; helper `dav(t, srv, user, pass, method, path, body, headers…)` sends raw requests with Basic auth and returns status, headers, body; helper `token(t, srv, session, name)` creates an access token via `POST /api/tokens`):
  - `TestWellKnownRedirectsWithoutCredentials`: `GET /.well-known/caldav` → 301, `Location: /dav/`.
  - `TestUnauthenticatedIs401WithChallenge`: `PROPFIND /dav/` with no credentials → 401 and `WWW-Authenticate: Basic realm="KoreCalendar"`; body reveals nothing about the data.
  - `TestOnlyAnAccessTokenIsAPassword`: with the right email, an access token → 207 for `PROPFIND /dav/` (Depth 0) whose body contains `current-user-principal` with `/dav/<user_id>/`; the account password, a session token, and a revoked token → 401; the right token with another existing user's email → 401; the session cookie alone → 401.
  - `TestOptionsAdvertisesCalendarAccess`: authenticated `OPTIONS /dav/<user_id>/calendars/` → 200 and `DAV` contains `calendar-access`.
  - `TestAnotherUsersPathIs404ForEveryMethod`: user A's token against `/dav/<B's id>/` and `/dav/<B's id>/calendars/<B's cal>/x.ics` with `PROPFIND`, `REPORT`, `GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS` → 404 each (never 403).
  - `TestFailedLoginsAreRateLimited`: 6 wrong passwords for one email → 429 with `Retry-After`; a correct token for a different email still works.
  - `TestBodyOverFiveMiBIs413`: `PUT` of 6 MiB to a resource path → 413.
  - `TestNothingSecretInTheLog`: capture `log` output around a wrong-password request; assert it does not contain the password.
- [ ] **Step 2: Run** `cd api && go test ./internal/dav/ -count=1` — Expected: FAIL (package does not compile / handler missing).
- [ ] **Step 3: Implement** `auth.TokenPrincipal`; the `dav` package as described: Basic parsing, `strings.EqualFold` email match against `users.Get(p.UserID)`, limiter use mirroring `handleLogin` (`Attempt` before checking, `Reset`/`Forgive` on success), `Retry-After` from the limiter; `http.StatusNotFound` with an empty-bodied XML-less response for a path whose first segment after `/dav/` is not the caller's id (the root `/dav/` is allowed). The principal path is `/dav/{user_id}/` and the home set `/dav/{user_id}/calendars/`. Mount in `httpapi.handler()`.
- [ ] **Step 4: Run** `cd api && go vet ./... && go test -race -count=1 ./...` — Expected: PASS, including the existing OpenAPI route tests (the mount is not in `routes()`).
- [ ] **Step 5: Commit** `feat(api): authenticated /dav shell (Basic with access tokens)`.

---

### Task 2: `events.Put`: Import with preconditions

**Files:**
- Modify: `api/internal/events/import.go`, `api/internal/events/types.go` (new errors)
- Create/Modify: `api/internal/events/import_test.go`

**Interfaces:**
- Produces:
  - `var ErrExists = errors.New("an event with that UID already exists")`, `var ErrUIDConflict = errors.New("that UID belongs to an event in another calendar")`; `ErrVersionConflict` already exists.
  - `type PutOptions struct { IfVersion *int; CreateOnly bool; SameCalendar bool; FreeDeletedUID bool }`
  - `func Put(ctx context.Context, db *sql.DB, a Actor, calendarID string, im Imported, o PutOptions) (ImportResult, error)`: the body of today's `Import` generalised; `Import` becomes `Put` with a zero `PutOptions` (behaviour unchanged).
  - `func FindLiveByUID(ctx context.Context, db *sql.DB, userID, uid string) (Event, error)`: a live event whose `ics_uid` or `id` equals `uid` in a live calendar (`ErrNotFound` otherwise); `ics_uid` match wins.
- Semantics (all inside the same transaction as the write):
  - existing live match + `CreateOnly` → `ErrExists`;
  - existing live match + `IfVersion` ≠ its `Version` → `ErrVersionConflict`; `IfVersion` set but no live match → `ErrNotFound`;
  - existing live match in a calendar ≠ `calendarID` and `SameCalendar` → `ErrUIDConflict` (an empty `calendarID` means "the first calendar" only for creation, never a conflict);
  - soft-deleted match + `FreeDeletedUID` → set the deleted row's `ics_uid` to NULL (it stays restorable) and **create** a new event with the UID in `calendarID`; without the flag, today's behaviour (restore it, keep its calendar).
- Consumes: `events.Imported{UID, Input, Exdates, Overrides}`, `Actor`, `load`, `insertEvent`, `saveEvent`, `recordChange`.

- [ ] **Step 1: Write the failing tests** (package `events`, using `testutil.NewDB`): `TestPutIfVersionMismatchIsRefusedAndChangesNothing`, `TestPutIfVersionMatchUpdatesAndBumpsVersion`, `TestPutCreateOnlyRefusesAnExistingLiveUID`, `TestPutCreateOnlyAllowsADeletedUIDWhenFreed`, `TestPutSameCalendarRefusesAnotherCalendar` (and leaves the event in its calendar), `TestPutFreeDeletedUIDCreatesFreshAndTheDeletedOneStaysRestorable` (restore the old one: it lives with `ICSUID` empty; both exist; the new one in the new calendar), `TestPutWithoutOptionsStillBehavesLikeImport` (the existing `TestImportRestoresASoftDeletedMatch` keeps passing unchanged), `TestPutRaceTwoWritersWithTheSameIfVersion` (two goroutines, one wins, one gets `ErrVersionConflict`).
- [ ] **Step 2: Run** `cd api && go test ./internal/events/ -run 'TestPut' -count=1` — Expected: FAIL (undefined `Put`).
- [ ] **Step 3: Implement** `Put`, `PutOptions`, the errors and `FindLiveByUID`; make `Import` call `Put`.
- [ ] **Step 4: Run** `cd api && go vet ./... && go test -race -count=1 ./...` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): events.Put (import with version, create-only, calendar and deleted-UID rules)`.

---

### Task 3: Read side: discovery, listing, GET, queries

**Files:**
- Modify: `api/internal/dav/backend.go`
- Create: `api/internal/dav/objects.go` (event ⇄ `ical.Calendar`, ETags, paths), `api/internal/dav/read_test.go`

**Interfaces:**
- In `dav` (unexported unless noted): `calendarPath(userID, calID string) string` (`/dav/{u}/calendars/{c}/`), `objectPath(userID, calID, uid string) string`, `etagFor(e events.Event) string` = `e.ID + "-" + strconv.Itoa(e.Version)`, `eventToObject(e events.Event, ovs []events.Override, userID string) (caldav.CalendarObject, error)` (uses `ics.Export([]events.Event{e}, map[string][]events.Override{e.ID: ovs})` then `ical.NewDecoder(...).Decode()`), `uidOf(e events.Event) string` (`ICSUID`, else `ID`).
- Backend methods implemented: `CurrentUserPrincipal`, `CalendarHomeSetPath`, `ListCalendars` (live calendars only, `Name`, `Path`, `MaxResourceSize: 5<<20`, `SupportedComponentSet: []string{"VEVENT"}`), `GetCalendar` (404 for an unknown, other user's or soft-deleted id), `GetCalendarObject`, `ListCalendarObjects` (`events.ListForExport(ctx, db, userID, []string{calID})`), `QueryCalendarObjects`.
- `QueryCalendarObjects(ctx, path, q)`: take the `VEVENT` comp-filter's time range; if set, candidate events = distinct `event_id`s of `events.Occurrences(ctx, db, userID, events.OccQuery{From, To, CalendarIDs: []string{calID}})` (the REST endpoint's expansion, so DST and exclusions are right; a range wider than the REST cap is split in ≤ 400-day windows); then clear the range and run `caldav.Filter` over the candidates for the remaining prop/text filters.
- Consumes: `calendars.List/Get`, `events.ListForExport`, `events.FindLiveByUID`, `events.Occurrences`, `ics.Export`.

- [ ] **Step 1: Write the failing tests** (package `dav_test`; build the real client with `caldav.NewClient(webdav.HTTPClientWithBasicAuth(http.DefaultClient, email, token), srv.URL+"/dav/")`; make data through REST with `testsrv.Do`):
  - `TestDiscoveryFindsPrincipalHomeSetAndCalendars`: `FindCurrentUserPrincipal`, `FindCalendarHomeSet`, `FindCalendars` return `/dav/<id>/`, `/dav/<id>/calendars/` and the user's calendars by name with `SupportedComponentSet == ["VEVENT"]`; a soft-deleted calendar is absent.
  - `TestListingGivesEachSeriesOnceWithAnETagThatChangesOnEdit`: two events; `QueryCalendarObjects` with an empty filter returns two with non-empty ETags; a REST `PATCH` of one changes only that one's ETag; a REST single-occurrence edit also changes it.
  - `TestGetReturnsExdateAndRecurrenceIDFromRESTEdits`: weekly Wed/Fri 16:00 Europe/Berlin series, `DELETE ?scope=this` one Friday, `PATCH ?scope=this` one Wednesday to 18:00 and a new title; `GetCalendarObject` returns one `VEVENT` master with `RRULE`, the `EXDATE`, and a second `VEVENT` with `RECURRENCE-ID` and the new `DTSTART`/`SUMMARY`; `UID` equals the event id (REST-created), `TZID=Europe/Berlin`.
  - `TestTimeRangeAcrossDSTReturnsTheRightSeries`: a weekly 09:00 `America/New_York` series and a one-off; a range around 1 Nov 2026 returns the series; a range that falls entirely on its excluded date returns neither the series nor an unrelated event; a range before any occurrence returns nothing.
  - `TestAllDayEventKeepsItsDates`: an all-day `2026-12-24`..`2026-12-25` event exports `DTSTART;VALUE=DATE:20261224`.
  - `TestMultigetByHrefReturnsOnlyThoseOwnedResources`: `calendar-multiget` for two hrefs of the caller's calendar returns both; one href of another user's calendar returns 404 for that href (never its data).
  - `TestAnotherUsersCalendarIdUnderMyPrincipalIs404`; `TestSoftDeletedEventIsNotListedNorServed`; `TestEmptyCalendarListsNothing`; `TestDepthInfinityPropfindOnTheHomeSetIsAnsweredOrRefusedCleanly` (200/207 or 403, never 500).
- [ ] **Step 2: Run** `cd api && go test ./internal/dav/ -run 'Test(Discovery|Listing|Get|TimeRange|AllDay|Multiget|AnotherUsers|SoftDeleted|Empty|Depth)' -count=1` — Expected: FAIL.
- [ ] **Step 3: Implement** the read side of `Backend`. Where the library maps a missing resource it expects `webdav.NewHTTPError(404, …)` from the backend.
- [ ] **Step 4: Run** `cd api && go vet ./... && go test -race -count=1 ./...` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): CalDAV read side (discovery, listing, GET, calendar-query, multiget)`.

---

### Task 4: Write side: PUT and DELETE

**Files:**
- Modify: `api/internal/dav/backend.go`, `api/internal/dav/dav.go`
- Create: `api/internal/dav/write.go`, `api/internal/dav/write_test.go`

**Interfaces:**
- `PutCalendarObject(ctx, path, cal *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (*caldav.CalendarObject, error)`:
  1. path must be a resource path of the caller's live calendar, else 404;
  2. `caldav.ValidateCalendarObject(cal)`; event type other than `VEVENT` → `caldav.NewPreconditionError(caldav.PreconditionSupportedCalendarComponent)`; invalid → `PreconditionValidCalendarData`;
  3. the file name must equal `uid + ".ics"` else `PreconditionValidCalendarObjectResource`;
  4. encode `cal`, run `ics.Parse(reader, user.Timezone)`; exactly one item, no errors (an unsupported rule or missing start) else `PreconditionValidCalendarObjectResource`;
  5. map `opts`: `IfNoneMatch == "*"` → `CreateOnly`; `IfMatch` set → parse `"{id}-{version}"` (a mismatching id or malformed value → 412) → `IfVersion`; always `SameCalendar: true`, `FreeDeletedUID: true`;
  6. call `events.Put`; map `ErrVersionConflict`/`ErrExists` → `webdav.NewHTTPError(412, err)`, `ErrUIDConflict` → `PreconditionNoUIDConflict`, `ErrNotFound` (calendar) → 404, `*events.ValidationError` → `PreconditionValidCalendarObjectResource`;
  7. return `&caldav.CalendarObject{Path: path}` (no `ETag`).
- `DeleteCalendarObject(ctx, path)`: find the live event by UID in that calendar (404 otherwise); read `If-Match` from the context value the wrapper stored (key `ifMatchKey`; parse as above; mismatch → 412); `events.Delete(ctx, db, actor, e.ID, events.ScopeAll, "", &version)`.
- `CreateCalendar` → `webdav.NewHTTPError(403, errors.New("calendars are managed in the web app or the REST API"))`.
- Actor: `events.Actor{UserID: p.UserID, Label: p.Label()}` from the principal (so `updated_by` is the token's name).

- [ ] **Step 1: Write the failing tests** (client as in Task 3 plus raw requests for headers):
  - `TestPutCreatesAndTheWebAppSeesIt`: `PutCalendarObject` of a one-hour event at `…/ABC-1.ics` (UID `ABC-1`) → exists via `GET /api/events` flow (`/api/occurrences`), `created_by` = token name, `ics_uid` = `ABC-1`.
  - `TestPutRecurringWithExdateAndOverrideRoundTripsToREST`: a file with `RRULE`, `EXDATE`, and a `RECURRENCE-ID` override → REST `/api/occurrences` shows the exclusion and the override; the DAV GET returns an equivalent file (same `EXDATE`, same override `DTSTART`/`SUMMARY`).
  - `TestPutUpdateWithIfMatchSucceedsAndStaleIfMatchIs412ChangingNothing`.
  - `TestPutIfNoneMatchStarRefusesAnExistingUID` (412); `…AllowsANewOne`.
  - `TestPutNeverReturnsAnETag`: response has no `ETag` header and status 201.
  - `TestPutRefusals`, table-driven, each leaves the database unchanged and answers a 4xx with the precondition element in the body (never 5xx): `VTODO` (`supported-calendar-component`), name ≠ `{UID}.ics` (`valid-calendar-object-resource`), `FREQ=HOURLY` (`valid-calendar-object-resource`), no `DTSTART`, garbage body (400), `Content-Type: text/plain` (400), UID already in another calendar of the same user (`no-uid-conflict`), PUT into another user's calendar (404), PUT into a soft-deleted calendar (404).
  - `TestPutWithoutAlarmsClearsRemindersSetInTheWebApp` (documented behaviour).
  - `TestDeleteThenPutIntoAnotherCalendarMovesTheEvent`: `DELETE …/A/x.ics` then `PUT …/B/x.ics` → the event is live in B; the old one is restorable via `POST /api/events/{id}/restore` and then lives in A with no UID clash.
  - `TestPutOntoADeletedUIDDoesNotRestoreIt`; `TestDeleteSoftDeletesAndIsRestorableFromREST`; `TestDeleteWithStaleIfMatchIs412`; `TestDeleteOfAnUnknownResourceIs404`.
  - `TestMkcalendarAndProppatchAreRefused` (403 / 501), and `TestAnotherUsersWritesAre404` for PUT/DELETE.
  - `TestDeleteIfMatchRace`: two concurrent deletes with the same ETag → one 204, one 404 or 412; no 500.
- [ ] **Step 2: Run** `cd api && go test ./internal/dav/ -run 'TestPut|TestDelete|TestMkcalendar|TestAnotherUsersWrites' -count=1` — Expected: FAIL.
- [ ] **Step 3: Implement** the write side and the `If-Match` context plumbing in `dav.go`.
- [ ] **Step 4: Run** `cd api && go vet ./... && go test -race -count=1 ./...` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): CalDAV write side (PUT with preconditions, DELETE, refusals)`.

---

### Task 5: Routing, docs and the Settings text

**Files:**
- Modify: `Caddyfile`, `web/next.config.ts`, `web/lib/i18n/en.ts`, `web/components/settings/TokensManager.tsx`, `web/e2e/settings.spec.ts`, `docs/openapi.yaml` (info description), `docs/api.md`, `README.md`, `AGENTS.md`, `docs/superpowers/specs/2026-11-02-caldav-design.md` (path scheme and colour corrections from "What reading the library changed")
- Create: `docs/caldav.md`

**Interfaces:**
- Caddyfile: the `/api/*` handler also matches `/dav/*` and `/.well-known/caldav` (one `@backend path` matcher), proxied to `api:8080` with `flush_interval -1`, no compression and no web CSP headers; all methods pass through.
- `next.config.ts`: rewrites `/dav/:path*` and `/.well-known/caldav` to the API (dev and e2e), like `/api/:path*`.
- Web: a "CalDAV" block under the token list: the address `{origin}/dav/`, the user name (`me.email`), a sentence that the password is an access token created above, and a link to `docs/caldav.md`'s path on GitHub as plain text. New strings `caldav.title`, `caldav.address`, `caldav.user`, `caldav.passwordNote`, `caldav.docs` in `en.ts` (the strings test requires every string to go through `t()`).
- `docs/caldav.md`: what it is for (standards layer; REST is primary), the address and auth, `curl` and python `caldav` examples, the mapping table, what a `PUT` keeps and drops, known limits (no `sync-collection`/`getctag`, no `VTIMEZONE`, resource name = `{UID}.ics`, full-access tokens, `PUT` returns 201 and no ETag), and a "Verified with" line (filled in Task 6).

- [ ] **Step 1: Write the failing tests:** in `web/e2e/settings.spec.ts` add `CalDAV block shows the address and user name and the token works against /dav`: sign in, open Settings → Access tokens, expect text `/dav/` and the account email; create a token; `request.fetch("/dav/", { method: "PROPFIND", headers: {Authorization: Basic base64(email:token), Depth: "0"} })` through the web server → 207 (proves the Next rewrite forwards `PROPFIND`; **if it does not, rule it in the ledger: dev-only limitation, the e2e uses `API_URL` directly**). In Go, a test that parses the Caddyfile is not possible; the Caddy check is `caddy validate` (Step 4).
- [ ] **Step 2: Run** `cd web && E2E_SKIP_BUILD= npx playwright test settings -g CalDAV` — Expected: FAIL.
- [ ] **Step 3: Implement** the Caddyfile and rewrite changes, the Settings block and strings, `docs/caldav.md`, and the README/AGENTS/api.md/openapi.yaml mentions (AGENTS.md rule: "`/dav` is 404-private, Basic with access tokens only"). Apply the path and colour corrections to the CalDAV design doc.
- [ ] **Step 4: Verify:** `cd web && npm run typecheck && npm run lint && npm test && npm run e2e` (all pass); `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -e KORECAL_SUBNET=172.31.255.0/24 caddy:2.11-alpine caddy validate --config /etc/caddy/Caddyfile` — Expected: `Valid configuration`.
- [ ] **Step 5: Commit** `feat: CalDAV routing, Settings text and docs`.

---

### Task 6: Real-client acceptance and full verification

**Files:**
- Modify: `docs/caldav.md` ("Verified with"), `README.md` (status line)

- [ ] **Step 1: Run the third-party client.** Start the dev API (`/tmp/kcdev/reset.sh && /tmp/kcdev/seed.sh`, rebuilding the API binary from this branch first), create an access token over REST, then run python's `caldav` library from a throwaway container: `docker run --rm --add-host=host.docker.internal:host-gateway python:3-slim sh -c 'pip -q install caldav && python script.py'` against `http://host.docker.internal:18080/dav/` (the script lists calendars, saves a weekly event with an exclusion, searches a date range with `expand=False`, edits its summary, deletes it). Expected: every step succeeds; the web UI (via the API) shows the event after save and not after delete. Record the library version and the script's output in `docs/caldav.md`'s "Verified with" section.
- [ ] **Step 2: Run everything:** `cd api && go vet ./... && go test -race -count=1 ./...`, `cd web && npm run typecheck && npm run lint && npm test && npm run e2e` — Expected: all PASS.
- [ ] **Step 3: Commit** `docs: CalDAV verified with python caldav`.
