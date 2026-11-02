# AGENTS.md

Notes for coding agents working on KoreCalendar. Read this first. The design is in
`docs/superpowers/specs/2026-11-02-korecalendar-design.md`; the current plan is in
`docs/superpowers/plans/`.

## What this is

A self-hosted personal calendar whose **API is the product**: an AI agent or script can do
everything the UI can. Same shape as Kore (`~/.t3/projects/kore`): Go API + SQLite, Next.js UI
(phase 2), Caddy in front, Android app (phase 3).

- `api/`: Go 1.26, `net/http` mux, SQLite (`modernc.org/sqlite`, opened in `internal/store`). Entry `cmd/korecalendar` (`serve`, `init`, `healthcheck`).
- No private endpoints: the web UI and Android app use only the public API.

## Commands

```sh
cd api && go vet ./... && go test -race -count=1 ./...
cd api && go test ./internal/recur/ -run DST -v      # one package / test
```

TDD for behaviour: failing test first.

## Rules the code relies on

- **SQLite transactions.** The DSN uses `_txlock=immediate`. Inside a tx use only the `*sql.Tx`. Never hold a tx open during network or file I/O.
- **Live events.** An event is live iff `deleted_at IS NULL`. Use the shared constant, not ad-hoc predicates.
- **Privacy.** Another user's data is a 404, never a 403.
- **Errors.** Every API error is `{"error":{"code":"<stable_code>","message":"..."}}` via `errJSON`; codes are documented in `docs/openapi.yaml`.
- **Times.** Event `start`/`end` are local wall-clock strings in the event's `tz`; recurrence expands in that zone. The occurrence key is the nominal wall-time start.
- **Security posture.** No external resource loads. Never trust client-supplied forwarding headers except from the trusted proxy (see `Caddyfile`).
