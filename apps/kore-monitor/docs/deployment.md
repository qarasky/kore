# Deployment

KoreMonitor runs as three containers behind one published port: Caddy is the
front door, a Rust backend serves the API, the checks and the agent downloads,
and a Next.js server renders the operator UI, the Superboard and the status
pages. This document covers installing that stack, upgrading it and rolling
back. Day-two work (database backups, restore tests, token rotation, diagnosing
a broken instance) is in [operations](operations.md); the board itself is in
[superboard](superboard.md).

## Topology

| Thing           | Value or default                                                                   |
| --------------- | ---------------------------------------------------------------------------------- |
| Public origin   | `https://monitor.example.com`, published by your own proxy, tunnel or LAN          |
| Caddy listens   | `${KOREMONITOR_BIND:-0.0.0.0}:${KOREMONITOR_PORT:-3001}`                           |
| Compose files   | `compose.yaml`; add `docker/compose.backups.yaml` when backup storage is on        |
| Environment     | `.env` beside `compose.yaml` (start from `.env.example`)                           |
| Data            | `./data/koremonitor.db` plus `./data/status-page-secret`                           |
| Backup storage  | `KOREMONITOR_BACKUP_HOST_DIR` on the host, mounted at `/app/backups`               |
| Images          | `ghcr.io/<owner>/kore-monitor-{backend,web,caddy}:<version>`, or local builds      |
| Compose project | Defaults to the checkout directory name; containers become `<project>-caddy-1` etc |

The three services:

- **`caddy`** is the only published one. It sends the backend's paths
  (`/api/*`, `/agent/*`, `/healthz`, `/add-push-server.md`, `/llms.txt`,
  `/robots.txt`) to `backend` and everything else to `web`
  (`docker/Caddyfile`, baked into its image).
- **`backend`** is the Rust backend. It is not published; it reaches the
  internet over the `egress` network for its checks and alerts.
- **`web`** is the Next.js server (operator UI, Superboard, status pages). It
  is on the internal network only and reaches the backend at
  `http://backend:3001`.

The database is `data/koremonitor.db`. An install from an earlier release keeps
its original database file name, and the backend uses whichever file it finds.

Caddy speaks plain HTTP. TLS ends in front of it, in a reverse proxy, a
Cloudflare Tunnel or another load balancer, and that hop is what makes session
cookies `Secure`. Caddy trusts `X-Forwarded-Proto` and `CF-Connecting-IP` only
from `KOREMONITOR_SUBNET` (the Docker host reaching the published port), so nobody
outside can choose their own sign-in "client address". Bind to loopback
(`KOREMONITOR_BIND=127.0.0.1`) when a proxy on the same host is the only way in,
or leave the default and firewall the port to that proxy.

`KOREMONITOR_PUBLIC_URL` is the absolute origin the provisioning documents and the
installer use to render links. Without it they fall back to the request's
`Host` header. The same `.env` carries the `KORE_ID_*` keys that make Kore ID
sign-in work ([sso](sso.md)); with them unset nobody can sign in.

## Before the first deploy

- A Linux host, `amd64` or `arm64`, with Docker Engine 24 or newer and the
  Compose v2 plugin. Rootful Docker is assumed; the compose file's published
  port and proxy trust behave differently under rootless Docker or Docker
  Desktop.
- Two cores and roughly 2 GB of memory are comfortable for the three
  containers; the compose file caps them at 1 GB, 512 MB and 256 MB.
- Somewhere for `./data` that is backed up, and ideally a second, redundant
  disk for backup bundles.
- A DNS name and a TLS-terminating proxy or tunnel if the instance is public.
  Plain HTTP on the LAN works too; status pages and cookies do not require
  TLS, but sign-in sessions should have it.
- An application in Kore ID: issuer URL, client id, client secret and the
  redirect URI `${KOREMONITOR_PUBLIC_URL}/api/v1/auth/sso/callback`. This is the
  only browser sign-in.
- Outbound internet for the checks and alerts. Inbound needs only the proxy.

Copy `.env.example` to `.env` and fill it in before the first start:

| Variable                      | What                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `KOREMONITOR_PUBLIC_URL`      | Absolute origin, e.g. `https://monitor.example.com`.                                               |
| `KORE_ID_ISSUER`              | Kore ID issuer. Empty means no sign-in method is configured.                                       |
| `KORE_ID_CLIENT_ID`           | Client id, `flatline` by default.                                                                  |
| `KORE_ID_CLIENT_SECRET`       | Client secret. Never commit it.                                                                    |
| `KORE_ID_REDIRECT_URI`        | Optional override; defaults to `${KOREMONITOR_PUBLIC_URL}/api/v1/auth/sso/callback`.               |
| `KORE_ID_AUTO_PROVISION`      | `true` (default) creates a full operator account on the first admitted sign-in.                    |
| `KORE_ID_ALLOWED_EMAILS`      | Optional comma-separated allow list on top of Kore ID's own app access.                            |
| `KOREMONITOR_BIND`            | Host interface for Caddy, `0.0.0.0` by default. Use `127.0.0.1` behind a same-host proxy.          |
| `KOREMONITOR_PORT`            | Host port for Caddy, `3001` by default.                                                            |
| `KOREMONITOR_SUBNET`          | Network Caddy trusts `X-Forwarded-*` from, `172.31.254.0/24` by default. Change it if it collides. |
| `KOREMONITOR_IMAGE_PREFIX`    | Image name before `-backend`, `-web` or `-caddy`.                                                  |
| `KOREMONITOR_VERSION`         | Image tag, `edge` by default; pin a release tag in production.                                     |
| `KOREMONITOR_BACKUP_HOST_DIR` | Host directory for backup bundles; only read when the backups override is used.                    |

## Installing

Published images are the normal path:

```bash
git clone https://github.com/qarasky/kore-monitor.git
cd kore-monitor
cp .env.example .env
$EDITOR .env
docker compose pull
docker compose up -d --wait
```

To build from the checkout instead of pulling, use one command:

```bash
docker compose up -d --build
```

That builds the three images tagged with `KOREMONITOR_VERSION` (default `edge`).
Set `KOREMONITOR_VERSION=local` for a build you do not want to confuse with a
published tag.

The database is created and migrated on first start. `--wait` returns once all
healthchecks pass; `docker compose ps` should show `caddy`, `backend` and `web`
healthy with zero restarts. Then open the public origin, sign in through Kore
ID, and finish the setup in the web app. The first person Kore ID admits
becomes a full operator; there is no seed script and no first-account token.

Once someone can sign in, mint an operator API token on **Tokens**. The
provisioning runbook and the agent installer are token-gated, so a fresh
install needs one before it can add hosts.

## Published images (GHCR)

`.github/workflows/images.yml` builds the backend, web and Caddy images for
`linux/amd64` and `linux/arm64` after `ci.yml` passes, and publishes
`ghcr.io/<owner>/kore-monitor-{backend,web,caddy}`:

- `:edge` and `:sha-<short>` on every push to `master`;
- `:X.Y.Z`, `:X.Y`, `:X` and `:latest` for a `vX.Y.Z` tag (`:latest` is skipped
  for a pre-release tag, and `:X` for a `v0.y.z` one).

A tag also creates the GitHub release. `KOREMONITOR_VERSION` chooses the tag and
`KOREMONITOR_IMAGE_PREFIX` the repository, so pinning production is a one-line
`.env` change:

```dotenv
KOREMONITOR_VERSION=1.2.3
```

Use `:edge` only for a test instance: it moves with every push to `master`.

## Building the images

`docker compose build` covers the normal case. Building by hand is useful for a
release you want to tag yourself:

```bash
docker build --target release -f docker/rust.dockerfile \
    -t ghcr.io/qarasky/kore-monitor-backend:local .
docker build -f docker/web.dockerfile \
    --build-arg KOREMONITOR_BUILD_ID="$(git rev-parse --short HEAD)" \
    -t ghcr.io/qarasky/kore-monitor-web:local .
docker build -f docker/caddy.dockerfile \
    -t ghcr.io/qarasky/kore-monitor-caddy:local .
```

Set `KOREMONITOR_VERSION=local` so the compose file uses those tags. With a
different `KOREMONITOR_IMAGE_PREFIX`, tag the images with that prefix instead.

- `docker/rust.dockerfile` builds the telemetry agent (Go, linux/amd64 and
  linux/arm64, with `VERSION` and `sha256sums` beside the binaries), the backup
  agent and the backend (Rust release) into one runtime image. The
  `docs/provisioning.md` runbook and `agent-install.sh` land at
  `/docs/provisioning.md` and `/agent-install.sh` in the image, where the
  backend's `include_str!` paths expect them.
- `docker/web.dockerfile` builds the Next.js standalone server.
  `KOREMONITOR_BUILD_ID` (the commit) is the build id open tabs compare against
  `GET /build`: after a deploy the kiosk and status pages reload themselves,
  and admin pages offer Reload.
- `docker/caddy.dockerfile` is the stock Caddy image with `docker/Caddyfile`,
  validated at build time.

A build always reflects what is on disk, so fetch or check out the commit you
mean to ship before building. `GET /build` is what tells you which commit the
web image was built from.

### The non-root image

The backend image runs the backend as `koremonitor` (uid/gid 10001). Its entrypoint
(`docker/entrypoint.sh`) starts as root only long enough to make sure
`/app/data` belongs to that user, then drops privileges with `setpriv` and
execs the backend (still PID 1, still handling SIGTERM itself).

- **Existing root-owned data needs no manual step.** On the first start of a
  non-root image the entrypoint finds the root-owned files in the data
  directory and re-owns them (`entrypoint: handing /app/data to koremonitor` in the
  log); later starts find nothing to do. The manual equivalent, if ever wanted,
  is `sudo chown -R 10001:10001 ./data`.
- Host-side tools still work: root reads the 10001-owned files (backups,
  `status-page-secret`), and a file root restores is handed back on the next
  start.
- ICMP monitors run `ping` without root. The image gives the binary
  `cap_net_raw` (permitted only), and the compose file sets
  `net.ipv4.ping_group_range` so unprivileged ICMP sockets work even with
  `NET_RAW` dropped. A ping monitor failing with `Operation not permitted`
  means both were removed.
- The compose file bounds every container:
  - `mem_limit`: 1g for the backend, 512m for the web app, 256m for Caddy.
  - `pids_limit`.
  - `stop_grace_period`: 30s for the backend (its graceful shutdown takes up to
    about 20 s), 20s for Caddy (it drains for 10 s) and 20s for the web app.
  - json-file log rotation, `10m` times 5.

  The web app and Caddy also run read-only with every capability dropped (Caddy
  adds back only `NET_BIND_SERVICE`, to bind port 80). Those settings live in
  `compose.yaml`, not in the images, so pull the current compose file when you
  upgrade.

## Releasing

An upgrade replaces the three containers. Migrations run at startup, so the
recreate is the whole database step; taking a database copy first is what makes
a rollback possible. A deploy is also a fleet rollout: the backend image
carries both agents' builds, and hosts self-update from it (see
[agent versions](#agent-versions)).

The whole sequence, run from the directory that holds `compose.yaml`:

```bash
# 0. Record what is running, so you know where to roll back to.
docker compose ps
docker image ls | grep kore-monitor

# 1. Take a consistent copy of the database (SQLite backup API, not cp).
mkdir -p backups
BM=backups/pre-$(date -u +%Y%m%d-%H%M%S).db
python3 - "$BM" <<'PY'
import sqlite3, sys
live = sqlite3.connect("file:./data/koremonitor.db?mode=ro", uri=True)
copy = sqlite3.connect(sys.argv[1])
with copy:
    live.backup(copy)
result = copy.execute("PRAGMA integrity_check").fetchone()[0]
print(result)
sys.exit(0 if result == "ok" else 1)
PY
chmod 600 "$BM"

# 2. Fetch the new images (or `docker compose build` for a local build).
docker compose pull

# 3. Recreate. Add `-f docker/compose.backups.yaml` if backup storage is on.
docker compose up -d --wait
```

Run the block as one piece so the copy is taken right before the recreate.
Only recreate once the copy printed `ok`. The backup API reads a live database
safely; never use `cp` on it.

If you enabled backup storage, pass `-f docker/compose.backups.yaml` on every
`up`. With `compose.yaml` alone the backend is recreated without the backup
mount and uploads answer 503. `ps`, `logs` and `down` work with either form.

A recreate is a few seconds of downtime on the public origin, plus up to about
20 s while the old backend shuts down gracefully (`stop_grace_period: 30s`).
Caddy restarts too (it drains open requests and streams for up to 10 s first)
and answers 502 until the backend and the web app are up. Any release that
shipped migrations also spends that time applying them.

### Verifying a release

```bash
docker compose ps                     # three services healthy, restarts 0
curl -fsS localhost:3001/healthz
curl -fsS -H "Authorization: Bearer $TOKEN" localhost:3001/api/v1/health
curl -fsS "localhost:3001/agent/version?token=$TOKEN"
curl -fsS localhost:3001/build
```

`TOKEN` is an operator API token from **Tokens**, not the sign-in session.
Check by hand, in order:

1. Three containers `healthy`, zero restarts; `/healthz` returns 200.
2. `/api/v1/health`: `total` equals the expected monitor count, `down` equals
   the monitors you expect to be down (usually zero).
3. The new migrations are applied (`SELECT version FROM _sqlx_migrations ORDER
BY version` in the database) and any new columns exist.
4. `/agent/version` reports the expected version for `linux-amd64` and
   `linux-arm64`, and the served binary's sha256 matches `sha256sums`.
5. The runbook renders the right origin and agent version.
6. `/build` answers the commit the web image was built from.
7. The public origin answers through the proxy:
   - `/sign-in`, `/status/<slug>`, `/superboard/kiosk` and `/healthz` return 200;
   - `/api/v1/monitors` returns 401 unauthenticated;
   - signing in sets a `Secure` cookie when the origin is HTTPS.
8. Every agent resumed pushing: the newest telemetry per push monitor is
   seconds old.

If a check fails, stop and roll back rather than debugging forward.

## Rolling back

A code rollback is **not** enough on its own: `sqlx` refuses to start a binary
that does not know a migration the database has applied, so the database has to
go back with the code.

1. Point `KOREMONITOR_VERSION` at the release you were running before, or check out
   that commit and rebuild.
2. If the release shipped migrations, stop the stack (`docker compose down`),
   restore the pre-release copy over `data/koremonitor.db`, and remove its `-wal`
   and `-shm` siblings first. A file restored by root is fine: the entrypoint
   hands it back to the container user on start.
3. Start the stack (add `-f docker/compose.backups.yaml` if backup storage is
   on):

   ```bash
   docker compose up -d --wait
   ```

Restore the pre-release backup whenever migrations shipped in the release you
are backing out of. If the release only changed code, the image swap alone is
enough. Rolling a migration back by editing the database is not supported; the
copy you kept is the way back. See
[operations](operations.md#by-hand) for the backup and restore details.

## Agent versions

A deploy is a fleet rollout. The backend image carries the telemetry agent
(`/agent/*`) and the backup agent (`/api/backup/v1/release/*`), and each host
checks daily and self-updates to what the server ships. Shipping an image
therefore upgrades the whole fleet over the following day; ship agent changes
deliberately.

- The telemetry agent self-updates from release 1.7.0 onward. A host on an
  older build needs one manual hop per host:

  ```bash
  curl -fsSL '<origin>/agent/install.sh?token=<push token>' | sudo bash -s -- --update
  ```

- The backup agent is versioned separately (`0.x`) and self-updates from 0.3.0.
  A host on an older build needs one manual install, then
  `flatline-backup install --config ...` for each instance so the self-update
  units are written.

Details, config keys and troubleshooting are in [agent](agent.md) and
[backup-agent](backup-agent.md#self-update).

### Host-down noise

Agent hosts use `maxretries: 2` with `retryInterval: 180`. With `maxretries: 0`,
a single missed window (interval plus 1 s) declares the monitor down instantly
and the parent group amplifies it, which can turn a provider blip into a burst
of messages. With two retries a missed heartbeat reads as pending for roughly
nine minutes and only real outages page.

## Backup storage

Backup agents upload bundles to the backend, and the backend writes them to a
host directory. That storage is opt-in: without it uploads answer 503 and
everything else works. Named backup agents need a dedicated directory, separate
from `./data`:

```bash
sudo install -d -m 0700 /srv/koremonitor-backups
uuidgen | tr 'A-Z' 'a-z' \
    | sudo tee /srv/koremonitor-backups/.koremonitor-backup-storage >/dev/null
sudo chmod 0600 /srv/koremonitor-backups/.koremonitor-backup-storage
```

The marker file is what tells an operator, or a later run, that this is a
KoreMonitor backup store rather than a stray directory. A marker written by an
earlier release is still accepted. Then set the host path in `.env` and start
the stack with the override:

```dotenv
KOREMONITOR_BACKUP_HOST_DIR=/srv/koremonitor-backups
```

```bash
docker compose -f compose.yaml -f docker/compose.backups.yaml up -d
```

`docker/compose.backups.yaml` sets `KOREMONITOR_BACKUP_DIR=/app/backups` and binds
`KOREMONITOR_BACKUP_HOST_DIR` there read-write. Compose never creates the host
path, so a typo fails the start instead of filling the root filesystem. Put the
directory on a redundant disk if you have one, and check it is the mount you
think it is (`findmnt /srv/koremonitor-backups`) before trusting it with
bundles.

Back up `data/koremonitor.db` with SQLite's online backup API before the first
migration that enables storage. Migrations are additive and apply at startup.
Bundle layout, retention and restore are in
[backup-agent](backup-agent.md#where-bundles-are-stored); backing up
KoreMonitor's own database is in [operations](operations.md#nightly-backups).

## Known limitations

- `data/` is owned by uid 10001 (the container's `koremonitor` user), and
  `koremonitor.db` is mode 0644 inside a 0755 directory. That is harmless while
  only trusted operators have shell access, since every account is a full
  operator; tighten it if other shell users ever appear.
- Docker does not restart an `unhealthy` container on its own. Run an off-host
  probe of the public `/healthz` so an outage of the monitor itself is noticed
  ([operations](operations.md#watching-the-watcher)).
- The database is one SQLite file with a single writer. Run exactly one stack
  per database directory; there is no replication or high-availability mode.
- A local build needs network access to the registry and to the Go, npm and
  Rust module mirrors on a cold cache. A warm cache rebuild is a couple of
  minutes.
- There is no single-binary mode. Running without Docker means running the
  backend, the web app and a reverse proxy yourself; see
  [development](development.md).
