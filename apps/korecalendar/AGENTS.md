# AGENTS.md

Notes for coding agents working on KoreCalendar. Read this first. The design is in
`docs/superpowers/specs/2026-11-02-korecalendar-design.md`; the current plan is in
`docs/superpowers/plans/`.

## What this is

A self-hosted personal calendar whose **API is the product**: an AI agent or script can do
everything the UI can. Same shape as Kore (`~/.t3/projects/kore`): Go API + SQLite, Next.js UI
(phase 2), Caddy in front, Android app (phase 3, done: `android/`, see `docs/android.md`).

- `api/`: Go 1.26, `net/http` mux, SQLite (`modernc.org/sqlite`, opened in `internal/store`). Entry `cmd/korecalendar` (`serve`, `init`, `healthcheck`).
- `web/`: Next.js 16 App Router + React 19 + Tailwind v4 (phase 2, done; animations with `motion`). Server Components fetch through `lib/api.ts`; mutations run in the browser and call `router.refresh()`. See `web/README.md`.
- No private endpoints: the web UI and Android app use only the public API.

## Commands

```sh
cd api && go vet ./... && go test -race -count=1 ./...
cd api && go test ./internal/recur/ -run DST -v      # one package / test
cd web && npm run typecheck && npm run lint && npm test      # unit tests; pure logic lives in web/lib
cd web && npm run e2e                                         # Playwright against the real API (builds both)
cd web && E2E_BASE_URL=http://host:port E2E_RESET_CMD=./reset.sh npx playwright test auth   # against a stack you already run (e.g. Docker behind Caddy)
```

TDD for behaviour: failing test first.

## Rules the code relies on

- **SQLite transactions.** The DSN uses `_txlock=immediate`. Inside a tx use only the `*sql.Tx`. Never hold a tx open during network or file I/O.
- **Live events.** An event is live iff `deleted_at IS NULL`. Use the shared constant, not ad-hoc predicates.
- **Privacy.** Another user's data is a 404, never a 403. This holds for every method under `/dav/` too (`internal/dav`).
- **Errors.** Every API error is `{"error":{"code":"<stable_code>","message":"..."}}` via `errJSON`; codes are documented in `docs/openapi.yaml`.
- **Times.** Event `start`/`end` are local wall-clock strings in the event's `tz`; recurrence expands in that zone. The occurrence key is the nominal wall-time start.
- **Web UI.** Every string goes through `t()` (`web/lib/i18n/en.ts`). The UI is kore-ui (`@qarasky/kore-ui`; its `DESIGN.md` rules): no local copies of its components, no native `<select>` (kore-ui `Select`/`Combobox`), no `dangerouslySetInnerHTML`. Positions on the grid are wall-clock minutes in the user's zone taken from `start_utc`/`end_utc`; never recompute recurrence on the client. A repeat rule the editor can't express (`{kind:"raw"}`) is passed through untouched.
- **Motion.** Durations, easing and the reasons are in `docs/superpowers/specs/2026-11-02-web-motion-design.md` and `web/lib/motion.ts`: nothing longer than 250 ms, no bounce, fades stay under reduced motion. Components use `m` (never `motion`) under `<LazyMotion strict>`; first-load content is never hidden (`initial={false}`); an element that can appear twice must not share a `layoutId`.
- **CalDAV.** `/dav/` (package `internal/dav`, library `go-webdav`) goes through the same `events`/`calendars`/`ics` packages as the REST API; it never writes SQL itself. Auth is HTTP Basic with the email and an **access token** only (not the account password, sessions or cookies). Its protocol errors are XML (authentication, rate-limit and size errors are plain text), outside the OpenAPI contract. See `docs/caldav.md` for what a PUT keeps and drops.
- **Sign-in.** Kore ID (OpenID Connect, `internal/oidc`, `internal/sso`, `httpapi/oidc.go`) is the **only** way in; there is no email + password login, first-run form or password reset. The whole redirect dance lives in the API, never in the web app. A user is keyed on the token's `sub` (`users.oidc_sub`); link to an existing local account by email only as `link_by_email` allows (default `verified`: Kore ID accounts are admin-managed and carry `email_verified: true`). `users.pw_hash` stays for the schema but is never read or written with a real hash (new rows get `users.NoPassword`). Kore ID access tokens are accepted as a session-class bearer only with header `typ: at+jwt` (audience check; id tokens refused). Local sessions keep the Kore ID `sid`; `POST /api/auth/oidc/backchannel-logout` ends them (never `kcal_` tokens). App access is enforced by Kore ID; `kcal_` tokens and CalDAV are unchanged. The first admin comes from `KORECAL_OIDC_OWNER_EMAIL` (or `admin_subs`) on a fresh install. Tests use the fake provider in `internal/oidc/oidctest`. Config keys are listed in `korecalendar.example.toml` and `docs/deploy.md`; keep both, `.env.example` and `docker-compose.yml` in step.
- **Deploying.** `docs/deploy.md` is the operator guide (install, HTTPS, backups, updates). If you change compose, the Caddyfile, `install.sh`, `.env.example` or the data layout, update it.
- **Releasing.** The server (api and web) is versioned as one: tag `vX.Y.Z`, cut with `scripts/release.sh`, published by `.github/workflows/images.yml`. The tag is the only source of the version; the binary gets it from `-ldflags` (`internal/version`). The Android app has its own tags `android-vX.Y.Z`, cut with `scripts/release-android.sh` and published by `.github/workflows/android-release.yml`. See `docs/releasing.md`; update it with any change to the workflows or the scripts.
- **Android.** `android/` (Kotlin, Compose, Glance; design in `docs/superpowers/specs/2026-11-03-android-design.md`; editing planner ported from `web/lib/editPlan.ts`/`rrule.ts`, views from `layout.ts`; reminders are local alarms from the copy, never a push). Device tests (`bash scripts/android-ui-test.sh`) run the real server and seed a session because sign-in is Kore ID only. It uses only the public API; **recurrence is never computed on the phone** (occurrences come from `/api/occurrences`); times show in the account's zone; no sign-in secret is stored (only an app-created access token, sealed with the Android Keystore); every string is in `res/values/strings.xml`; the palette equals the web tokens (`PaletteTest`). Logic lives in plain Kotlin with JVM tests (`agenda/`, `sync/`, `data/`); the contract tests start the real server. Commands: `cd android && ./gradlew lintDebug testDebugUnitTest assembleDebug`.
- **Security posture.** No external resource loads. Never trust client-supplied forwarding headers except from the trusted proxy (see `Caddyfile`).
