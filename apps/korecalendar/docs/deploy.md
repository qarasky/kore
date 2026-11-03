# Deploying KoreCalendar on Linux

A step-by-step guide for running KoreCalendar on a Linux server or home machine with Docker. It is written for one person or a household:
one small host, one SQLite file, no database server.

**How much of this has been run.** The Docker install (clone, `./install.sh` in place and into a separate directory, healthy containers, the login page and `/api/healthz` through Caddy, the full browser test suite,
a CalDAV client, and the uninstall commands) was exercised on Docker Desktop, which runs the same Linux containers; it has **not** been run on a bare Linux host from this project's side. The backup and
restore commands were run and checked. The firewall, reverse-proxy, `systemd`, SELinux and rootless-Docker snippets are standard examples to adapt, not tested configurations;
they are marked as such.

## What you get

Three containers, started with Docker Compose from released images (`ghcr.io/qarasky/korecalendar-api` and `-web`, see [releasing.md](releasing.md)):

| Container | What it is | Reachable from |
| --- | --- | --- |
| `caddy` | the only published service: routes `/api/*`, `/dav/*` and `/.well-known/caldav` to the API, everything else to the web app, and adds security headers | the host, on `KORECAL_BIND:KORECAL_PORT` (default `127.0.0.1:8080`) |
| `web` | the Next.js app (server-rendered), calls the API over the internal network | only `caddy` |
| `api` | the Go API (REST and CalDAV) with SQLite | `caddy` and `web` over the internal network; it also has an outbound-capable network so it can deliver browser push notifications (it refuses private addresses) |

Your data is one directory on the host (default `/srv/korecalendar`) holding `korecal.db` (plus SQLite's `-wal` and `-shm` files while it runs) and a marker file
`.korecal-volume`. The containers run with read-only root filesystems, Linux capabilities dropped (Caddy keeps only the one it needs to bind port 80 inside its container) and `no-new-privileges`; the API runs as the host user and group you choose,
so the files in the data directory belong to that user.

```
 browser / app / CalDAV client
          │  http://host:8080  (or https:// through a tunnel or proxy)
          ▼
       caddy ──/api/*, /dav/*──▶ api ──▶ /srv/korecalendar/korecal.db
          └────── everything else ──▶ web ──▶ api
```

## Requirements

- A 64-bit Linux host (x86_64 or arm64; the images exist for both) with a recent **Docker Engine** and the **Compose plugin**
  (`docker compose version` must work; Compose v2). Install from [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
  Your user must be allowed to use Docker (`sudo usermod -aG docker $USER`, then log in again).
- About 1 GB of free disk for the images. `git` is needed only to build from source (see below), and building the web image can use a lot of memory for a minute or
  two; on a very small VPS add a swap file first.
- An accurate clock (`timedatectl` should say the system clock is synchronized): reminders fire from the server's clock. The host's time zone does not matter; every event
  carries its own zone and every person picks theirs in Settings.
- Optional, for **browser notifications**: an HTTPS address (see [HTTPS](#https-and-how-to-reach-it)).

## Install (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/qarasky/korecalendar/main/install.sh | bash
```

This installs the **newest release**: it looks it up, downloads the compose files of that release and pulls the matching images, pinned to that exact version
(`KORECAL_VERSION` in `.env`). Nothing is built and `git` is not needed. Read the script before you run it; it is short. To install a specific release:
`KORECAL_VERSION=0.1.0 bash install.sh` (download it first, or pipe it with the variable set in front of `bash`).

The installer asks four things (or takes the defaults), then does everything else:

| Question | Default | Notes |
| --- | --- | --- |
| Install directory | `~/korecalendar` | where the compose files and `.env` are written and where you later run `docker compose`. (Run from a clone, it installs in place and builds from the clone, see [Build from source](#build-from-source).) |
| Data directory | `<install dir>-data` (next to it, **outside** the clone so `git clean` can never touch it) | the database lives here; put it on the disk you back up |
| Listen on | `127.0.0.1` | `127.0.0.1` = this machine only; `0.0.0.0` = every interface (LAN, Tailscale); or one specific address |
| Port | `8080` | |

It checks Docker, creates the data directory (using `sudo` only if it must), writes `.env` with mode 600, pulls the images, runs `korecalendar init` once (this writes the
marker file the API insists on, so it refuses to start on an empty or unmounted directory), starts the stack and waits until it is healthy. Then open the printed address
and **create your account**: the first account becomes the administrator.

Non-interactive (scripts, provisioning): set the answers as environment variables and `KORECAL_YES=1` (run it as your normal user, not as root: the API then runs as you).
A directory you cannot create (for example under `/srv` or `/opt`) is created with `sudo` and handed to you:

```sh
KORECAL_YES=1 KORECAL_DATA_DIR=/srv/korecalendar KORECAL_BIND=127.0.0.1 KORECAL_PORT=8080 ./install.sh
```

Re-running it where a `.env` already exists does nothing (it never overwrites an installation). If the images cannot be pulled (no network to ghcr.io, a version that does
not exist), it clones the repository into `<install dir>/src` and builds them there instead.

## Install (by hand)

The same thing without the script; useful to understand it or to put the files where you want them.

```sh
V=0.1.0                                                  # a release: https://github.com/qarasky/korecalendar/releases
sudo mkdir -p /opt/korecalendar && sudo chown "$(id -u):$(id -g)" /opt/korecalendar && cd /opt/korecalendar
curl -fsSLO "https://raw.githubusercontent.com/qarasky/korecalendar/v$V/{docker-compose.yml,Caddyfile,.env.example}"

# 1. The data directory, owned by the user the API will run as.
sudo mkdir -p /srv/korecalendar && sudo chown "$(id -u):$(id -g)" /srv/korecalendar

# 2. Configuration.
cp .env.example .env
$EDITOR .env          # KORECAL_DATA_DIR, KORECAL_UID/GID (= `id -u` / `id -g`), KORECAL_BIND, KORECAL_PORT, and KORECAL_VERSION=0.1.0

# 3. Pull, initialize the data directory once, start.
docker compose pull
docker compose run --rm --no-deps api korecalendar init
docker compose up -d --wait

# 4. Check.
docker compose ps                                   # all three "healthy"
curl -s http://127.0.0.1:8080/api/healthz           # {"ok":true}
```

### Build from source

To run your own changes or a branch, build the images instead of pulling them. From a clone, the installer builds from it and installs in place (the `.env` is written in the clone;
the data directory defaults to `<clone>-data`, outside it):

```sh
git clone https://github.com/qarasky/korecalendar.git && cd korecalendar
./install.sh                       # builds the images from this checkout; a few minutes the first time
```

By hand: do the steps above in the clone, with `docker compose build` instead of `docker compose pull`. An image built this way reports `dev` for `korecalendar version`
unless you pass `--build-arg VERSION=...`.

### `.env` reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `KORECAL_DATA_DIR` | (required) | host directory with the database; must exist and contain the marker (`init` writes it) |
| `KORECAL_BIND` | `127.0.0.1` | host address Caddy is published on |
| `KORECAL_PORT` | `8080` | host port |
| `KORECAL_UID`, `KORECAL_GID` | `1000` | user and group the API runs as; they must own `KORECAL_DATA_DIR` |
| `KORECAL_VERSION` | `latest` | image tag for both the api and the web image: a release number (`0.1.0`, **recommended**: pin it), `latest` (the newest stable release) or `edge` (the tip of `main`). See [releasing.md](releasing.md#image-tags) |
| `KORECAL_PUBLIC_URL` | empty | your public `https://` address; sent to push services as the operator contact for browser notifications |
| `KORECAL_SUBNET` | `172.31.255.0/24` | subnet of Caddy's network, also the range whose forwarded headers are trusted (see below); change it only if it collides with a network you already use |

| `KORECAL_OIDC_ISSUER` | empty | turns on [Sign in with Kore ID](#sign-in-with-kore-id): the provider's public address, e.g. `https://id.kore.example` |
| `KORECAL_OIDC_CLIENT_ID` | `korecalendar` | the client id registered in Kore ID |
| `KORECAL_OIDC_CLIENT_SECRET` | empty | the client secret Kore ID printed for it (keep `.env` private) |
| `KORECAL_OIDC_EXTRA_AUDIENCES` | empty | more client ids (comma separated) whose Kore ID access tokens the API accepts, e.g. `korecalendar-android` |
| `KORECAL_OIDC_ADMIN_SUBS` | empty | Kore ID subjects (comma separated) that are administrators here (who may sign in at all is set in Kore ID) |
| `KORECAL_OIDC_AUTO_PROVISION` | `true` | create a local account on a first Kore ID sign-in |
| `KORECAL_OIDC_LINK_BY_EMAIL` | `verified` | `verified`, `off` or `trusted`: link a Kore ID login to a local account with the same email |
| `KORECAL_KORE_APPS` | empty | the other Kore apps for the account menu's app switcher, `kore=https://…,koremind=https://…,flatline=https://…` (`korecalendar` defaults to `KORECAL_PUBLIC_URL`) |
| `KORECAL_OIDC_NAME`, `KORECAL_OIDC_SCOPES` | `Kore ID`, `openid profile email` | button label and requested scopes |
| `KORECAL_PASSWORD_LOGIN` | `true` | `false` turns off email + password sign-in and first-run setup (needs Kore ID) |

The API itself also reads `KORECAL_PORT`, `KORECAL_BIND`, `KORECAL_DATA_DIR`, `KORECAL_PUBLIC_URL` and a TOML file (`korecalendar.example.toml`); inside the containers
compose sets those for you and you do not touch them.

## Sign in with Kore ID

KoreCalendar can use [Kore ID](https://github.com/qarasky/kore-id), the shared OpenID Connect sign-in of the Kore apps, next to (or instead of) its own passwords.
It is optional; with nothing set, nothing changes.

1. In Kore ID's `clients.json` register the client `korecalendar` (`"app": "korecalendar"`) with
   `redirectUris` `["https://calendar.example.com/api/auth/oidc/callback"]`, `postLogoutRedirectUris` `["https://calendar.example.com/login"]`,
   `backchannelLogoutUri` `"https://calendar.example.com/api/auth/oidc/backchannel-logout"` and `homeUrl` `"https://calendar.example.com/"`
   (your `KORECAL_PUBLIC_URL`). The Android app is the public client `korecalendar-android` (same `"app": "korecalendar"`, redirect
   `dev.qarasky.korecalendar:/oauth2redirect`); set `KORECAL_OIDC_EXTRA_AUDIENCES=korecalendar-android`. The API logs these URIs at start.
2. In `.env` set `KORECAL_PUBLIC_URL`, `KORECAL_OIDC_ISSUER` and `KORECAL_OIDC_CLIENT_SECRET`, then `docker compose up -d`.
   The api container must reach the issuer (it is on the `egress` network); the browser must reach it too, at the same address.
3. The sign-in page now shows "Sign in with Kore ID". The browser goes to Kore ID with PKCE, a `state` and a `nonce`; the API checks the state against a cookie
   and a one-time server-side record, exchanges the code, verifies the id token's EdDSA signature against Kore ID's JWKS (issuer, audience, expiry, nonce)
   and starts the usual session cookie, remembering the Kore ID session id (`sid`). Logging out also ends the Kore ID session.
4. **Back-channel logout.** When the Kore ID session ends (sign-out in any Kore app, an admin disabling the user, "sign out everywhere", a password reset),
   Kore ID POSTs a logout token to `/api/auth/oidc/backchannel-logout`. The API verifies it (JWKS signature, issuer, audience = its own client id, `typ: logout+jwt`,
   the back-channel `events` claim, no `nonce`, a `jti` it has not seen before) and deletes every KoreCalendar session from that `sid` (all sessions of that `sub`
   when the token has no `sid`); Kore ID access tokens of that session stop working as bearer tokens too. `kcal_` access tokens are not sessions and keep working:
   revoke them in Settings. The api must be reachable from Kore ID at `KORECAL_PUBLIC_URL`.

**Who may use it.** Kore ID decides: each Kore ID user has per-app access, and `/authorize` refuses users without access to the app `korecalendar` (it covers
`korecalendar` and `korecalendar-android`). KoreCalendar has no allowlist of its own and does not need one.

**Who is who.** An account is keyed on the token's `sub` (the same UUID in every Kore app). The first sign-in creates an account (`KORECAL_OIDC_AUTO_PROVISION`)
with its default calendar. The email is copied once and is not kept in sync.

**Administrators.** Auto-created accounts are normal users, except subjects in `KORECAL_OIDC_ADMIN_SUBS`. On a fresh install with no account yet, a Kore ID sign-in
is refused unless the subject is listed there (so the first person Kore ID lets in does not become the administrator by accident); or create the first account
with a password as usual. This only decides the role inside KoreCalendar; access to the app is granted in Kore ID.

**Existing accounts (migration).** Kore ID accounts are created by its administrator, so their email addresses are trusted and tokens carry
`email_verified: true`. With the default `KORECAL_OIDC_LINK_BY_EMAIL=verified`, the first Kore ID sign-in of someone who already has a local account with the same
email lands on that account (calendars, tokens and all). A local account already linked to another Kore ID subject is never taken over. `off` never links by email;
then link by hand: read your `sub` at the Kore ID account page (or `GET /userinfo`) and run, on the server:

```sh
docker compose run --rm --no-deps api korecalendar link you@example.com 00000000-0000-4000-8000-000000000000
```

`trusted` links on any email match even without `email_verified`; use it only with a provider you fully trust.

**Without passwords.** `KORECAL_PASSWORD_LOGIN=false` removes `POST /api/login` and `POST /api/setup` (they answer `403 password_login_disabled`) and hides the form. Access tokens
(`kcal_…`) and CalDAV (which only ever took access tokens) keep working. KoreCalendar refuses to start with passwords off and no Kore ID, and only set it after you have an administrator.

**Agents and scripts** keep using access tokens; nothing about them changes. The API also accepts a Kore ID *access token* (a JWT for audience `korecalendar`, or an
`KORECAL_OIDC_EXTRA_AUDIENCES` client) as `Authorization: Bearer`: it counts as a signed-in session (it can create `kcal_` tokens, which is how the Android app finishes sign-in).
ID tokens and tokens for other Kore apps are refused. A Kore ID access token lasts about 10 minutes.

**Limits.** Disabling someone in Kore ID ends their KoreCalendar sessions through back-channel logout, but not `kcal_` access tokens (or CalDAV, which uses them)
they already hold: KoreCalendar has no way to disable a user yet; revoke their tokens from Settings as the owner of the account, or in the database. If the
back-channel call cannot reach KoreCalendar, the session lasts until it expires (30 days) or the user signs out.

## HTTPS and how to reach it

Caddy here speaks **plain HTTP**. That is fine on a LAN or a VPN, but two things need HTTPS: **browser notifications** (browsers only allow push on a secure origin; the
Settings page tells you when it is not) and **using the API, the web app or CalDAV over the internet**, because passwords, session cookies and CalDAV's HTTP Basic
credentials would otherwise cross the network in clear text. Pick one:

### Only on this machine, or on a trusted LAN

Keep `KORECAL_BIND=127.0.0.1` (this machine) or set it to the LAN address of the host (`192.168.1.20`), not `0.0.0.0`, if the host has several interfaces.
Everything works except browser notifications.

> **Docker and firewalls.** Docker publishes ports by writing its own `iptables` rules, which are evaluated **before** `ufw` and `firewalld`: a `ufw deny 8080` does not
> block a published port. Do not rely on the host firewall to hide the calendar; decide who can reach it with `KORECAL_BIND`, or put the proxy in front of a loopback-only port.

### Tailscale (a private HTTPS address for your devices)

Keep `KORECAL_BIND=127.0.0.1` and let Tailscale serve it over HTTPS with a certificate for your tailnet name (example; see `tailscale serve --help` for your version):

```sh
sudo tailscale serve --bg 8080
```

Then open `https://<machine>.<tailnet>.ts.net`. Set `KORECAL_PUBLIC_URL` to that address in `.env` and `docker compose up -d`.

### Cloudflare Tunnel (public HTTPS without opening a port)

Run `cloudflared` on the host and point a hostname at the loopback port (example `config.yml` fragment):

```yaml
ingress:
  - hostname: calendar.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Keep `KORECAL_BIND=127.0.0.1`. Cloudflare's `CF-Connecting-IP` header is trusted because the connection comes from the host (see "Forwarded headers"). Set `KORECAL_PUBLIC_URL`.

### Your own reverse proxy on the host (Caddy or nginx) with a domain

Publish the stack on loopback only and let a host-level proxy terminate TLS. Examples (adapt; not tested here):

```caddyfile
# /etc/caddy/Caddyfile on the host (Caddy gets the certificate by itself)
calendar.example.com {
	reverse_proxy 127.0.0.1:8080 {
		# See "Forwarded headers" below: this is how the API learns the real client address.
		header_up CF-Connecting-IP {remote_host}
	}
}
```

```nginx
# nginx, inside a server { listen 443 ssl; server_name calendar.example.com; ... } block
client_max_body_size 6m;                     # .ics imports and CalDAV PUTs are capped at 5 MB
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header CF-Connecting-IP  $remote_addr;   # see "Forwarded headers" below
    proxy_read_timeout 60s;
}
```

CalDAV's methods (`PROPFIND`, `REPORT`, …) pass through both unchanged. Set `KORECAL_PUBLIC_URL=https://calendar.example.com`.

### Forwarded headers (why `KORECAL_SUBNET` exists)

The API uses the client address for login rate limiting, and the session cookie is marked `Secure` when the request arrived over HTTPS. Both rely on headers the proxy sets
(`X-Forwarded-For`, `X-Forwarded-Proto`, `CF-Connecting-IP`), and **a header is only believed when it comes from a trusted source**. Caddy trusts them only from connections
that come from the host itself: a proxy or tunnel on the same machine reaches the published port through Docker, and those connections arrive from the gateway of Caddy's own
network, `KORECAL_SUBNET`. Anyone else's forwarded headers are overwritten with what Caddy actually sees. Two consequences:

- **Behind a proxy on the same host, set `CF-Connecting-IP` yourself** (the two examples above do). The API prefers that header, so setting it to the real client address (and
  overwriting whatever the client sent) gives every person their own rate-limit bucket and stops anyone from choosing their own address by sending the header. Without it,
  every client behind your proxy shares one address (the Docker gateway), so thirty wrong passwords from anyone lock everyone out for 15 minutes, and a client that sends its own
  `CF-Connecting-IP` is believed. Cloudflare Tunnel sets and overwrites it for you. A Tailscale-only setup is fine without it (the people behind it are your own devices and share one bucket).
- A proxy on **another** machine is not trusted: its clients all appear as the proxy's address, and `X-Forwarded-Proto: https` is ignored (so cookies are not marked `Secure`).
  Put the proxy on the same host, or terminate TLS there and keep the hop local.
- If `172.31.255.0/24` collides with a network you use, change `KORECAL_SUBNET` in `.env` before the first start.

## Start on boot

The containers have `restart: unless-stopped`, so they come back when the Docker daemon starts; make sure the daemon starts at boot:

```sh
sudo systemctl enable --now docker
```

**If the data directory is on its own disk or mount**, make Docker wait for it, otherwise after a reboot Docker can start before the disk is mounted and the API (which checks
for the marker file) will refuse to start on the empty mount point until you restart it. The installer offers to do this; by hand (example, replace the path):

```sh
sudo mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=/srv/korecalendar\n' | sudo tee /etc/systemd/system/docker.service.d/wait-for-korecalendar-data.conf
sudo systemctl daemon-reload
```

## Using it

- **Accounts.** The first account is the administrator and can add others under Settings → Users (it shows the new person's password once). Each person's calendars are private.
- **Agents and scripts.** Settings → Access tokens creates a token for the REST API ([api.md](api.md)); the same token is the password for **CalDAV** ([caldav.md](caldav.md)). A token has the powers of its account, except managing tokens: a token of the **administrator** account can also create users, so give agents tokens from a non-admin account.
- **Time zones.** Each person sets theirs under Settings → General.
- **No password reset yet.** There is no "forgot password" flow or reset command; keep your backups and a second administrator account. (Tokens can be revoked and re-created at any time.)

## Updating

Run these in the installation directory. **Take a backup first** ([below](#backups)): migrations are applied automatically when the API starts and only go forward.
Read the [release notes](https://github.com/qarasky/korecalendar/releases) first; while the version is `0.x`, a minor release may change things.

```sh
V=0.2.0                                                  # the release you are moving to
for f in docker-compose.yml Caddyfile; do                # the compose files that belong to it
  curl -fsSL "https://raw.githubusercontent.com/qarasky/korecalendar/v$V/$f" -o "$f.new" && mv "$f.new" "$f"
done
sed -i "s/^KORECAL_VERSION=.*/KORECAL_VERSION=$V/" .env  # on macOS: sed -i ''
docker compose pull                                      # the new images, and a newer Caddy of the pinned minor version
docker compose up -d --wait
docker image prune -f                                    # the old images pile up otherwise
```

To check which version is running: `docker compose run --rm --no-deps api korecalendar version`.

If you installed **from a clone** ([Build from source](#build-from-source)), update with `git pull`, `docker compose build --pull`, `docker compose pull caddy` and `docker compose up -d --wait`
instead. If the clone is not the installation directory, the installation directory holds **copies** of `docker-compose.yml` and `Caddyfile`; copy them over
(`cp docker-compose.yml Caddyfile /path/to/install/`) before building.

To roll back, put the previous version (and its compose files) back as above and restore the backup taken before the update (a database that has been migrated forward may not open in an older version).

**Changing settings later** (port, bind address, public URL): edit `.env` in the installation directory and run `docker compose up -d`; the stack is recreated with the new values.
After changing `KORECAL_SUBNET` run `docker compose down` first so the network is rebuilt.

## Backups

Everything is in `korecal.db`. Back it up with SQLite's online backup, which is safe while the service is running (install the `sqlite3` command-line tool: `sudo apt install sqlite3`
or `sudo dnf install sqlite`):

```sh
sudo mkdir -p /srv/backups && sudo chown "$(id -u):$(id -g)" /srv/backups
sqlite3 /srv/korecalendar/korecal.db ".backup '/srv/backups/korecal-$(date +%F).db'"
sqlite3 /srv/backups/korecal-$(date +%F).db "PRAGMA integrity_check;"      # prints "ok"
```

A daily job (example, adapt; not tested here):

```sh
# /etc/cron.d/korecalendar-backup
15 3 * * *  youruser  sqlite3 /srv/korecalendar/korecal.db ".backup '/srv/backups/korecal-$(date +\%F).db'" && find /srv/backups -name 'korecal-*.db' -mtime +30 -delete
```

Run the backup as the user in `KORECAL_UID` (or as root): SQLite needs write access to the database's `-shm` file even to read it. Copy the backups off the machine. Without `sqlite3` you can stop the API (`docker compose stop api`) and copy `korecal.db` (and `korecal.db-wal` if present), then start it again.
Do not copy the database file while the API is running with a plain `cp`: the copy can be inconsistent.

**Restore** (on the same or a new host): the data directory needs the marker file, then the database goes in:

```sh
sudo mkdir -p /srv/korecalendar && sudo chown "$(id -u):$(id -g)" /srv/korecalendar   # only on a new host
docker compose stop api web caddy                    # or `docker compose down`
sudo rm -f /srv/korecalendar/korecal.db /srv/korecalendar/korecal.db-wal /srv/korecalendar/korecal.db-shm
docker compose run --rm --no-deps api korecalendar init      # writes .korecal-volume if it is missing
cp /srv/backups/korecal-2026-11-02.db /srv/korecalendar/korecal.db
sudo chown "$(id -u):$(id -g)" /srv/korecalendar/korecal.db  # the user in KORECAL_UID/GID
docker compose up -d --wait
```

Separately from backups, a deleted event or calendar can be brought back for 30 days: **Undo** shows for a few seconds after deleting in the web app, and afterwards `POST /api/events/{id}/restore` or `POST /api/calendars/{id}/restore` restores it (see [api.md](api.md)).

## Health, logs, troubleshooting

```sh
docker compose ps                    # state and health of the three containers
docker compose logs -f api           # the API's log (also: web, caddy)
curl -s http://127.0.0.1:8080/api/healthz
```

Logs are rotated by Docker (10 MB × 3 files per container).

| Symptom | Likely cause and fix |
| --- | --- |
| `api` keeps restarting, log says `volume marker .korecal-volume missing` | the data directory is empty, wrong, or not mounted yet: mount the disk, or run `docker compose run --rm --no-deps api korecalendar init` once on a new directory |
| `permission denied` on the database | the data directory is not owned by `KORECAL_UID:KORECAL_GID`: `sudo chown -R UID:GID /srv/korecalendar` |
| `Bind for 127.0.0.1:8080 failed: port is already allocated` | another service uses the port: change `KORECAL_PORT` and `docker compose up -d` |
| `Pool overlaps with other one on this address space` | `KORECAL_SUBNET` collides with an existing Docker network: pick another range |
| The web app says "Can't reach the server" | the API is down or unhealthy: `docker compose ps`, then `logs api`; your data is safe |
| Settings says browser notifications need HTTPS | open the app from an `https://` address (see HTTPS above) |
| CalDAV client gets 401 | use your **email** as the user name and an **access token** (Settings → Access tokens) as the password; the account password is not accepted |
| Locked out after wrong passwords (HTTP 429) | wait the time shown (15 minutes); five wrong attempts per email and address, thirty per address |
| Cannot reach it from another device | `KORECAL_BIND` is `127.0.0.1`: use the LAN address or `0.0.0.0` (mind the firewall note above), or a tunnel |

On a host with **SELinux** enforcing (Fedora, RHEL and relatives), a bind-mounted data directory may be unreadable from the container; relabel it by adding `selinux: z` under
the `bind:` options of the data volume **and** of the `Caddyfile` mount in `docker-compose.yml` (example, not tested here). With **rootless Docker**, user IDs inside the container are remapped: your own user is `0` inside the container, so set
`KORECAL_UID=0` and `KORECAL_GID=0` (the files on disk still belong to you) and publish a port above 1024 (the default 8080 is fine).

## Without Docker (advanced, not packaged)

The pieces are ordinary programs, so a bare-metal setup is possible but is **not** a supported install and the unit files below are templates that have not been run on a
Linux host from this project's side. You need Go 1.26 and Node 24 to build, and something in front for routing (Caddy or nginx, with the same routes as the `Caddyfile`:
`/api/*`, `/dav/*` and `/.well-known/caldav` to the API, everything else to the web app).

```sh
# API
cd api && CGO_ENABLED=0 go build -trimpath -o /usr/local/bin/korecalendar ./cmd/korecalendar
sudo useradd --system --home /var/lib/korecalendar --create-home korecal
sudo -u korecal env KORECAL_DATA_DIR=/var/lib/korecalendar/data korecalendar init
# Web (production standalone build; API_URL must point at the API at build time and run time)
cd ../web && npm ci && API_URL=http://127.0.0.1:8081 npm run build
cp -r public .next/standalone/public && cp -r .next/static .next/standalone/.next/static
sudo cp -r .next/standalone /opt/korecalendar-web
```

```ini
# /etc/systemd/system/korecalendar-api.service   (template)
[Unit]
Description=KoreCalendar API
After=network.target

[Service]
User=korecal
Environment=KORECAL_DATA_DIR=/var/lib/korecalendar/data KORECAL_BIND=127.0.0.1 KORECAL_PORT=8081
ExecStart=/usr/local/bin/korecalendar
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/korecalendar

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/korecalendar-web.service   (template)
[Unit]
Description=KoreCalendar web
After=korecalendar-api.service

[Service]
User=korecal
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1 API_URL=http://127.0.0.1:8081
ExecStart=/usr/bin/node /opt/korecalendar-web/server.js
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Without Caddy's header handling you must set the security headers (`Content-Security-Policy` and the others in the `Caddyfile`) and the trusted-proxy rules yourself.

## Security notes

- Publish only what you mean to: `127.0.0.1` plus a tunnel or proxy is the safest default; `0.0.0.0` exposes the (plain HTTP) calendar to every network the host is on.
- Use HTTPS for anything beyond a trusted LAN. Access tokens give full access (except managing tokens); create one per integration and revoke what you no longer use.
- Logins are rate limited (5 wrong attempts per email and address, 30 per address, 15 minutes), and so are CalDAV sign-ins. The account password is never accepted by CalDAV.
- The `api` container may open outbound connections (for browser push) but refuses to connect to private, loopback and link-local addresses, so a push subscription cannot be
  used to reach other services on your network. The `web` container is on the internal network only and has no outbound access at all.
- Nothing is loaded from third-party hosts: no CDN, fonts, analytics or scripts.
- Keep the host patched, and keep backups off the machine.

## Uninstall

```sh
cd ~/korecalendar                                        # the installation directory
docker compose down --rmi all                            # stops and removes the containers and the images they used
cd .. && rm -rf ~/korecalendar                           # the install directory (compose files, .env)
# the data directory holds your calendars; delete it only when you are sure:  sudo rm -rf /srv/korecalendar
```

If you chose a data directory **inside** the installation directory, `rm -rf` of the latter deletes your calendars: move or back up the data directory first.

