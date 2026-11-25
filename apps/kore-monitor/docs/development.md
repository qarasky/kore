# Development

Running KoreMonitor locally: the dev stack, the checks to run before a change,
and the repository layout. For shipping a release, see [deployment](deployment.md).

## Prerequisites

| Tool       | Needed for                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `cargo`    | The Rust backend.                                                                                        |
| `go`       | The agent and the mock fleet.                                                                            |
| Node + npm | The web app: its dev server, tests, build and production server. The backend and agents do not use Node. |
| `docker`   | Only if you want to build or run the container images.                                                   |

## The local stack

```bash
./dev.sh          # start (or restart) everything
./dev.sh status   # backend and web app health
./dev.sh logs     # tail every log
./dev.sh stop     # stop everything
```

`dev.sh` builds and starts three things, detached, logging to `.dev-logs/`:

| Process        | Port | Notes                                                                                                                      |
| -------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| Backend        | 3001 | Binds `0.0.0.0` and runs migrations; first Kore ID sign-in provisions an operator account.                                 |
| Web app (Next) | 3003 | `next dev`. Rewrites `/api` and `/agent` to the backend (`next.config.ts`), so the browser is same-origin as behind Caddy. |
| Mock fleet     | none | `superboard/mockagent`: creates a demo fleet through the public API and pushes telemetry.                                  |

There is no Caddy in development: open the web app on `:3003`. The backend's
other paths (`/healthz`, `/add-push-server.md`, `/llms.txt`) are on `:3001`.

It also builds the agent binary into `.dev-data/agent/` so the download endpoints
work locally. Sign in with Kore ID; the mock fleet needs an operator API token
in `KOREMONITOR_TOKEN` (mint one in **Tokens**) because it creates its demo hosts
through the API.

The mock fleet is the reason the board is never empty during development: it
creates hosts across every card state, a few demo websites linked to the servers
that host them, and leaves agent warnings on two hosts so the "Clear agent
warnings" action and the website picker have something to show.

Local state (`.dev-data/`, `.dev-logs/`) is disposable and Git-ignored. Delete it
to get a cold start; that is also the cheapest way to exercise migrations from
scratch.

### Running the pieces by hand

```bash
# backend
cargo run --manifest-path backend/Cargo.toml
# or a release build
DATA_DIR=./data cargo run --release --manifest-path backend/Cargo.toml

# web app (expects a backend on :3001; API_URL overrides that)
cd apps/web && npm ci && API_URL=http://127.0.0.1:3001 npx next dev --port 3003
# or a production build (next start warns about the standalone output and runs
# anyway; the image runs the standalone server instead)
npm run build:web && (cd apps/web && npx next start --port 3003)

# agent, one collection to stdout (after `superboard install` has written
# /etc/superboard/config.json, or with --config PATH)
cd superboard && go run . check --verbose
```

## Tests and builds

| What              | Command                                                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting        | `npm run fmt` (write), `npm run fmt:check` (verify). Prettier 3 covers TS/TSX, JS/MJS, CSS, JSON, Markdown and YAML.                                                                                                                                                        |
| Backend tests     | `cargo test --manifest-path backend/Cargo.toml` (unit tests plus integration tests in `backend/tests/`).                                                                                                                                                                    |
| Web app tests     | `npm run test:web` (Vitest over `apps/web/__tests__/`, including the ported modules in `__tests__/ported/`).                                                                                                                                                                |
| Web app types     | `npm run typecheck:web`                                                                                                                                                                                                                                                     |
| Web app build     | `npm run build:web` (Next.js standalone output).                                                                                                                                                                                                                            |
| Agent build + vet | `cd superboard && go build ./... && go vet ./...`                                                                                                                                                                                                                           |
| Agent tests       | `cd superboard && go test ./...`                                                                                                                                                                                                                                            |
| Backup agent      | `cd backup-agent && go test ./... && go vet ./...` (add `-race`)                                                                                                                                                                                                            |
| Restore fixture   | `KOREMONITOR_BACKUP_INTEGRATION=1 go -C backup-agent test ./integration -v` (Docker + postgres:16)                                                                                                                                                                          |
| Images            | From the repository root: `docker/rust.dockerfile` (backend), `docker/web.dockerfile` (web app; `--build-arg KOREMONITOR_BUILD_ID=<commit>`), `docker/caddy.dockerfile` (Caddy with the Caddyfile baked in and validated). `docker compose up -d --build` builds all three. |

Run the formatter check, the backend tests, the web app tests, its typecheck
and its build before calling a change done; that is the set releases are
verified with.

## Repository layout

| Path                    | What                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| `backend/src/api/`      | HTTP surface: routers, handlers, `openapi.json`.                       |
| `backend/src/monitors/` | Check engine.                                                          |
| `backend/src/metrics/`  | Ingest, live cache, archival, rollups, alerts, history.                |
| `backend/migrations/`   | Ordered SQL migrations.                                                |
| `backend/tests/`        | Integration tests against a real SQLite database in a temp dir.        |
| `superboard/`           | The Go agent (`mockagent/` is the dev fleet).                          |
| `backup-agent/`         | The separate backup agent and its offline/restore tests.               |
| `apps/web/app/`         | Next.js routes: the admin sections, Superboard, status pages, sign-in. |
| `apps/web/components/`  | UI components, built from kore-ui (`@qarasky/kore-ui`).                |
| `apps/web/lib/`         | Pure logic and API clients that the tests cover.                       |
| `apps/web/__tests__/`   | Vitest tests; `ported/` holds the old dashboard's tests.               |
| `packages/shared/`      | The status-page client and types the web app uses.                     |
| `docker/`               | Dockerfiles, the Caddyfile, the backup compose file.                   |
| `docs/`                 | These documents.                                                       |

### Web app

`apps/web/` is the operator UI, the Superboard and the status pages (routes,
sections and the sign-in flow are in [web app](dashboard.md)). It uses the App
Router with server rendering, Tailwind CSS 4 and the Kore design system
`@qarasky/kore-ui` (tokens via `app/globals.css`). Signed-in pages forward the
`fl_session` session cookie from the server to the backend at `API_URL`
(default `http://127.0.0.1:3001`); in the browser they call the same origin,
which Caddy routes to the backend in production and `next.config.ts` rewrites
to it in development.

Kore ID is the **only** sign-in; with `KORE_ID_ISSUER` unset the page says no
sign-in method is configured. On a fresh database the first Kore ID sign-in
provisions a full operator account, and **Members** (`/members`) lists those
accounts and removes them, optionally revoking the tokens they made.

The board's pure logic and URL state live in `apps/web/lib/` (`board-model.ts`,
`board-url.ts`, `board-keys.ts`, `fleet-presentation.ts`), including the modules
ported from the old dashboard, with tests in `apps/web/__tests__/` and
`apps/web/__tests__/ported/`. Open tabs notice a deploy through `GET /build`
(the build id): the kiosk and status pages reload, admin pages offer Reload.
For local status pages, add rows to `status_pages` (there is no API to create
one).

## Conventions

- **TypeScript/React**: formatted by Prettier (4-space indent, double quotes,
  `[ a, b ]` collapsed to `[a, b]`). Run `npm run fmt` before committing and
  `npm run fmt:check` to verify. Effects and callbacks are named, and every
  non-obvious decision is explained by a comment that says _why_. Pure
  formatting and presentation logic belongs in `apps/web/lib/` so it can be
  unit tested without a DOM.
- **Rust**: modules keep their public surface small; functions that talk to the
  database return the API error type rather than panicking; comments explain the
  contract, not the syntax. The tree is rustfmt-formatted: run `cargo fmt` in
  `backend/` (or `cargo fmt --check`) before committing.
- **Go**: `gofmt` clean, one collector per file, best-effort collectors return
  "unavailable" rather than failing a sample.
- **Markdown, JSON, YAML and CSS** are Prettier-formatted too; `.prettierignore`
  lists what is left alone (lockfile, local state, build output).

## Changing things

- **A migration**: add `backend/migrations/NNNN_name.sql`, additive where
  possible (`ALTER TABLE … ADD COLUMN` with a default). It is applied
  automatically at startup and recorded in `_sqlx_migrations`; the backend
  refuses to start against a database that contains migrations it does not know,
  which is what makes a rollback need the matching database.
- **An API route**: register it in `backend/src/api/mod.rs` and document it in
  `backend/src/api/openapi.json`: that document is served at
  `/api/v1/openapi.json` and is the API's contract. A route outside `/api/*`
  and `/agent/*` also needs a place in Caddy's `@backend` matcher
  (`docker/Caddyfile`); `backend/tests/caddy_routes.rs` fails until it has
  one.
- **The provisioning runbook**: edit `docs/provisioning.md`. It is compiled into
  the binary with `include_str!` and copied to `/docs/provisioning.md` in the
  image; if either path changes, both the Rust path and the Dockerfile `COPY`
  must change together.
- **A new agent config key**: add it to `superboard/config.go` with a default,
  then document it in [agent](agent.md).
- **A card change**: the pure logic lives in
  `apps/web/lib/fleet-presentation.ts` with tests in
  `apps/web/__tests__/ported/`; keep the visual rules there rather than in the
  component.
- **Anything user-visible**: update the relevant document in `docs/` in the same
  change. The deployment record for shipped work is
  [deployment](deployment.md).

## Releasing

Commits land on `master`; there is no release branch. A release is: run the
checks above, commit, push, then deploy following
[deployment](deployment.md), including the database backup that a rollback would
need.
