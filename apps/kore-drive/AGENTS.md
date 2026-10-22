# AGENTS.md

Notes for coding agents working on Kore. Read this first; `README.md` covers
install/operations, `web/README.md` the web app's file map.

## What this is

A small self-hosted file server for one office (Google-Drive-like): personal
spaces, a shared space, quotas, chunked resumable uploads, trash, search,
previews, admin panel. It runs in production on a real office server, so
correctness and data safety beat cleverness.

- `api/`: Go 1.26, `net/http` mux, SQLite (`modernc.org/sqlite`, opened in `internal/store`). Entry `cmd/kore` (`serve`, `init`, `healthcheck`); routes in `internal/httpapi`; domain packages in `internal/{auth,nodes,uploads,transfer,quota,settings,users,volume,disk}`.
- `web/`: Next.js 16 App Router, React 19, Tailwind v4, SSR. Map of files: `web/README.md`.
- `web/e2e/`: Playwright specs + `harness/` (throwaway API + production web build).
- `Caddyfile`, `docker-compose.yml`: production stack (Caddy -> web / api).
- `docs/superpowers/`: specs, plans, HTML mockups.

## Commands

```sh
# API
cd api && go vet ./... && go test -race -count=1 ./...
cd api && go test ./internal/httpapi/ -run Branding     # one package / test

# Web
cd web && npm ci
cd web && npm run typecheck && npm run lint && npx vitest run
cd web && npx vitest run lib/__tests__/branding.test.ts
cd web && npx playwright test e2e/browse.spec.ts          # one spec (builds first)
cd web && E2E_SKIP_BUILD=1 npx playwright test e2e/x.spec.ts   # reuse last e2e build
cd web && npm run e2e                                      # full suite: only before releases
```

`npx next typegen` creates the `PageProps`/`LayoutProps` globals if
`typecheck` complains about them on a fresh checkout. One-time:
`npx playwright install chromium`. The e2e build overwrites `web/.next`; do
not run it next to `npm run dev`.

Testing conventions: TDD for behaviour (failing test first). Run targeted
tests for what you touched; the full Playwright suite is slow and is for
release checks. E2E against a deployment: `E2E_BASE_URL` (see `web/README.md`).

## Architecture rules the code relies on

**SQLite transactions.** The DSN uses `_txlock=immediate`, so `BEGIN` takes
the write lock. Inside a tx use only the `*sql.Tx` (calling `s.db` there
deadlocks or races). Never hold a tx open during file I/O (copying, hashing,
fsync): do the file work first, then a short tx. Blob files are deleted only
after the tx that unlinks them has committed.

**Live nodes.** A node is live iff `trashed_at IS NULL AND trash_root IS NULL`
(`nodes.liveSQL`). Listings, search, sizes and moves use that predicate.

**Personal space privacy.** Another user's personal node is a 404, never a
403 (don't leak existence). Admins see per-user totals only, never names of
other users' files.

**Quota.** Counted per uploader: every file they uploaded (shared space and
trash included, until purged) plus the declared size of their open uploads
(reservations). Moving into a personal space re-attributes to its owner and is
checked in the same tx (`quota.Reserve`).

**Errors.** Every API error is JSON `{"error":"<code>"}` with a proper status
(`errJSON`); the web maps codes to messages in `lib/*.ts` + `en.ts`.

**Auth and proxies.** Session cookie `kore_session` (HttpOnly, SameSite=Lax,
Secure when the request is HTTPS). Caddy is the only published service and
trusts `X-Forwarded-*` / `CF-Connecting-IP` only from the Docker host
(`KORE_SUBNET`); the API uses `CF-Connecting-IP` for login rate limits. Don't
add code that trusts client-supplied headers elsewhere.

**Security posture.** No external resource loads (fonts, images, scripts,
CDNs): everything is bundled or inline. Uploaded files never execute in our
origin: downloads are `attachment` + `nosniff`; inline views (images, PDF,
login picture) set a sniffed/allowlisted `Content-Type`, `nosniff` and a
restrictive CSP (`sandbox`). Nothing user-controlled becomes a filesystem path
(blobs are addressed by generated ids) or reaches an HTML sink.

## UI conventions

- Every UI string lives in `web/lib/i18n/en.ts`, read with `t(key, vars)`.
- Use the custom `components/Select.tsx`; native `<select>` is banned (a unit
  test enforces it). No `dangerouslySetInnerHTML`.
- Design tokens in `web/app/globals.css` `@theme` (dark only): bg `#16181d`,
  surface `#1d2026`, raised `#23262d`, border `#2c3038`, text `#e6e8ee`,
  muted `#8a8f9a`, accent `#5b8def`, radius 6px. Sizes are tokens too:
  `text-meta/sub/heading/title`, `h-row` (48px rows), `min-h-control`
  (40px controls), `size-icon`. Use them instead of pixel literals.
- Data pages are Server Components fetching via `api()` with the session
  cookie; mutations call the API from the client, then `router.refresh()`.
- Error boundaries: use `retry()` (re-fetches the server payload, Next 16.3+),
  not `reset()` (re-renders the stale error).

## Deployment notes

- `docker compose` stack: `caddy` (published), `web`, `api`; data dir bind
  mounted at `/data` with `create_host_path: false`.
- `kore init` writes the `.kore-volume` marker (+ `blobs/`, `tmp/uploads/`);
  the API refuses to start without it. Never auto-create the data dir or the
  marker: an unmounted RAID must fail loudly, not look like a fresh install.
- Migrations run on start. Caddy's admin API is off: restart it after
  `Caddyfile` changes.

## Gotchas learned

- Git does not track empty dirs: `web/public/.gitkeep` exists so the Docker
  build's `COPY public` works on a fresh checkout.
- Next 16 renamed `middleware.ts` to `proxy.ts`. Its matcher must exclude
  public assets the login page needs (e.g. `icon.svg`), or logged-out users
  get redirected to `/login` for them.
- `web/AGENTS.md` contains a block that `next dev` re-adds; leave it.
- Docker Desktop (macOS/Windows) bind mounts go through a VM file share:
  ownership (`KORE_UID`/`KORE_GID`), permissions and missing-path behaviour
  differ from Linux. Verify deployment changes on Linux.
- E2E tests share one API (one worker, shared login rate limiter): give
  shared-space items unique names and don't depend on global state.
