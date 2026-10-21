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
| `lib/upload.ts` | `uploadFile()`: chunked (8 MiB default), resumable upload over `/api/uploads` with retries, abort and a localStorage resume key |
| `lib/uploadQueue.ts`, `components/UploadContext.tsx`, `components/UploadTray.tsx` | App-wide upload queue (3 files at a time), the bottom-right tray, `router.refresh()` when it drains, leave-page warning |
| `lib/dropEntries.ts`, `components/DropZone.tsx` | OS file/folder drops and folder `<input>` picks: walks directory trees, recreates folders (`POST /api/nodes`), queues files |
| `lib/moveDrag.ts`, `hooks/useMoveNodes.ts`, `hooks/useDropTarget.ts` | Row drag-to-move onto folder rows, breadcrumbs and the sidebar's My files / Shared space |
| `components/MoveDialog.tsx`, `lib/moveTo.ts` | Explicit moves: "Move to Shared space" / "Move to My files" (context menu, to the other space's root) and "Move to…" (context menu, toolbar button while something is selected, `M`): a folder picker over both spaces. Result toasts name the destination and offer a best-effort Undo |
| `components/PreviewPane.tsx`, `hooks/usePreview.tsx`, `lib/preview.ts` | Quick look for text files (Enter / double-click / Space; Esc or Space closes; ←/→ between text siblings). `lib/preview.ts` mirrors the server's text allowlist so binaries download without a request; a 415 from `/preview` still falls back to download |
| `components/StorageMeter.tsx`, `components/StorageDialog.tsx`, `lib/storage.ts` | The sidebar meter opens "Storage": usage by file type from `/api/me/usage/breakdown`, the trashed part (link to the trash) and the largest files (links to their folder with the file selected) |
| `components/TextView.tsx`, `components/MarkdownView.tsx` | Plain text with optional line numbers/wrap (chunked with `content-visibility`); markdown via `react-markdown` + GFM, no raw HTML, links limited to http(s)/mailto/`#` (`safeLinkHref`), images never loaded |
| `components/Select.tsx`, `lib/listbox.ts` | The one select control (no native `<select>` anywhere; a unit test enforces it): select-only combobox + listbox, keyboard/type-ahead, popup portaled into the enclosing `<dialog>` so modals keep it in their top layer. E2E helper: `chooseOption(scope, label, option)` |
| `components/Modal.tsx`, `components/ConfirmDialog.tsx` | Native `<dialog>` modal (inert background, Esc, focus returns to the opener) and a yes/no confirmation on top of it |
| `app/(app)/trash/`, `components/TrashList.tsx` | My trash / Shared trash (`?space=shared`): restore, delete forever, empty trash (confirmed), retention note from `GET /api/me/settings` |
| `app/(app)/search/`, `components/SearchResults.tsx`, `lib/search.ts` | `/search?q=`: hits with their location; a file opens its folder with `?select=<id>` (folder pages select and scroll to that row) |
| `app/(app)/admin/` (`page`, `users/`, `settings/`), `components/admin/` | Admin area, admins only (`requireAdmin()` in the layout and every page; everyone else gets the 404 page). Overview (the Disk card from `/api/admin/disk`, `components/admin/DiskCard.tsx` + `lib/disk.ts`; totals, a usage bar per user from `/api/admin/usage`), Users (add with generated one-time password, edit email/role/quota, reset password, delete with the `user_has_files` explanation and the typed-email `?files=purge` path), Settings (retention, max file size, default quota; inline range checks, unsaved-changes note) |
| `app/(app)/account/`, `components/ChangePasswordForm.tsx` | Every user's account page: own usage and change password (the API sets a fresh session cookie, so this browser stays signed in) |
| `lib/size.ts`, `lib/password.ts`, `lib/admin.ts` | Size input parsing/splitting in binary units labelled GB/TB like `formatBytes`; password rules (UTF-8 bytes, as the API counts), hints and generator; admin API types and error-code messages |
| `lib/download.ts` | Downloads via a hidden form into a hidden iframe (browser streams to disk; errors become a toast) |
| `lib/format.ts`, `lib/nodes.ts` | Size/date formatting, node types, hrefs, file kinds |
| `app/globals.css` | Design tokens (`@theme`) and base styles; dark only |
| `lib/api.ts` | `api<T>(path, init)`: server calls go to `API_URL` with the cookie, browser calls go to same-origin `/api`; errors throw `ApiError{status, code}`. `apiText()` is the same for `text/plain` endpoints (the preview) and returns `{text, truncated}` |
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

### Against a running deployment (Docker Compose)

Set `E2E_BASE_URL` to run the suite against an already running stack instead
of starting its own servers; UI and `/api` must be served on that one origin
(as Caddy does). Give it a fresh data dir, and tell it the admin account from
that stack's `kore.toml`:

```sh
# from the repo root, with kore.toml (admin@kore.test / admin-password-123),
# .env (KORE_DATA_DIR pointing at an empty throwaway dir) and `kore init` done:
docker compose up -d --build
cd web
E2E_BASE_URL=http://localhost:8080 \
E2E_ADMIN_EMAIL=admin@kore.test E2E_ADMIN_PASSWORD=admin-password-123 \
npm run e2e
```

The two API-outage tests need the harness's second web instance and are
skipped in this mode.

Tests run with one worker because they share one API (and its login rate
limiter). Helpers in `e2e/helpers.ts`:

- `loginAs(page, email, password)`: logs the page's browser context in via the API.
- `createUser({ email?, password?, role?, quota_bytes? })`: creates a user via the admin API.
- `apiAs(email, password)`: an API request context logged in as that user.
- `createFolder(api, name, { space?, parent_id? })`: creates a folder, returns its id.
- `uploadFile(api, name, content, { space?, parent? })`: uploads a small (< 1 MiB) file (string or `Buffer`) in one chunk, returns its id.

Upload chunk size can be overridden per browser with
`localStorage.koreChunkBytes` (clamped to 256 KiB to 64 MiB); `e2e/dnd.spec.ts`
uses it to upload in 1 MiB chunks.

Note: the e2e build overwrites `.next`; don't run it alongside `npm run dev`.
