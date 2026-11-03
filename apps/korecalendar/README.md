<img src="assets/icon.svg" width="64" height="64" alt="">

# KoreCalendar

A small self-hosted personal calendar whose **API is the product**. An AI agent or a script can do everything the UI can: create
and manage events, recurring series with single exclusions and single-occurrence changes, reminders, and `.ics` import and export.
Go API + SQLite and a Next.js web app behind Caddy, in the same shape as [Kore](https://github.com/qarasky/kore). The web app
(and the Android app) uses exactly the same public API.

Status: **phase 1 (API and core), phase 2 (web app) and CalDAV are done;** the **Android app** is in progress (stage 3 of 4: agenda, day/week/month views, search, home-screen widget and editing; see [docs/android.md](docs/android.md)). See [`docs/`](docs/README.md) for everything below in detail.

- **[Deploying on Linux](docs/deploy.md)**: install, HTTPS, updates, backups, troubleshooting.
- **[Web app](docs/web.md)**: what the UI does, shortcuts, drag behaviour, motion, notifications.
- **[API guide](docs/api.md)**: real requests and responses for the common jobs.
- **[OpenAPI contract](docs/openapi.yaml)**: also served at `GET /api/openapi.json`, no login needed.
- **[Android app](docs/android.md)**: the agenda, views, search, home-screen widget and event editing on your phone (install, first run, how it syncs).
- **[CalDAV](docs/caldav.md)**: the same calendars for CalDAV clients and libraries, at `/dav/`.

## Features

- **A web app that reads like Proton Calendar or Google Calendar**: day, week, month and agenda views, quick create by dragging, drag to move and
  resize, keyboard shortcuts, an event editor with a recurrence builder, a phone layout, and subtle motion that explains change (it follows your system's "reduce motion" setting, or your choice in Settings).
- **Events and recurring series** with RFC 5545 rules (daily to yearly, `2TU`, `BYSETPOS`, `COUNT`/`UNTIL`, extra dates), expanded in the
  event's own time zone so a 9:00 event stays at 9:00 across DST.
- **Skip one occurrence, change one occurrence, change this and all later ones**, or the whole series. Deleted events and calendars can be restored for 30 days.
- **Built for agents:** long-lived revocable access tokens, `Idempotency-Key` for safe retries, `If-Match` versions, stable error codes, and
  a record of who last changed each event (you, or the token's name).
- **Reminders** to browsers over Web Push, de-duplicated and restart-safe.
- **Several calendars** with colours, text search, a change feed for sync, `.ics` import/export, and **CalDAV** for apps and libraries that speak it ([docs/caldav.md](docs/caldav.md)).
- **Accounts like Kore**: the first account is the admin and can add others. Everyone's data is private (another person's item is a 404).

## Install

You need a Linux host (or any machine) with Docker and the Compose plugin. Run the installer, open the address it prints and **create your account**
(the first account becomes the administrator):

```sh
curl -fsSL https://raw.githubusercontent.com/qarasky/korecalendar/main/install.sh | bash
```

It installs the newest release: it asks where to put things and which address and port to listen on (default `127.0.0.1:8080`), pulls the matching images
(`ghcr.io/qarasky/korecalendar-api` and `-web`, linux amd64 and arm64, pinned to the exact version), initializes the data directory and starts everything.
Then, for an AI agent or a script, create an access token under Settings; see the [API guide](docs/api.md#get-a-token).
To run your own changes instead, clone the repository and run `./install.sh` there: it builds from the checkout.

**[docs/deploy.md](docs/deploy.md)** covers everything around that: the manual install, `.env` options, reaching it over HTTPS (Tailscale, Cloudflare Tunnel, your own reverse
proxy), starting on boot, updating, backups and restore, troubleshooting, and the Docker/firewall caveat. The calendar listens on `127.0.0.1:8080` by default
(`KORECAL_BIND` / `KORECAL_PORT`); Caddy sends `/api/*`, `/dav/*` and `/.well-known/caldav` to the API and everything else to the web app.

### HTTPS and notifications

Caddy speaks plain HTTP. For HTTPS put a Cloudflare Tunnel (pointing at the published port) or Tailscale HTTPS in front of it.
**Browsers only allow push notifications on HTTPS**, so browser reminders need that; the rest of the API does not. Set
`KORECAL_PUBLIC_URL` to the public https address once you have one.

The api container can reach the internet (it must, to deliver push notifications) but refuses to connect to private addresses.

### Backups

Everything is in one SQLite database, `korecal.db`, in the data directory. Back it up while running with `sqlite3 korecal.db ".backup backup.db"`; the full procedure,
including restore and a cron example, is in [docs/deploy.md](docs/deploy.md#backups).

## Develop

```
api/      Go API (REST + CalDAV), SQLite, migrations, tests       web/      Next.js web app, unit tests, Playwright e2e
docs/     guides, the OpenAPI contract, design docs and plans     assets/   the icon
```

```sh
cd api && go vet ./... && go test -race -count=1 ./...
go build -o korecalendar ./cmd/korecalendar
cp ../korecalendar.example.toml korecal.toml    # edit data_dir if you like (default ./data)
./korecalendar init -config korecal.toml && ./korecalendar -config korecal.toml      # the API on :8080
# in another terminal:
cd web && npm ci && API_URL=http://127.0.0.1:8080 npm run dev      # the web app on :3000, talking to the API
npm run typecheck && npm run lint && npm test && npm run e2e         # see web/README.md
```

Requires Go 1.26 or newer and Node 24. The API's configuration is a small TOML file (`korecalendar.example.toml`) or `KORECAL_*` environment variables.
In development CalDAV is served by the API's own port (the Next.js dev server cannot proxy `PROPFIND`). [AGENTS.md](AGENTS.md) lists the rules the code relies on;
the designs and plans are in [`docs/superpowers/`](docs/superpowers/).

## Known limits

- An event added shortly before it starts may not reach a phone in time (the Android app, in a later phase, syncs in the background
  without a push service).
- The web app is dark and English only, and has no password-change screen yet. See [docs/web.md](docs/web.md#known-limits).
- No sharing or invitations. `.ics` export and CalDAV have no `VTIMEZONE` blocks (IANA zone names only), and CalDAV has no `sync-collection`: see [docs/caldav.md](docs/caldav.md#known-limits).
- Reminders go to browsers only for now; Telegram and email are planned.
- There is no "forgot password" flow yet: keep a second administrator account and your backups.
