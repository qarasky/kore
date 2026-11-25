# AGENTS.md

Notes for coding agents working in the Kore monorepo. Read this first, then the `AGENTS.md` of the
app you touch: its rules still apply inside its directory.

## What this is

Kore is a set of small self-hosted apps that share one design system and one sign-in. Each app keeps
its own stack, Docker images and releases; this repo holds them together so one change can reach
every app at once.

| Path | What | Stack | Images (ghcr.io/qarasky/…) |
|---|---|---|---|
| `apps/kore-drive` | File server (personal and shared spaces, share links, previews) | Go API, Next.js web | `kore-api`, `kore-web` |
| `apps/korecalendar` | Calendar whose API is the product; Android app | Go API, Next.js web, Kotlin | `korecalendar-api`, `korecalendar-web` |
| `apps/kore-id` | Single sign-on (OIDC) for every app | Node (TypeScript) server, Vite web | `kore-id` |
| `apps/kore-monitor` | Uptime monitoring, server telemetry, alerts | Rust backend, Go agents, Next.js web | `kore-monitor-backend`, `-web`, `-caddy` |
| `apps/koremind` | Personal assistant (chat, memory, notes); Android app | Bun backend, Next.js web, Kotlin | `koremind-backend`, `koremind-web` |
| `packages/kore-ui` | Design system: tokens (`theme.css`) and React components | React 19, Tailwind 4, Radix | none |

## Design changes start in kore-ui

- `packages/kore-ui/DESIGN.md` is the design source of truth. Change tokens and components there,
  not in an app. Apps depend on it as `"@qarasky/kore-ui": "workspace:*"`, so a change reaches every
  app in the same commit; there is no tag to bump.
- kore-ui ships TypeScript source and CSS with no build step. `theme.css` carries `@source "./src"`,
  so apps must not add their own `@source` for kore-ui.
- After a kore-ui change, run `bun run check` and build every web app (`bun run build`). Then
  `tools/check-kore-ui-css.sh <app>/.next/static` (or kore-id's `web/dist/assets`) confirms Tailwind
  still picked up kore-ui's classes.
- KoreCalendar's Android palette is tested against `packages/kore-ui/theme.css` (`PaletteTest`).
  KoreMind's Android app copies kore-ui's colours by hand (`ui/theme/Theme.kt`, no test): update it
  when a token it uses changes.

## Commands

```sh
bun install                                  # once, at the root: every JS workspace, one bun.lock
bun run check                                # typecheck, lint, test in every JS workspace (Turborepo)
bun run build                                # build every web app
bunx turbo run test --filter=@kore/calendar-web   # one workspace (names below)
bun tools/check-single-copy.ts               # one copy of react, react-dom and next
bun tools/which-workflows.ts <file>...       # which CI workflows a change would run
```

Workspace names: `@qarasky/kore-ui`, `@kore/ui-showcase`, `@kore/drive-web`, `@kore/calendar-web`,
`@kore/id`, `@kore/id-web`, `@kore/monitor`, `@kore/monitor-web`, `@flatline/shared`, `koremind`,
`@koremind/backend`, `@koremind/shared`, `@koremind/web`.

Go, Rust and Gradle keep their own tools: `cd apps/<app>/api && go test ./...`,
`cargo test --manifest-path apps/kore-monitor/backend/Cargo.toml`,
`cd apps/korecalendar/android && ./gradlew testDebugUnitTest` (KoreMind: `apps/koremind/android`),
`cd apps/koremind && bun test backend shared web scripts`. Each app's `AGENTS.md` lists the rest
(e2e suites, smoke scripts).

## Rules for the whole repo

- **Bun is the package manager** (version in `.bun-version`). Never add a `package-lock.json`, never
  run `npm install`. Node runs the Next.js, Vite and Kore ID builds and servers.
- **One version of react, react-dom, next and tailwindcss**: they come from the catalog in the root
  `package.json` (`"catalog:"` in each app). Bump them there, for every app at once.
- `bunfig.toml` keeps `node_modules` hoisted and refuses versions published less than 7 days ago.
  Don't change either to get a fresh release in.
- Hoisting puts every `@types/*` package (including KoreMind's `@types/bun`) in the root
  `node_modules/@types`, and TypeScript loads all of them unless a tsconfig lists `types`. If an
  app's typecheck breaks on a global like `fetch`, give its tsconfig `"types": ["node"]`
  (as KoreCalendar's web app has).
- Next.js apps trace their standalone output from the repo root, so the server is at
  `.next/standalone/<app's path from the root>/server.js` (e.g. `apps/kore-drive/web/server.js`).
  The JS images build from the repo root (`docker build -f apps/kore-drive/web/Dockerfile .`;
  kore-monitor's is `apps/kore-monitor/docker/web.dockerfile`); the Go, Rust and Caddy images build
  from their app directory.
- Image names never change: deployments pull them by name.

## CI and releases

- Workflows live in `.github/workflows/<app>-*.yml`. An app's workflows run when the app changes, and
  every app's CI and web image build also run when `packages/kore-ui`, `package.json`, `bun.lock`,
  `bunfig.toml` or `turbo.json` change. `kore-ui-ci.yml` checks kore-ui, the showcase and `tools/`.
- Pushes to `main` publish `:edge` images. A release is a tag `<app>-vX.Y.Z` (for example
  `korecalendar-v0.4.0`); KoreCalendar for Android uses `korecalendar-android-vX.Y.Z`. KoreMind's
  `koremind-vX.Y.Z` releases the images and the APK together, and updates the rolling release
  `koremind-android-latest` that installed apps read. Tags made
  before the merge kept their history with the same prefixes.
- KoreCalendar has `scripts/release.sh` and `scripts/release-android.sh`; they create the tag and
  print the push command. Don't push tags without being asked.

## History

Each app was its own repository until 2026-11; its history was imported with `git filter-repo`
(`tools/import-repo.sh`, checked by `tools/verify-import.sh`), so `git log --follow` works across the
move. Plans and specs under `apps/*/docs/superpowers/` describe the old layout; read them as history.
