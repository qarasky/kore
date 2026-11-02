# KoreCalendar Phase 1: API and Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Go API that stores calendars and events (with full RFC 5545 recurrence, single exclusions, single-occurrence overrides, "this and following" edits), authenticates users and agents, sends reminders, and imports/exports `.ics`, installable with Docker and Caddy.

**Architecture:** Same shape as Kore's `api/`: `net/http` mux, SQLite via `modernc.org/sqlite` with `_txlock=immediate`, embedded SQL migrations, domain packages under `internal/`, one `httpapi` package that wires routes. Recurrence is a pure package (`recur`) with no database; storage and scope logic live in `events`. The web UI (phase 2) and Android app (phase 3) use only the public API defined here.

**Tech Stack:** Go 1.26, SQLite (`modernc.org/sqlite`), `golang.org/x/crypto/argon2`, `github.com/pelletier/go-toml/v2`, `github.com/teambition/rrule-go` (recurrence), `github.com/SherClockHolmes/webpush-go` (Web Push), `github.com/emersion/go-ical` (`.ics`). Confirm each dependency resolves with `go get` in Task 1/5/10/12; if `rrule-go` fails the Task 5 tests that cannot be fixed with the floating-time approach, write the expander by hand and keep the same tests.

**Spec:** `docs/superpowers/specs/2026-11-02-korecalendar-design.md`. Reference code: `~/.t3/projects/kore/api` (conventions) and `~/.t3/projects/zero/docs/api.md` (error shape).

## Global Constraints

- Go 1.26 (`go 1.26.0` in `go.mod`), `net/http` mux, SQLite `modernc.org/sqlite`, DSN uses `_txlock=immediate`; inside a transaction use only the `*sql.Tx`; never hold a transaction open during network or file I/O.
- Module path `github.com/qarasky/korecalendar/api`; binary `korecalendar` (commands `serve` default, `init`, `healthcheck`, as in Kore's `cmd/kore`).
- Every API error is JSON `{"error":{"code":"<stable_code>","message":"<text>"}}` with a proper status; rate-limit errors add `"retryAfterSec"`.
- Another user's data is a **404**, never a 403.
- Auth: `Authorization: Bearer <token>` (personal access tokens, and session tokens returned by login) or the `korecal_session` cookie (HttpOnly, SameSite=Lax, Secure when the request is HTTPS via `X-Forwarded-Proto` from trusted proxies only, as in Kore's Caddyfile).
- Recurrence follows RFC 5545 and expands in the event's own IANA time zone, so a 9:00 event stays at 9:00 across DST. All-day events are dates, not instants.
- Supported rule parts: `FREQ` daily/weekly/monthly/yearly, `INTERVAL`, `COUNT`/`UNTIL`, `BYDAY` incl. ordinals, `BYMONTHDAY`, `BYMONTH`, `BYSETPOS`, `WKST`, and `RDATE`. Hourly and finer are rejected. `.ics` import rejects an event with an unsupported rule with a per-event error and never approximates it.
- Deleted events are soft-deleted and restorable for 30 days. Every event records who last changed it (session user or named token).
- No external resource loads, no Google dependency, no `dangerouslySetInnerHTML`-style shortcuts anywhere (applies to later phases; keep the API free of third-party calls too).
- Do not hand-write generated files. Tests: TDD (failing test first); run `cd api && go vet ./... && go test -race -count=1 ./...` before each commit that touches shared code.

## Review Focus

Failure modes the spec implies that are easy to miss; each has a test in the named task.

1. **DST gap and overlap.** A daily 02:30 rule on a spring-forward day yields exactly one occurrence that day (not zero, not two), and a daily 01:30 rule on a fall-back day yields one. Task 5.
2. **Monthly on day 31.** `FREQ=MONTHLY;BYMONTHDAY=31` skips months without a 31st instead of rolling into the next month. Task 5.
3. **Retried create.** An agent that retries `POST /api/events` with the same `Idempotency-Key` gets the same event back, not a duplicate. Task 6.
4. **Reminder restart.** Restarting the server mid-schedule neither re-sends a reminder already sent nor loses one that came due while it was down (within the catch-up window). Task 9.
5. **Unbounded range or rule.** `GET /api/occurrences` with a huge range, or a rule with no `COUNT`/`UNTIL`, returns a bounded answer or a `range_too_large` error, never hangs or exhausts memory. Task 7.

## Conventions used by every task

- **Wall times.** Event `start`/`end` in the API are local wall-clock strings in the event's `tz`: `"2026-11-04T16:00:00"`, or `"2026-11-04"` for all-day (all-day `end` is exclusive). Occurrences additionally carry `start_utc`/`end_utc` (RFC 3339, `Z`). The **occurrence key** is the occurrence's original (nominal) wall-time start string, used for exclusions, overrides and `occurrence=` parameters (the RFC's `RECURRENCE-ID`).
- **IDs** are random 16-byte hex strings from `users.NewID()` (same pattern as Kore).
- **Migrations** are `api/internal/store/migrations/NNN_name.sql`, applied in order; each task that needs tables adds the next number (the task says which).
- **Test helper:** Task 1 creates `internal/testutil` with `NewDB(t) *sql.DB` (temp SQLite, migrated) and Task 2 adds `NewServer(t) (*httptest.Server, *sql.DB)` plus `Login(t, srv) string` returning a bearer token for a fresh admin; later tasks reuse them.

## File structure

```
api/go.mod, go.sum
api/cmd/korecalendar/main.go          CLI: serve | init | healthcheck
api/internal/config/                  TOML + KORECAL_* env
api/internal/volume/                  data-dir marker (as Kore)
api/internal/store/                   Open + migrations (+ migrations/*.sql)
api/internal/users/                   users table access
api/internal/auth/                    argon2, sessions, tokens, middleware, rate limit
api/internal/calendars/               calendar CRUD
api/internal/recur/                   pure RFC 5545 expansion, validation, split
api/internal/events/                  event/series storage, scoped edit/delete, occurrences, search, changes
api/internal/reminders/               due computation, scheduler, Channel interface, delivery log
api/internal/push/                    Web Push channel, VAPID keys, subscriptions
api/internal/ics/                     import/export
api/internal/httpapi/                 router, handlers, errJSON, idempotency, OpenAPI serving
api/internal/testutil/                shared test helpers
docs/openapi.yaml, docs/api.md        contract and worked examples
Dockerfile (api/), docker-compose.yml, Caddyfile, .env.example, AGENTS.md, README.md
```

---

### Task 1: Scaffold, config, store, volume marker, CLI

**Files:**
- Create: `api/go.mod`, `api/cmd/korecalendar/main.go`, `api/internal/config/config.go`, `api/internal/volume/volume.go`, `api/internal/store/store.go`, `api/internal/store/migrations/001_init.sql`, `api/internal/testutil/testutil.go`, `api/internal/httpapi/httpapi.go`, `AGENTS.md`, `README.md`
- Test: `api/internal/store/store_test.go`, `api/internal/volume/volume_test.go`, `api/internal/httpapi/httpapi_test.go`, `api/cmd/korecalendar/main_test.go`

**Interfaces:**
- Produces: `store.Open(path string) (*sql.DB, error)`; `config.Config{Bind string; Port int; DataDir string; PublicURL string}` and `config.Load(path string) (Config, error)` (env `KORECAL_BIND`, `KORECAL_PORT`, `KORECAL_DATA_DIR`, `KORECAL_PUBLIC_URL` override the file); `volume.Init(dir string) error`, `volume.Check(dir string) error` (marker file `.korecal-volume`); `httpapi.New(db *sql.DB, dataDir string) http.Handler` serving `GET /api/healthz` → 200 `{"ok":true}`; `testutil.NewDB(t *testing.T) *sql.DB`.
- Produces: `errJSON(w http.ResponseWriter, status int, code, msg string)` in `httpapi` (the only way handlers write errors).

- [ ] **Step 1: Write failing tests.** `TestOpenAppliesMigrationsOnce` (open twice on the same path, `schema_migrations` has one row per file); `TestInitWritesMarkerAndCheckRefusesWithout` (`Check` on an empty dir errors, after `Init` passes); `TestHealthz` (GET `/api/healthz` → 200, body `{"ok":true}`); `TestServeRefusesWithoutMarker` (`run(ctx, []string{"-config", cfg}, stderr)` returns non-zero and stderr mentions `korecalendar init`).
- [ ] **Step 2: Run** `cd api && go test ./... ` — Expected: FAIL (packages missing).
- [ ] **Step 3: Implement.** Copy the structure of Kore's `store.Open` (WAL, `foreign_keys(1)`, `busy_timeout(5000)`, `_txlock=immediate`, embedded migrations in a transaction each) and `cmd/kore` `run` (signal-aware, 30 s shutdown grace, `healthcheck` subcommand hitting `/api/healthz`). `001_init.sql` creates `users(id, email UNIQUE NOCASE, pw_hash, role CHECK IN ('admin','user'), timezone TEXT NOT NULL DEFAULT 'UTC', created_at)` and `sessions(token_hash PK, user_id FK ON DELETE CASCADE, expires_at)`. Write `AGENTS.md` (Kore's, adapted: commands, SQLite rules, privacy rule, error shape, "API is the product: no private endpoints") and a short `README.md`.
- [ ] **Step 4: Run** `cd api && go vet ./... && go test -race -count=1 ./...` — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(api): scaffold config, store, volume marker and CLI"`

### Task 2: Accounts, sessions, first-run setup

**Files:**
- Create: `api/internal/users/users.go`, `api/internal/auth/{password,session,ratelimit,middleware}.go`, `api/internal/httpapi/{accounts.go,errors.go}`
- Modify: `api/internal/httpapi/httpapi.go`, `api/internal/testutil/testutil.go`
- Test: `api/internal/auth/auth_test.go`, `api/internal/httpapi/accounts_test.go`

**Interfaces:**
- Consumes: `store.Open`, `errJSON`.
- Produces: `users.Create(ctx, db, email, pwHash, role string) (User, error)`, `users.GetByEmail`, `users.Count`; `auth.HashPassword(pw string) (string, error)`, `auth.VerifyPassword(hash, pw string) bool` (argon2id, timing-equalised for unknown emails as in Kore); `auth.Principal{UserID, Role, Via string; TokenName string}` (`Via` is `"session"` or `"token"`) stored on the request context, read with `auth.FromContext(ctx) (Principal, bool)`; middleware `auth.Require(db) func(http.Handler) http.Handler` accepting cookie `korecal_session` or `Authorization: Bearer <session token>` and answering 401 `unauthorized`; `testutil.NewServer(t) (*httptest.Server, *sql.DB)` and `testutil.Login(t, srv) string` (bearer token of a fresh admin).
- Routes: `POST /api/setup {email,password}` (only while zero users exist, else 409 `setup_closed`; creates the admin, 201 `{token, user}` and sets the cookie), `POST /api/login` → `{token, user}` (401 `bad_credentials`, 429 `rate_limited` with `retryAfterSec`, limits 5 per email|IP and 30 per IP per 15 min as in Kore), `POST /api/logout`, `GET /api/me` → `{id,email,role,timezone}`, `PATCH /api/me {timezone}` (validates with `time.LoadLocation`, else 422 `validation_error`), `POST /api/admin/users {email,password,role}` (admin only; non-admin gets 404 `not_found` — hide the route).

- [ ] **Step 1: Write failing tests.** `TestSetupOnlyOnce` (second setup → 409 `setup_closed`); `TestLoginWrongPasswordAndUnknownEmailSameResponse` (both 401 `bad_credentials`); `TestLoginRateLimited` (6th attempt → 429 with `retryAfterSec > 0`); `TestMeRequiresAuth` (no token → 401 `unauthorized`); `TestPatchMeTimezoneRejectsBogusZone` (`"Mars/Base"` → 422); `TestAdminUsersHiddenFromNonAdmin` (user token → 404); `TestSessionCookieSecureOnlyWhenForwardedHTTPS`.
- [ ] **Step 2: Run** `go test ./internal/auth/ ./internal/httpapi/ -run 'Setup|Login|Me|Admin|Cookie' -v` — Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces; password min length 8; session TTL 30 days; store only the SHA-256 of session tokens (as Kore). Reuse Kore's limiter design (`auth.NewLimiter(max int, window time.Duration)`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): accounts, sessions, first-run setup"`

### Task 3: Personal access tokens

**Files:**
- Create: `api/internal/auth/tokens.go`, `api/internal/store/migrations/002_tokens.sql`, `api/internal/httpapi/tokens.go`
- Modify: `api/internal/auth/middleware.go`
- Test: `api/internal/auth/tokens_test.go`, `api/internal/httpapi/tokens_test.go`

**Interfaces:**
- Consumes: `auth.Principal`, `auth.Require`.
- Produces: `auth.CreateToken(ctx, db, userID, name string) (id, secret string, err error)` (secret is `kcal_` + 32 random bytes base64url, shown once; only its SHA-256 is stored); `auth.ListTokens(ctx, db, userID) ([]TokenInfo, error)` (`TokenInfo{ID, Name string; CreatedAt, LastUsedAt int64}`); `auth.RevokeToken(ctx, db, userID, id string) error` (other user's id → `ErrNotFound`). Middleware now also resolves a `kcal_` bearer to `Principal{Via:"token", TokenName: name}` and updates `last_used_at` at most once per minute.
- Routes: `GET /api/tokens`, `POST /api/tokens {name}` → 201 `{id,name,token}`, `DELETE /api/tokens/{id}` → 204 (404 for others'). A token cannot create or revoke tokens (403 `forbidden`), so a leaked agent token cannot mint new ones **(my call; confirm in review)**.

- [ ] **Step 1: Write failing tests.** `TestTokenAuthenticatesAsOwner` (call `/api/me` with the token → 200, same user); `TestTokenShownOnceAndHashedAtRest` (raw secret not present in the `tokens` table); `TestRevokedTokenRejected` (→ 401); `TestOtherUsersTokenIs404` ; `TestTokenCannotManageTokens` (→ 403 `forbidden`).
- [ ] **Step 2: Run** `go test ./internal/auth/ ./internal/httpapi/ -run Token -v` — Expected: FAIL.
- [ ] **Step 3: Implement** per interfaces; `002_tokens.sql` creates `tokens(id PK, user_id FK CASCADE, name, token_hash UNIQUE, created_at, last_used_at)`.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): personal access tokens for agents"`

### Task 4: Calendars

**Files:**
- Create: `api/internal/calendars/calendars.go`, `api/internal/store/migrations/003_calendars.sql`, `api/internal/httpapi/calendars.go`
- Test: `api/internal/calendars/calendars_test.go`, `api/internal/httpapi/calendars_test.go`

**Interfaces:**
- Produces: `calendars.Calendar{ID, Name, Color string; CreatedAt int64}`; `calendars.Create(ctx, db, userID, name, color string) (Calendar, error)` (color must match `^#[0-9a-fA-F]{6}$`); `List(ctx, db, userID)`; `Update(ctx, db, userID, id string, name, color *string)`; `Delete(ctx, db, userID, id string) error` (soft-deletes its events by cascade rule: deleting a calendar with events returns 409 `calendar_not_empty` unless `?force=1`, then its events are soft-deleted); `calendars.ErrNotFound`. Creating a user (setup or admin) auto-creates a default calendar named `Personal` with color `#5b8def` **(my call)**.
- Routes: `GET/POST /api/calendars`, `PATCH/DELETE /api/calendars/{id}`.

- [ ] **Step 1: Write failing tests.** `TestDefaultCalendarCreatedOnSetup`; `TestOtherUsersCalendarIs404` (GET/PATCH/DELETE); `TestRejectsBadColor` (422 `validation_error`); `TestDeleteNonEmptyNeedsForce`.
- [ ] **Step 2: Run** `go test ./internal/calendars/ ./internal/httpapi/ -run Calendar -v` — Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces; `003_calendars.sql` creates `calendars(id, user_id FK CASCADE, name, color, created_at)`.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): calendars"`

### Task 5: Recurrence engine (pure package)

The riskiest task. No database.

**Files:**
- Create: `api/internal/recur/recur.go`
- Test: `api/internal/recur/recur_test.go`

**Interfaces:**
- Produces:
  ```go
  type Series struct {
      Start, End string   // wall time "2026-11-04T16:00:00", or date "2026-11-04" when AllDay (End exclusive)
      TZ         string   // IANA zone; "" or "UTC" allowed
      AllDay     bool
      RRule      string   // "" for a single event; otherwise e.g. "FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261231T235959Z"
      RDates     []string // extra occurrence starts, same format as Start
      Exdates    []string // occurrence keys to skip
  }
  type Occurrence struct {
      Key, Start, End string    // Key == nominal wall-time start string
      StartUTC, EndUTC time.Time
  }
  var ErrUnsupportedRule, ErrTooManyOccurrences error
  func ValidateRule(rrule string) error                       // wraps ErrUnsupportedRule with the reason
  func Expand(s Series, from, to time.Time, limit int) ([]Occurrence, error) // occurrences overlapping [from,to), sorted; ErrTooManyOccurrences if > limit
  func SplitAt(s Series, key string) (before, after Series, err error)       // "this and following"
  ```
- `SplitAt` semantics: `before` is `s` with `UNTIL` set to just before `key` (a `COUNT` rule is converted to the number of occurrences before `key`), `after` starts at `key` with the same duration, same rule without `UNTIL`/`COUNT` adjusted so the total stays the same, and `Exdates`/`RDates` partitioned by `key`. If `key` is the first occurrence, `before` is the zero Series and the caller treats it as scope "all".

- [ ] **Step 1: Write failing tests (table-driven; each case asserts exact keys).**
  - `TestWeeklyWedFri`: `FREQ=WEEKLY;BYDAY=WE,FR`, start Wed 2026-11-04T16:00 `Europe/Berlin`; keys over 2 weeks are Nov 4, 6, 11, 13.
  - `TestExdateSkipsOnlyThatOccurrence`: `Exdates:["2026-11-05T16:00:00"]` on a Tue/Thu rule drops Nov 5 only.
  - `TestDSTSpringForwardGap` **(Review Focus 1)**: `FREQ=DAILY`, start 2026-03-07T02:30 `America/New_York`; exactly one occurrence on 2026-03-08 (key `2026-03-08T02:30:00`, local hour 3), and 2026-03-09 is 02:30 EDT.
  - `TestDSTFallBackOverlap` **(Review Focus 1)**: daily 01:30 `America/New_York` on 2026-11-01 yields exactly one occurrence (the first, EDT).
  - `TestStaysAtNineAcrossDST`: daily 09:00 `Europe/Berlin` across 2026-10-25 has `StartUTC` 07:00Z before and 08:00Z after.
  - `TestMonthlyDay31SkipsShortMonths` **(Review Focus 2)**: `FREQ=MONTHLY;BYMONTHDAY=31` from 2026-01-31 yields Jan 31, Mar 31, May 31 (no Feb/Apr 30/28 roll-over).
  - `TestSecondTuesday`: `FREQ=MONTHLY;BYDAY=2TU`; `TestLastWeekday`: `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`; `TestYearlyByMonth`: `FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29` skips non-leap years.
  - `TestCountAndUntil`; `TestAllDayEventsAreDates` (an all-day weekly series returns `Start`/`End` as dates; `StartUTC`/`EndUTC` are the start date and exclusive end date at 00:00Z, not shifted by the zone); `TestRDateAddsOccurrence`; `TestMultiDayEventOverlappingRangeIsIncluded`.
  - `TestValidateRuleRejects`: `FREQ=HOURLY`, `FREQ=SECONDLY`, `BYHOUR=9`, `BYWEEKNO=1`, malformed strings → `errors.Is(err, ErrUnsupportedRule)`; accepted: all rule parts in Global Constraints.
  - `TestUnboundedRuleIsBounded` **(Review Focus 5)**: `FREQ=DAILY` over a 20-year range with `limit=500` → `ErrTooManyOccurrences`; over a 30-day range → 30 items, fast (< 50 ms).
  - `TestSplitAt`: weekly rule split at the 3rd occurrence gives `before` ending the day before and `after` starting at the 3rd; a `COUNT=10` rule splits into counts 2 and 8; exdates partition; first occurrence returns zero `before`.
- [ ] **Step 2: Run** `cd api && go test ./internal/recur/ -v` — Expected: FAIL.
- [ ] **Step 3: Implement `Expand`** using `rrule-go`. Algorithm the tests don't determine: run the rule with DTSTART as **floating wall time** (load it in UTC), query a window widened by one day each side, then map every wall time into `TZ` with `time.Date(..., loc)` (this makes the key the nominal wall time and gives Go's DST gap/overlap normalization), then filter by the real `[from,to)` overlap, apply `Exdates`, merge `RDates`, sort, enforce `limit`. Implement `ValidateRule` by parsing then rejecting unsupported `FREQ` and by-parts. Implement `SplitAt` per the semantics above.
- [ ] **Step 4: Run** the same command with `-race` — Expected: PASS.
- [ ] **Step 5: Commit** `git add api/internal/recur api/go.mod api/go.sum && git commit -m "feat(api): recurrence engine with DST-correct expansion and split"`

### Task 6: Events: storage, one-off and series CRUD, versions, idempotency, attribution

**Files:**
- Create: `api/internal/events/{events.go,types.go}`, `api/internal/store/migrations/004_events.sql`, `api/internal/httpapi/{events.go,idempotency.go}`
- Test: `api/internal/events/events_test.go`, `api/internal/httpapi/events_test.go`

**Interfaces:**
- Consumes: `recur.Series`, `recur.ValidateRule`, `auth.Principal`, `calendars.*`.
- Produces:
  ```go
  type Reminder struct{ MinutesBefore int }                   // 0..40320 (28 days)
  type Event struct {
      ID, CalendarID, Title, Notes, Location string
      Start, End, TZ, RRule string; AllDay bool
      Exdates []string; RDates []string
      Reminders []Reminder
      Version int; CreatedBy, UpdatedBy string; CreatedAt, UpdatedAt int64
      DeletedAt *int64
  }
  type Input struct{ CalendarID, Title, Notes, Location, Start, End, TZ, RRule string; AllDay bool; RDates []string; Reminders []Reminder }
  type Actor struct{ UserID, Label string }                   // Label: "user" for sessions, the token name for tokens
  func Create(ctx context.Context, db *sql.DB, a Actor, in Input) (Event, error)
  func Get(ctx context.Context, db *sql.DB, userID, id string) (Event, error)   // soft-deleted → ErrNotFound
  var ErrNotFound, ErrVersionConflict, ErrValidation error
  ```
  `Event.Series()` returns the `recur.Series`. Validation: `end` after `start` (equal allowed only for zero-length all-day? no: require end ≥ start; end == start is allowed for timed events), known `tz`, calendar belongs to the user (else `ErrNotFound`), rule passes `recur.ValidateRule` (→ 422 `unsupported_rrule`), title 1–200 chars.
- Routes: `POST /api/events` → 201 Event; `GET /api/events/{id}`; JSON field names: `id, calendar_id, title, notes, location, start, end, tz, all_day, rrule, rdates, exdates, reminders:[{minutes_before}], version, created_by, updated_by, created_at, updated_at`. `Idempotency-Key` header on `POST /api/events`: same key + same body returns the original response (24 h TTL); same key + different body → 409 `idempotency_conflict`. `ETag: "<version>"` on GET/POST/PATCH responses. `created_by`/`updated_by` are `"user"` or the token name.

- [ ] **Step 1: Write failing tests.** `TestCreateAndGetRoundTrip`; `TestRetryWithSameIdempotencyKeyReturnsSameEvent` **(Review Focus 3)** (two POSTs → same `id`, one row in `events`); `TestIdempotencyKeyDifferentBodyConflicts` (409 `idempotency_conflict`); `TestEndBeforeStartRejected` (422 `validation_error`); `TestUnsupportedRRuleIs422WithCode` (`FREQ=HOURLY` → `unsupported_rrule`); `TestOtherUsersEventIs404`; `TestAttributionRecordsTokenName` (create with a token named "claude" → `created_by == "claude"`); `TestReminderOffsetBounds`.
- [ ] **Step 2: Run** `go test ./internal/events/ ./internal/httpapi/ -run 'Event|Idempot' -v` — Expected: FAIL.
- [ ] **Step 3: Implement.** `004_events.sql`: `events(id PK, user_id FK, calendar_id FK, title, notes, location, start, end, tz, all_day, rrule, version INTEGER NOT NULL DEFAULT 1, created_by, updated_by, created_at, updated_at, deleted_at NULL)`, `event_exdates(event_id, key)`, `event_rdates(event_id, start)`, `event_reminders(event_id, override_key NULL, minutes_before)`, `idempotency_keys(user_id, key, body_sha, status, response, created_at, PRIMARY KEY(user_id,key))` with purge of rows older than 24 h on write. Live predicate is `deleted_at IS NULL` (one shared SQL constant, like Kore's `liveSQL`).
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): events with versions, idempotency and attribution"`

### Task 7: Occurrences, search, range limits

**Files:**
- Create: `api/internal/events/occurrences.go`, `api/internal/httpapi/occurrences.go`
- Modify: `api/internal/store/migrations/` (add `005_overrides.sql`: `event_overrides(event_id, key, title, notes, location, start, end, all_day, deleted_at NULL, PRIMARY KEY(event_id,key))` plus overrides' reminders via `event_reminders.override_key`)
- Test: `api/internal/events/occurrences_test.go`, `api/internal/httpapi/occurrences_test.go`

**Interfaces:**
- Consumes: `events.Get`, `recur.Expand`.
- Produces:
  ```go
  type OccQuery struct{ From, To time.Time; CalendarIDs []string; Text string; Limit int }
  type Occurrence struct {
      EventID, CalendarID, Key, Title, Notes, Location, Start, End, TZ string
      AllDay, IsRecurring, IsOverride bool
      StartUTC, EndUTC time.Time; Reminders []Reminder
  }
  func Occurrences(ctx context.Context, db *sql.DB, userID string, q OccQuery) ([]Occurrence, error)
  var ErrRangeTooLarge error
  ```
- Route: `GET /api/occurrences?from=&to=&calendar_id=&q=` (`from`/`to` RFC 3339; max range 400 days else 400 `range_too_large`; max 5000 results else 400 `range_too_large`; `q` matches title/notes/location, case-insensitive). Merges expansion + exdates + overrides (an override whose new time falls outside the range but whose original key is inside is still found by its new time; a cancelled override is hidden). Sorted by `start_utc`, then `event_id`.

- [ ] **Step 1: Write failing tests.** `TestRecurringExpandedWithExclusionAndOverride` (Wed/Fri series, Thursday excluded, Friday overridden to 18:00 → results show the override with `IsOverride`); `TestOverrideMovedOutOfRangeFollowsNewTime`; `TestRangeOver400DaysRejected` and `TestUnboundedRuleWithinRangeIsBounded` **(Review Focus 5)** (daily no-end rule, 399-day range → ≤ 399 items; 5001+ expansions → `range_too_large`); `TestSearchMatchesTitleAndNotes`; `TestSoftDeletedEventsHidden`; `TestCalendarFilter`; `TestOnlyOwnEventsReturned`.
- [ ] **Step 2: Run** `go test ./internal/events/ ./internal/httpapi/ -run Occurrence -v` — Expected: FAIL.
- [ ] **Step 3: Implement** by loading candidate events for the user (series whose recurrence could touch the window: single events by range overlap in SQL, series by `start <= to`), expanding with `recur.Expand`, then applying overrides.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): occurrence listing and search"`

### Task 8: Scoped edit, delete, restore

**Files:**
- Create: `api/internal/events/scope.go`, `api/internal/store/migrations/006_changes.sql`
- Modify: `api/internal/httpapi/events.go`
- Test: `api/internal/events/scope_test.go`, `api/internal/httpapi/scope_test.go`

**Interfaces:**
- Consumes: `recur.SplitAt`, `events.Get`, `events.Input`.
- Produces:
  ```go
  type Scope string // "this" | "following" | "all"
  type Patch struct{ Title, Notes, Location, Start, End, TZ, RRule *string; AllDay *bool; Reminders *[]Reminder }
  type EditResult struct{ Event Event; Created *Event } // Created is the new series for "following"
  func Update(ctx context.Context, db *sql.DB, a Actor, id string, p Patch, scope Scope, key string, ifMatch *int) (EditResult, error)
  func Delete(ctx context.Context, db *sql.DB, a Actor, id string, scope Scope, key string, ifMatch *int) (Event, error)
  func Restore(ctx context.Context, db *sql.DB, a Actor, id string) (Event, error) // within 30 days else ErrNotFound
  func PurgeDeleted(ctx context.Context, db *sql.DB, olderThan time.Time) (int, error)
  ```
- Routes: `PATCH /api/events/{id}?scope=this|following|all&occurrence=<key>`, `DELETE /api/events/{id}?scope=…&occurrence=…`, `POST /api/events/{id}/restore`. `occurrence` is required for `this` and `following` on a recurring event (400 `validation_error` otherwise); single events accept only `all` (default). `If-Match: "<version>"` is **optional but enforced when sent**: mismatch → 412 `version_conflict` **(my call; confirm in review)**. Scope semantics: `this` DELETE adds an exdate; `this` PATCH writes/replaces an override; `following` splits via `recur.SplitAt` (the new series is returned in `Created`; first occurrence ⇒ behaves as `all`); `all` PATCH changes the master (existing overrides keep their keys unless the master's time-of-day/rule changed, in which case overrides whose key no longer exists are dropped and reported in a `dropped_overrides` array). Every mutation bumps `version`, sets `updated_by`, and appends to `changes` (`seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id, event_id, kind IN ('upsert','delete'), at`). A background purge removes events deleted more than 30 days ago (called from the server's hourly ticker, wired in Task 14).

- [ ] **Step 1: Write failing tests.** `TestDeleteThisAddsExdateOnly` (series remains, `GET /api/occurrences` loses exactly that occurrence); `TestPatchThisCreatesOverride` (moves Friday to 18:00, others unchanged); `TestFollowingSplitsSeries` (original ends before key, `Created` starts at key, edited title only on the new series); `TestFollowingOnFirstOccurrenceEqualsAll`; `TestDeleteAllThenRestore` (restored event identical, version bumped); `TestRestoreAfter30DaysNotFound`; `TestIfMatchMismatchIs412` **(stale version)** and `TestPatchWithoutIfMatchSucceeds`; `TestAllEditDropsOrphanedOverridesAndReports`; `TestScopeThisOnSingleEventRejected`; `TestOtherUsersEventIs404ForEdit`; `TestChangesRowWrittenPerMutation`.
- [ ] **Step 2: Run** `go test ./internal/events/ ./internal/httpapi/ -run 'Scope|Follow|Restore|IfMatch' -v` — Expected: FAIL.
- [ ] **Step 3: Implement** each operation in one short transaction (no I/O inside). `006_changes.sql` creates `changes` and an index on `(user_id, seq)`.
- [ ] **Step 4: Run** the same with `-race` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): scoped edit, delete and restore of recurring events"`

### Task 9: Reminders: due computation, scheduler, delivery log, channels

**Files:**
- Create: `api/internal/reminders/{due.go,scheduler.go,channel.go}`, `api/internal/store/migrations/007_reminders.sql`
- Test: `api/internal/reminders/{due_test.go,scheduler_test.go}`

**Interfaces:**
- Consumes: `events.Occurrences`, `events.Reminder`.
- Produces:
  ```go
  type Due struct{ UserID, EventID, Key, Title, Start string; StartUTC, FireAt time.Time; MinutesBefore int }
  func ComputeDue(ctx context.Context, db *sql.DB, from, to time.Time) ([]Due, error) // FireAt in (from, to]
  type Channel interface { Name() string; Send(ctx context.Context, userID string, d Due) error }
  type Scheduler struct{ /* db, channels, clock, catchUp */ }
  func NewScheduler(db *sql.DB, channels []Channel, now func() time.Time) *Scheduler
  func (s *Scheduler) Tick(ctx context.Context) error // process (cursor, now], advance cursor
  func (s *Scheduler) Run(ctx context.Context)         // Tick every 30 s until ctx is done
  ```
  Persistence: `reminder_deliveries(user_id, event_id, key, minutes_before, channel, state IN ('pending','sent'), PRIMARY KEY(event_id,key,minutes_before,channel))`, and the scheduler cursor in `settings(key, value)` row `reminders.cursor`. Rules: cursor starts at `now` on first run; on restart the window is `(max(cursor, now−10min), now]` (catch-up cap 10 min); a delivery row is inserted `pending` before `Send` and set `sent` after; a `pending` row found on the next tick is retried (at-least-once, deduplicated by the primary key); `Send` errors are logged and leave the row `pending` for up to 3 attempts, then `sent` with a logged failure. `Due` honours exdates, overrides (own reminders when present) and soft deletes, and uses the minimum of `FireAt` windows so it never expands more than `maxOffset` (28 days) beyond `to`.

- [ ] **Step 1: Write failing tests.** `TestDueRespectsOffsetAndExclusion` (recurring event with 30-min reminder, one occurrence excluded → no `Due` for it); `TestOverrideReminderReplacesSeries`; `TestSchedulerSendsOnce` (two `Tick`s over the same window → one `Send`); `TestRestartDoesNotResend` **(Review Focus 4)** (new `Scheduler` on the same DB after a sent reminder → zero `Send`s); `TestRestartCatchesUpWithinTenMinutes` (reminder due 5 min before restart is sent; one due 15 min before is not); `TestPendingRetriedAfterCrash` (row left `pending` → sent once on next tick); `TestFailingChannelGivesUpAfterThreeAttempts`; `TestSoftDeletedEventSendsNothing`. Use a fake clock and a fake `Channel`.
- [ ] **Step 2: Run** `go test ./internal/reminders/ -v` — Expected: FAIL.
- [ ] **Step 3: Implement** per the interface and rules above.
- [ ] **Step 4: Run** `go test -race -count=1 ./internal/reminders/` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): reminder scheduler with restart-safe delivery"`

### Task 10: Web Push channel and subscriptions

**Files:**
- Create: `api/internal/push/{push.go,vapid.go}`, `api/internal/store/migrations/008_push.sql`, `api/internal/httpapi/push.go`
- Test: `api/internal/push/push_test.go`, `api/internal/httpapi/push_test.go`

**Interfaces:**
- Consumes: `reminders.Channel`, `reminders.Due`.
- Produces: `push.New(db *sql.DB) (*Channel, error)` implementing `reminders.Channel` (`Name()` → `"webpush"`); VAPID key pair generated on first start and kept in `settings`; payload JSON `{"title":"<event title>","body":"<time> · in N min","eventId":..,"key":..}`; subscriptions whose endpoint answers 404/410 are deleted.
- Routes: `GET /api/push/key` → `{publicKey}`; `POST /api/push/subscriptions {endpoint, keys:{p256dh,auth}}` → 201 `{id}` (idempotent per endpoint); `DELETE /api/push/subscriptions/{id}` (404 for others').

- [ ] **Step 1: Write failing tests** against an `httptest.Server` acting as the push service: `TestSendDeliversEncryptedPayloadToEveryDeviceOfUser`; `TestGoneSubscriptionIsRemoved` (410 → row deleted); `TestSubscribeIsIdempotentPerEndpoint`; `TestUserCannotDeleteOthersSubscription` (404); `TestVapidKeyStableAcrossRestart`.
- [ ] **Step 2: Run** `go test ./internal/push/ ./internal/httpapi/ -run 'Push|Subscri|Vapid' -v` — Expected: FAIL.
- [ ] **Step 3: Implement** with `webpush-go`; `008_push.sql` creates `push_subscriptions(id, user_id FK CASCADE, endpoint UNIQUE, p256dh, auth, created_at)`.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): Web Push channel and subscription endpoints"`

### Task 11: Change feed for sync

**Files:**
- Create: `api/internal/events/changes.go`, `api/internal/httpapi/changes.go`
- Test: `api/internal/events/changes_test.go`, `api/internal/httpapi/changes_test.go`

**Interfaces:**
- Consumes: the `changes` table from Task 8.
- Produces: `events.Changes(ctx, db, userID string, since int64, limit int) (ChangeSet, error)` with `ChangeSet{Cursor int64; Upserted []Event; Deleted []string; More bool}`; route `GET /api/changes?since=<cursor>&limit=` (default 200, max 1000; `since=0` returns everything live as upserts). Multiple changes to one event collapse to its latest state; an event restored after deletion appears as an upsert. The Android client (phase 3) pairs this with `GET /api/occurrences` for its alarm window.

- [ ] **Step 1: Write failing tests.** `TestChangesCollapsePerEvent`; `TestDeleteAppearsInDeleted`; `TestRestoreAppearsAsUpsert`; `TestPaginationWithMore` (limit 2 over 5 changes, following `Cursor` yields all exactly once); `TestOnlyOwnChanges`.
- [ ] **Step 2: Run** `go test ./internal/events/ ./internal/httpapi/ -run Changes -v` — Expected: FAIL.
- [ ] **Step 3: Implement** the collapse by grouping `changes` on `event_id` with `MAX(seq)`.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): change feed for sync"`

### Task 12: `.ics` import and export

**Files:**
- Create: `api/internal/ics/{import.go,export.go}`, `api/internal/httpapi/ics.go`
- Test: `api/internal/ics/ics_test.go`, `api/internal/httpapi/ics_test.go`, `api/internal/ics/testdata/{google.ics,proton.ics,unsupported.ics}`

**Interfaces:**
- Consumes: `events.Create`, `events.Input`, `recur.ValidateRule`.
- Produces: `ics.Export(events []events.Event, overrides map[string][]events.Override) ([]byte, error)` (VEVENT with `DTSTART;TZID`, `RRULE`, `EXDATE`, `RDATE`, overrides as `RECURRENCE-ID` VEVENTs, `VALARM` for reminders, stable `UID` = event id); `ics.Parse(r io.Reader) ([]ParsedEvent, []ParseError, error)` where `ParseError{Index int; UID, Reason string}`.
- Routes: `POST /api/import?calendar_id=` (body `text/calendar`, max 5 MB) → 200 `{imported: n, errors:[{index,uid,reason}]}` (partial success; unsupported rules appear in `errors`, nothing is approximated); `GET /api/export?calendar_id=` → `text/calendar`. Re-importing the same `UID` updates the existing event instead of duplicating.

- [ ] **Step 1: Write failing tests** with fixture files: `TestRoundTripPreservesRecurrenceExdateOverrideAndReminder` (export then import yields identical occurrences over a year); `TestImportGoogleFixture` (`TZID`, `EXDATE`, `BYDAY=2TU`); `TestImportProtonFixture`; `TestUnsupportedRuleReportedPerEventOthersImported` (`FREQ=HOURLY` event in `errors`, siblings imported); `TestReimportSameUIDUpdates`; `TestOversizeBodyRejected` (413 `payload_too_large`).
- [ ] **Step 2: Run** `go test ./internal/ics/ ./internal/httpapi/ -run 'ICS|Import|Export' -v` — Expected: FAIL.
- [ ] **Step 3: Implement** with `go-ical`; map `VTIMEZONE`/`TZID` to IANA names (fall back to UTC with a per-event warning in the response if unknown).
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(api): ics import and export"`

### Task 13: OpenAPI contract and agent docs

**Files:**
- Create: `docs/openapi.yaml`, `docs/api.md`, `api/internal/httpapi/openapi.go` (embeds the yaml, serves `GET /api/openapi.json` unauthenticated)
- Test: `api/internal/httpapi/openapi_test.go`

**Interfaces:**
- Consumes: every route from Tasks 1–12.
- Produces: `GET /api/openapi.json` (the document converted to JSON at startup); `httpapi.Routes() []string` returning every registered `"METHOD /path"` pattern (the router builds from this list so the test can read it).

- [ ] **Step 1: Write failing tests.** `TestEveryRouteIsDocumented` (each pattern from `Routes()` appears as a path+method in the OpenAPI document); `TestEveryDocumentedOperationIsRouted` (reverse); `TestErrorCodesDocumented` (every code string passed to `errJSON` in the package appears in the document's error-code list; use a source scan via `go/parser` in the test); `TestOpenAPIServedWithoutAuth`; `TestExamplesInApiMdAreValidJSON` (extract fenced `json` blocks from `docs/api.md`).
- [ ] **Step 2: Run** `go test ./internal/httpapi/ -run 'OpenAPI|Documented|Examples' -v` — Expected: FAIL.
- [ ] **Step 3: Write `docs/openapi.yaml`** (OpenAPI 3.1; bearer auth; the wall-time and occurrence-key conventions in a top-level description; stable error codes table: `validation_error, unsupported_rrule, unauthorized, forbidden, not_found, bad_credentials, rate_limited, setup_closed, version_conflict, idempotency_conflict, range_too_large, calendar_not_empty, payload_too_large`) and **`docs/api.md`** with worked curl examples for: creating a token, creating a weekly event with reminders, excluding one occurrence, moving one occurrence, "this and following", listing a week of occurrences, import/export.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git add docs api && git commit -m "docs(api): OpenAPI contract and agent guide"`

### Task 14: Wiring, Docker and Caddy install

**Files:**
- Create: `api/Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`, `korecalendar.example.toml`
- Modify: `api/cmd/korecalendar/main.go` (start scheduler, push channel, hourly purge; graceful stop), `README.md`
- Test: `api/cmd/korecalendar/main_test.go`, `api/internal/httpapi/e2e_test.go`

**Interfaces:**
- Consumes: `reminders.NewScheduler`, `push.New`, `events.PurgeDeleted`, `httpapi.New`.
- Produces: one running binary; Compose stack `caddy` + `api` (the `web` service is added in phase 2, along with `install.sh`, which needs the web image; this is a deliberate deferral from the spec's "Docker/Caddy install" line, to be confirmed in review).

- [ ] **Step 1: Write failing tests.** `TestEndToEndAgentFlow` (in-process server: setup → create token → create weekly event with a 30-min reminder via the token with an `Idempotency-Key` → exclude one occurrence → list occurrences → export `.ics` → import into a fresh calendar → counts match); `TestServeStartsSchedulerAndStopsOnSignal` (cancel the context; `run` returns 0 within the grace period and the scheduler's `Run` has returned, observed through a done channel the test passes in).
- [ ] **Step 2: Run** `go test ./cmd/... ./internal/httpapi/ -run 'EndToEnd|Scheduler' -v` — Expected: FAIL.
- [ ] **Step 3: Implement the wiring.** Dockerfile: multi-stage static build on distroless, as Kore's `api/Dockerfile`, with `HEALTHCHECK` calling `korecalendar healthcheck`. Compose and Caddyfile: Kore's, minus `web` and the share/upload specifics; Caddy stays plain HTTP (`auto_https off`), `handle /api/*` → `api:8080`, `KORECAL_BIND`/`KORECAL_PORT`/`KORECAL_SUBNET` envs, data dir bind mount with `create_host_path: false`. README: install steps, the HTTPS note (browser notifications need HTTPS from a tunnel or Tailscale HTTPS; phone reminders do not).
- [ ] **Step 4: Run** `cd api && go vet ./... && go test -race -count=1 ./... && docker build -t korecalendar-api api/` — Expected: all PASS, image builds. Then `docker compose config -q` — Expected: no output (valid).
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: wire scheduler and push, add Docker and Caddy stack"`

---

## Self-review notes

- **Spec coverage (phase 1 line):** accounts and sessions (T2), calendars (T4), events (T6), full recurrence with exclusions/overrides/this-and-following (T5, T7, T8), occurrence expansion (T7), tokens (T3), OpenAPI (T13), soft delete (T8), `.ics` import/export (T12), reminder scheduler (T9), Web Push (T10), change feed for sync (T11), Docker/Caddy (T14), heavy recurrence/DST tests (T5). Deferred on purpose: `install.sh` (needs the web image, phase 2), CLI/MCP (spec says later phase), Telegram/email (channel interface only).
- **Decisions to confirm in review, all marked "(my call)":** tokens cannot manage tokens (T3); `If-Match` optional-but-enforced (T8); default `Personal` calendar (T4); `install.sh` deferred to phase 2 (T14); first-run `POST /api/setup` instead of Kore's config-file admin bootstrap (T2).
