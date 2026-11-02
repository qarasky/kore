# KoreCalendar web

The web UI: Next.js 16 (App Router, React 19), Tailwind v4, server-rendered, no external resources. It uses only the public API
(see [`../docs/api.md`](../docs/api.md)); what it does is described in [`../docs/web.md`](../docs/web.md).

```sh
npm ci
npm run dev                 # needs the API on http://127.0.0.1:8080 (API_URL overrides it)
npm run typecheck && npm run lint && npm test      # unit tests (pure logic in lib/)
npm run e2e                 # Playwright against the real Go API; see below
```

- `lib/` is pure logic with unit tests (dates and time zones, layout, recurrence editing, drag geometry, shortcuts).
- `components/` are the pieces; every string comes from `lib/i18n/en.ts` through `t()`.
- Server Components fetch with `lib/api.ts` (forwarding the session cookie); mutations are made in the browser and followed by `router.refresh()`.
- Do not use a native `<select>`; use `components/Select`. Do not use `dangerouslySetInnerHTML`.
- Motion: `lib/motion.ts` holds the tokens (durations, easing, stagger, push direction) with unit tests; components use `m` from `motion/react` under `LazyMotion strict`. See [the motion design](../docs/superpowers/specs/2026-11-02-web-motion-design.md).

## End-to-end tests

`npm run e2e` builds the Go API into `$TMPDIR/korecal-e2e`, builds the production web app, starts both (API on 18180, web on 13100) and
runs every spec in `e2e/` against them, resetting the API's data per file. `E2E_SKIP_BUILD=1` reuses an existing web build. Chromium must be
installed once: `npx playwright install chromium`. To test a stack that is already running (for example the Docker install behind Caddy) set `E2E_BASE_URL` and `E2E_RESET_CMD` (a shell command that leaves the API empty); specs that must stop the API process skip themselves then.
