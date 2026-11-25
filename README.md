# Kore

Small self-hosted apps for one office or one person, with one design system and one sign-in.
Each app runs on its own with Docker; Kore ID signs you in to all of them.

| App | What it does | Path | Install |
|---|---|---|---|
| **Kore Drive** | File server with a Google Drive-style UI: personal and shared spaces, quotas, share links, previews | [`apps/kore-drive`](apps/kore-drive) | [README](apps/kore-drive/README.md) |
| **KoreCalendar** | Personal calendar whose API is the product, with an Android app | [`apps/korecalendar`](apps/korecalendar) | [docs/deploy.md](apps/korecalendar/docs/deploy.md) |
| **Kore ID** | Single sign-on (OpenID Connect) for the Kore apps | [`apps/kore-id`](apps/kore-id) | [README](apps/kore-id/README.md) |
| **KoreMonitor** | Uptime monitoring, live server telemetry and Telegram alerts | [`apps/kore-monitor`](apps/kore-monitor) | [docs/deployment.md](apps/kore-monitor/docs/deployment.md) |
| **kore-ui** | The design system every web UI is built from | [`packages/kore-ui`](packages/kore-ui) | [DESIGN.md](packages/kore-ui/DESIGN.md) |

Images are published to `ghcr.io/qarasky/<image>`; releases are tagged `<app>-vX.Y.Z` on the
[Releases page](https://github.com/qarasky/kore/releases).

## Develop

Requires [Bun](https://bun.sh) (version in `.bun-version`), Node 24 or newer, Go, and for
KoreMonitor Rust.

```sh
bun install        # every JS workspace, one lockfile
bun run check      # typecheck, lint and test everything
bun run build      # build every web app
```

Each app's README covers running it locally. [AGENTS.md](AGENTS.md) has the layout and rules for
working across the apps.
