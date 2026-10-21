# Kore web

Next.js (App Router, SSR) UI for Kore. Every data page is a Server Component
that fetches from the Go API with the user's `kore_session` cookie.

## Layout

| Path | What |
| --- | --- |
| `app/(auth)/login/` | Login page (server) + `login-form.tsx` (client) |
| `app/(app)/layout.tsx` | App shell: top bar (search, account menu), sidebar (+ New, sections, storage meter) |
| `app/(app)/files/[[...folder]]/`, `shared/[[...folder]]/` | File browser: `/files`, `/files/<folderId>`, `/shared`, `/shared/<folderId>` (SSR; more segments are a 404) |
| `components/FolderPage.tsx`, `lib/folder.ts` | Server side of a folder view: loads path + children, 404 only on API 404, redirects ids from the other space |
| `components/FileList.tsx` | Client listbox: selection, keyboard, inline rename, context menu (`FileRow`, `NameEditor`, `ContextMenu`, `Menu`) |
| `hooks/useFileActions.ts`, `hooks/useSelection.ts` | Mutations (API call, then `router.refresh()`) and selection state over the pure `lib/selection.ts` |
| `lib/download.ts` | Downloads via a hidden form into a hidden iframe (browser streams to disk; errors become a toast) |
| `lib/format.ts`, `lib/nodes.ts` | Size/date formatting, node types, hrefs, file kinds |
| `app/globals.css` | Design tokens (`@theme`) and base styles; dark only |
| `lib/api.ts` | `api<T>(path, init)`: server calls go to `API_URL` with the cookie, browser calls go to same-origin `/api`; errors throw `ApiError{status, code}` |
| `lib/session.ts` | `requireUser()`: validates the session via `/api/auth/me`, redirects to login on 401 |
| `lib/safe-next.ts` | Sanitizes the post-login `next` redirect (same-origin relative paths only) |
| `lib/i18n/` | `en.ts` holds every UI string; `t(key, vars?)` reads from `index.ts` |
| `app/error.tsx`, `app/global-error.tsx` | Styled error pages (API unreachable vs. generic) with a retry button |
| `proxy.ts` | Next 16 "proxy" (formerly `middleware.ts`): cookie-presence auth gate |

## Development

```sh
npm install
# Go API on 127.0.0.1:8080 (see ../api and ../kore.example.toml), then:
npm run dev            # http://localhost:3000, /api/* rewritten to API_URL
```

`API_URL` (default `http://127.0.0.1:8080`) is where the Go API listens. It
is used at runtime by server-side `api()` calls, and at build time for the
`/api/:path*` rewrite in `next.config.ts`. In production Caddy routes `/api`
to the Go service before requests reach Next, so the rewrite is unused there.

## Translations

All copy lives in `lib/i18n/en.ts`; components never contain UI string
literals. To add a locale, create e.g. `ru.ts` typed as `Messages`, register it
in `lib/i18n/index.ts` and resolve it in `activeLocale()`.

## Tests

```sh
npm run test        # vitest unit tests (lib/__tests__)
npm run e2e         # Playwright against the real stack
npm run lint
npm run typecheck
```

One-time setup for e2e: `npx playwright install chromium`. Go must be on `PATH`.

`npm run e2e` starts two servers (see `playwright.config.ts`):

- `e2e/harness/api-server.ts`: builds `../api/cmd/kore` into `$TMPDIR/kore-e2e`,
  wipes and creates a fresh data dir, writes a `kore.toml` (127.0.0.1:18080,
  admin `admin@kore.test` / `admin-password-123`), runs `kore init`, then
  serves the API. The directory is removed on exit and wiped again on the
  next start, so every run begins with an empty database.
- `e2e/harness/web-server.ts`: `next build` with `API_URL=http://127.0.0.1:18080`,
  then serves the production standalone server (`.next/standalone/server.js`)
  on 127.0.0.1:13000. A production build is used instead of `next dev` so tests
  exercise what ships and are not slowed or flaked by on-demand compilation.
  `E2E_SKIP_BUILD=1 npm run e2e` reuses the previous e2e build. A second
  instance of the same build runs on 127.0.0.1:13001 with its runtime
  `API_URL` pointed at a closed port, for API-outage tests (`E2E.webDownUrl`;
  cookies are per host, so a session from :13000 works there).

Tests run with one worker because they share one API (and its login rate
limiter). Helpers in `e2e/helpers.ts`:

- `loginAs(page, email, password)`: logs the page's browser context in via the API.
- `createUser({ email?, password?, role?, quota_bytes? })`: creates a user via the admin API.
- `apiAs(email, password)`: an API request context logged in as that user.
- `createFolder(api, name, { space?, parent_id? })`: creates a folder, returns its id.
- `uploadFile(api, name, content, { space?, parent? })`: uploads a small (< 1 MiB) file in one chunk, returns its id.

Note: the e2e build overwrites `.next`; don't run it alongside `npm run dev`.
