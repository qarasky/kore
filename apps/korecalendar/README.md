<img src="assets/icon.svg" width="64" height="64" alt="">

# KoreCalendar

A small self-hosted personal calendar whose **API is the product**. An AI agent or a script can do everything the UI can: create
and manage events, recurring series with single exclusions and single-occurrence changes, reminders, and `.ics` import and export.
Go API + SQLite and a Next.js web app behind Caddy, in the same shape as [Kore](https://github.com/qarasky/kore). The web app
(and the Android app, in a later phase) uses exactly the same public API.

Status: **phase 1 (API and core) and phase 2 (web app) are done, plus CalDAV;** the Android app is next. See [`docs/superpowers/`](docs/superpowers/) for the design and plans.

- **[Web app](docs/web.md)**: what the UI does, shortcuts, drag behaviour, notifications.
- **[API guide](docs/api.md)**: real requests and responses for the common jobs.
- **[OpenAPI contract](docs/openapi.yaml)**: also served at `GET /api/openapi.json`, no login needed.
- **[CalDAV](docs/caldav.md)**: the same calendars for CalDAV clients and libraries, at `/dav/`.

## Features

- **A web app that reads like Proton Calendar or Google Calendar**: day, week, month and agenda views, quick create by dragging, drag to move and
  resize, keyboard shortcuts, an event editor with a recurrence builder, and a phone layout.
- **Events and recurring series** with RFC 5545 rules (daily to yearly, `2TU`, `BYSETPOS`, `COUNT`/`UNTIL`, extra dates), expanded in the
  event's own time zone so a 9:00 event stays at 9:00 across DST.
- **Skip one occurrence, change one occurrence, change this and all later ones**, or the whole series. Deleted events and calendars can be restored for 30 days.
- **Built for agents:** long-lived revocable access tokens, `Idempotency-Key` for safe retries, `If-Match` versions, stable error codes, and
  a record of who last changed each event (you, or the token's name).
- **Reminders** to browsers over Web Push, de-duplicated and restart-safe.
- **Several calendars** with colours, text search, a change feed for sync, `.ics` import/export, and **CalDAV** for apps and libraries that speak it ([docs/caldav.md](docs/caldav.md)).
- **Accounts like Kore**: the first account is the admin and can add others. Everyone's data is private (another person's item is a 404).

## Install

You need Docker with the Compose plugin. The installer asks a few questions, writes `.env`, initializes the data directory, pulls the
images and starts everything:

```sh
curl -fsSL https://raw.githubusercontent.com/qarasky/korecalendar/main/install.sh | bash
```

Open the address it prints and **create your account** (the first account becomes the administrator). Then, for an AI agent or
a script, create an access token under Settings; see the [API guide](docs/api.md#get-a-token).

Or by hand:

```sh
git clone https://github.com/qarasky/korecalendar && cd korecalendar
cp .env.example .env            # then edit it: at least KORECAL_DATA_DIR, KORECAL_UID, KORECAL_GID

# One time: create the data directory and initialize it (writes a marker the API insists on).
sudo mkdir -p /srv/korecalendar && sudo chown "$(id -u):$(id -g)" /srv/korecalendar
docker compose build
docker compose run --rm --no-deps api korecalendar init

docker compose up -d
```

The calendar listens on `127.0.0.1:8080` by default (`KORECAL_BIND` / `KORECAL_PORT`). Use `0.0.0.0` to reach it from your LAN or Tailscale.
Caddy sends `/api/*` to the API and everything else to the web app.

### HTTPS and notifications

Caddy speaks plain HTTP. For HTTPS put a Cloudflare Tunnel (pointing at the published port) or Tailscale HTTPS in front of it.
**Browsers only allow push notifications on HTTPS**, so browser reminders need that; the rest of the API does not. Set
`KORECAL_PUBLIC_URL` to the public https address once you have one.

The api container can reach the internet (it must, to deliver push notifications) but refuses to connect to private addresses.

### Backups

Everything is in one SQLite database, `korecal.db`, in the data directory. Copy it while the service is stopped, or use
`sqlite3 korecal.db ".backup backup.db"`.

## Develop

```sh
cd api && go vet ./... && go test -race -count=1 ./...
go build -o korecalendar ./cmd/korecalendar    # then: ./korecalendar init -config korecal.toml && ./korecalendar -config korecal.toml
cd ../web && npm ci && npm run typecheck && npm run lint && npm test && npm run e2e     # see web/README.md
```

Requires Go 1.26 or newer and Node 24. The configuration is a small TOML file (`korecalendar.example.toml`) or `KORECAL_*` environment variables.

## Known limits

- An event added shortly before it starts may not reach a phone in time (the Android app, in a later phase, syncs in the background
  without a push service).
- The web app is dark and English only, and has no password-change screen yet. See [docs/web.md](docs/web.md#known-limits).
- No sharing or invitations. `.ics` export and CalDAV have no `VTIMEZONE` blocks (IANA zone names only), and CalDAV has no `sync-collection`: see [docs/caldav.md](docs/caldav.md#known-limits).
- Reminders go to browsers only for now; Telegram and email are planned.
