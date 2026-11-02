# Deploying KoreCalendar on Linux

A step-by-step guide for running KoreCalendar on a Linux server or home machine with Docker. It is written for one person or a household:
one small host, one SQLite file, no database server.

**How much of this has been run.** The Docker install (clone, `./install.sh`, healthy containers, the login page and `/api/healthz` through Caddy, the full browser test suite,
a CalDAV client) was exercised on Docker Desktop, which runs the same Linux containers; it has **not** been run on a bare Linux host from this project's side. The backup and
restore commands were run and checked. The firewall, reverse-proxy, `systemd`, SELinux and rootless-Docker snippets are standard examples to adapt, not tested configurations;
they are marked as such.

## What you get

Three containers, started with Docker Compose from this repository:

| Container | What it is | Reachable from |
| --- | --- | --- |
| `caddy` | the only published service: routes `/api/*`, `/dav/*` and `/.well-known/caldav` to the API, everything else to the web app, and adds security headers | the host, on `KORECAL_BIND:KORECAL_PORT` (default `127.0.0.1:8080`) |
| `web` | the Next.js app (server-rendered), calls the API over the internal network | only `caddy` |
| `api` | the Go API (REST and CalDAV) with SQLite | only `caddy` and `web`; it can also make **outbound** connections (to deliver browser push notifications) but refuses private addresses |

Your data is one directory on the host (default `/srv/korecalendar`) holding `korecal.db` (plus SQLite's `-wal` and `-shm` files while it runs) and a marker file
`.korecal-volume`. The containers run with read-only root filesystems, all Linux capabilities dropped and `no-new-privileges`; the API runs as the host user and group you choose,
so the files in the data directory belong to that user.

```
 browser / app / CalDAV client
          │  http://host:8080  (or https:// through a tunnel or proxy)
          ▼
       caddy ──/api/*, /dav/*──▶ api ──▶ /srv/korecalendar/korecal.db
          └────── everything else ──▶ web ──▶ api
```

## Requirements

- A 64-bit Linux host (x86_64 or arm64; the images are built on the host, so they match its architecture) with a recent **Docker Engine** and the **Compose plugin**
  (`docker compose version` must work; Compose v2). Install from [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
  Your user must be allowed to use Docker (`sudo usermod -aG docker $USER`, then log in again).
- `git`, and about 2 GB of free disk for the images and build cache. Building the web image can use a lot of memory for a minute or two; on a very small VPS add a
  swap file first.
- An accurate clock (`timedatectl` should say the system clock is synchronized): reminders fire from the server's clock. The host's time zone does not matter; every event
  carries its own zone and every person picks theirs in Settings.
- Optional, for **browser notifications**: an HTTPS address (see [HTTPS](#https-and-how-to-reach-it)).

The images are not published to a registry yet, so the installer **builds them on your machine from a checkout of this repository**. The first build takes a few minutes.

## Install (recommended)

```sh
git clone git@github.com:qarasky/korecalendar.git      # or the https URL, with a token while the repository is private
cd korecalendar
./install.sh
```

The installer asks four things (or takes the defaults), then does everything else:

| Question | Default | Notes |
| --- | --- | --- |
| Install directory | `~/korecalendar` | holds `docker-compose.yml`, `Caddyfile`, `.env`; it **links to your clone** for the build, so keep the clone |
| Data directory | `<install dir>/data` | the database lives here; put it on the disk you back up |
| Listen on | `127.0.0.1` | `127.0.0.1` = this machine only; `0.0.0.0` = every interface (LAN, Tailscale); or one specific address |
| Port | `8080` | |

It checks Docker, creates the data directory (using `sudo` only if it must), writes `.env` with mode 600, builds the images, runs `korecalendar init` once (this writes the
marker file the API insists on, so it refuses to start on an empty or unmounted directory), starts the stack and waits until it is healthy. Then open the printed address
and **create your account**: the first account becomes the administrator.

Non-interactive (scripts, provisioning): set the answers as environment variables and `KORECAL_YES=1`:

```sh
KORECAL_YES=1 KORECAL_DIR=/opt/korecalendar KORECAL_DATA_DIR=/srv/korecalendar \
KORECAL_BIND=127.0.0.1 KORECAL_PORT=8080 ./install.sh
```

Re-running it on a directory that already has a `.env` does nothing. If the installer is run without a checkout (`curl … | bash`) and the images cannot be pulled, it clones
the repository itself into `<install dir>/src` and builds there (this needs git and a repository you can read anonymously, so not while it is private).

## Install (by hand)

The same thing without the script; useful to understand it or to put the files where you want them.

```sh
git clone git@github.com:qarasky/korecalendar.git /opt/korecalendar && cd /opt/korecalendar

# 1. The data directory, owned by the user the API will run as.
sudo mkdir -p /srv/korecalendar && sudo chown "$(id -u):$(id -g)" /srv/korecalendar

# 2. Configuration.
cp .env.example .env
$EDITOR .env          # KORECAL_DATA_DIR, KORECAL_UID/GID (= `id -u` / `id -g`), KORECAL_BIND, KORECAL_PORT

# 3. Build, initialize the data directory once, start.
docker compose build
docker compose run --rm --no-deps api korecalendar init
docker compose up -d --wait

# 4. Check.
docker compose ps                                   # all three "healthy"
curl -s http://127.0.0.1:8080/api/healthz           # {"ok":true}
```

### `.env` reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `KORECAL_DATA_DIR` | (required) | host directory with the database; must exist and contain the marker (`init` writes it) |
| `KORECAL_BIND` | `127.0.0.1` | host address Caddy is published on |
| `KORECAL_PORT` | `8080` | host port |
| `KORECAL_UID`, `KORECAL_GID` | `1000` | user and group the API runs as; they must own `KORECAL_DATA_DIR` |
| `KORECAL_VERSION` | `latest` | tag of the locally built images |
| `KORECAL_PUBLIC_URL` | empty | your public `https://` address; sent to push services as the operator contact for browser notifications |
| `KORECAL_SUBNET` | `172.31.255.0/24` | subnet of Caddy's network, also the range whose forwarded headers are trusted (see below); change it only if it collides with a network you already use |

The API itself also reads `KORECAL_PORT`, `KORECAL_BIND`, `KORECAL_DATA_DIR`, `KORECAL_PUBLIC_URL` and a TOML file (`korecalendar.example.toml`); inside the containers
compose sets those for you and you do not touch them.

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
	reverse_proxy 127.0.0.1:8080
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
    proxy_read_timeout 60s;
}
```

CalDAV's methods (`PROPFIND`, `REPORT`, …) pass through both unchanged. Set `KORECAL_PUBLIC_URL=https://calendar.example.com`.

### Forwarded headers (why `KORECAL_SUBNET` exists)

The API uses the client address for login rate limiting, and the session cookie is marked `Secure` when the request arrived over HTTPS. Both rely on headers the proxy sets
(`X-Forwarded-For`, `X-Forwarded-Proto`, `CF-Connecting-IP`), and **a header is only believed when it comes from a trusted source**. Caddy trusts them only from connections
that come from the host itself: a proxy or tunnel on the same machine reaches the published port through Docker, and those connections arrive from the gateway of Caddy's own
network, `KORECAL_SUBNET`. Anyone else's forwarded headers are overwritten with what Caddy actually sees. Two consequences:

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
- **Agents and scripts.** Settings → Access tokens creates a token for the REST API ([api.md](api.md)); the same token is the password for **CalDAV** ([caldav.md](caldav.md)).
- **Time zones.** Each person sets theirs under Settings → General.
- **No password reset yet.** There is no "forgot password" flow or reset command; keep your backups and a second administrator account. (Tokens can be revoked and re-created at any time.)

## Updating

```sh
cd /opt/korecalendar            # your clone (the installer's "src" directory, or wherever you cloned)
# 1. back up first (below): migrations only go forward
git pull
docker compose build            # run from the install directory if it differs from the clone
docker compose up -d --wait
```

Database migrations are applied automatically when the API starts; they cannot be undone, so **take a backup before every update**. To roll back, check out the previous
commit or tag, rebuild, and restore the backup taken before the update (a database that has been migrated forward may not open in an older version).

## Backups

Everything is in `korecal.db`. Back it up with SQLite's online backup, which is safe while the service is running (install the `sqlite3` command-line tool: `sudo apt install sqlite3`
or `sudo dnf install sqlite`):

```sh
mkdir -p /srv/backups
sqlite3 /srv/korecalendar/korecal.db ".backup '/srv/backups/korecal-$(date +%F).db'"
sqlite3 /srv/backups/korecal-$(date +%F).db "PRAGMA integrity_check;"      # prints "ok"
```

A daily job (example, adapt; not tested here):

```sh
# /etc/cron.d/korecalendar-backup
15 3 * * *  youruser  sqlite3 /srv/korecalendar/korecal.db ".backup '/srv/backups/korecal-$(date +\%F).db'" && find /srv/backups -name 'korecal-*.db' -mtime +30 -delete
```

Copy the backups off the machine. Without `sqlite3` you can stop the API (`docker compose stop api`) and copy `korecal.db` (and `korecal.db-wal` if present), then start it again.
Do not copy the database file while the API is running with a plain `cp`: the copy can be inconsistent.

**Restore** (on the same or a new host): the data directory needs the marker file, then the database goes in:

```sh
docker compose stop api web caddy                    # or `docker compose down`
sudo rm -f /srv/korecalendar/korecal.db /srv/korecalendar/korecal.db-wal /srv/korecalendar/korecal.db-shm
docker compose run --rm --no-deps api korecalendar init      # writes .korecal-volume if it is missing
cp /srv/backups/korecal-2026-11-02.db /srv/korecalendar/korecal.db
sudo chown "$(id -u):$(id -g)" /srv/korecalendar/korecal.db  # the user in KORECAL_UID/GID
docker compose up -d --wait
```

Deleted events and calendars are also recoverable for 30 days from inside the app (Undo, or `POST /api/events/{id}/restore`), independent of backups.

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
the `bind:` options of the data volume in `docker-compose.yml` (example, not tested here). With **rootless Docker**, user IDs inside the container are remapped: set
`KORECAL_UID`/`KORECAL_GID` to the IDs that map to your own user, and publish a port above 1024 (the default 8080 is fine).

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
cd ~/korecalendar && docker compose down --rmi local     # stops and removes the containers and the images built here
rm -rf ~/korecalendar                                    # the install directory (compose files, .env, links)
# the data directory (your calendars) is yours to delete or keep:  sudo rm -rf /srv/korecalendar
```
