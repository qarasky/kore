<img src="assets/icon.svg" width="64" height="64" alt="">

# Kore

A small self-hosted file server for an office: personal spaces and a shared
space, drag-and-drop uploads (chunked and resumable, so large files work
through Cloudflare Tunnel), folders, trash, text previews, search, per-user
quotas and an admin panel. Go API + Next.js (SSR) UI behind Caddy, data in
plain files plus one SQLite database.

## Requirements

- Linux with Docker Engine and the Compose plugin (`docker compose`).
- A directory for the data, e.g. on a mounted RAID volume (`/mnt/mirror/kore`).
- Ports: one free host port for Caddy (default `127.0.0.1:8080`).

## Install

```sh
git clone <this repo> kore && cd kore
cp kore.docker.example.toml kore.toml && cp .env.example .env   # then edit both (see below)
docker compose run --rm api kore init -config /etc/kore/kore.toml
docker compose up -d
```

Before running the last two commands:

- In `kore.toml` set `admin_email` and a real `admin_password` of at least 8
  characters (Kore refuses to start with `change-me` or a shorter password).
  Leave `bind = "0.0.0.0"`, `port = 8080` and `data_dir = "/data"`: those are
  inside the container.
- In `.env` set `KORE_DATA_DIR` (host path of the data dir) and
  `KORE_UID`/`KORE_GID` (the host user that should own the files; `id -u` and
  `id -g` of e.g. `office`).
- Create the data dir and give it to that user (run as that user, or put
  your `KORE_UID`/`KORE_GID` in place of `$(id -u)`/`$(id -g)`). Docker will
  not create it for you (on purpose, see below):

  ```sh
  sudo install -d -o "$(id -u)" -g "$(id -g)" /mnt/mirror/kore
  ```

Then open `http://127.0.0.1:8080` (or your `KORE_PORT`). Check health with
`docker compose ps` (all three `healthy`) or `curl -s localhost:8080/api/healthz`.

`kore.example.toml` is for running the binary without Docker (`kore -config
kore.toml`); its `bind` (default `127.0.0.1`) only matters there. With Docker,
where Kore is reachable is decided by `KORE_BIND`/`KORE_PORT` in `.env`.

## LAN / Tailscale

By default Caddy is published on `127.0.0.1` only (for a tunnel running on the
same host). To reach Kore from the LAN or Tailscale, set in `.env`:

```sh
KORE_BIND=0.0.0.0     # or one address, e.g. the Tailscale IP
```

and run `docker compose up -d`. Kore is then at `http://<server>:8080`. This is
plain HTTP; use it only on networks you trust.

With `KORE_BIND=0.0.0.0`, check what Docker actually published:

```sh
docker port "$(docker compose ps -q caddy)"
```

It must list IPv4 only (`80/tcp -> 0.0.0.0:8080`). If it also shows
`[::]:8080`, IPv6 clients are forwarded by Docker's userland proxy and arrive
at Caddy from the gateway of its network, i.e. they look like the Docker host
and their `CF-Connecting-IP`/`X-Forwarded-*` headers are trusted (see below).
To publish on IPv4 only, set `KORE_BIND` to the server's IPv4 LAN or Tailscale
address (e.g. `KORE_BIND=192.168.1.10`) instead of `0.0.0.0`, run
`docker compose up -d`, and check `docker port` again.

## Cloudflare Tunnel (`files.example.com`)

`cloudflared` is not part of the stack. With `cloudflared` running on the same
host, add a public hostname to the tunnel:

- Hostname: `files.example.com`
- Service: `http://127.0.0.1:8080` (the `KORE_BIND:KORE_PORT` from `.env`).
  Use `127.0.0.1`, not `localhost`, which may resolve to `::1`, where nothing
  is published by default. If `cloudflared` runs in a container, use an
  address it can reach and set `KORE_BIND` accordingly.

### Which proxy headers are trusted

Caddy honours `X-Forwarded-Proto` (`https` makes the session cookie `Secure`)
and `CF-Connecting-IP` (the client IP the API uses for login rate limiting)
only on connections that come from the Docker host itself. `cloudflared` on
the host connects to the published port through Docker's port proxy and
arrives from the gateway of Caddy's network, whose subnet is fixed
(`KORE_SUBNET`, default `172.31.255.0/24`; change it in `.env` if it collides
with a network you use). Clients on the LAN or Tailscale reach Caddy with
their own address, even a private one, so their `CF-Connecting-IP` is dropped
and their `X-Forwarded-*` headers are replaced with what Caddy actually sees:
they cannot pick a fresh "client IP" per login attempt or fake HTTPS. Note
that containers on other Docker networks of the same host also count as the
host.

This model only holds when LAN clients really reach Caddy with their own
address. In these setups every client arrives from the gateway or another
trusted address and is therefore trusted, so do not expose Kore to the LAN
with them (or put your own proxy in front that strips those headers):

- IPv6 published by Docker's userland proxy (see "LAN / Tailscale" above).
- Rootless Docker (its port forwarder, RootlessKit/slirp4netns, hides the
  client address).
- Docker with `"iptables": false` in `daemon.json` (all published traffic goes
  through the userland proxy).
- A front proxy container attached to Caddy's `edge` network: everything it
  forwards comes from inside `KORE_SUBNET`, so it must itself overwrite
  `CF-Connecting-IP` and `X-Forwarded-*` with the real client's values.

Without Docker (`kore -config kore.toml`), the API itself trusts
`CF-Connecting-IP`/`X-Forwarded-For` from any loopback or private peer. Keep
`bind = "127.0.0.1"` there and put a proxy in front that removes those headers
from untrusted clients.
Cloudflare's 100 MB request limit does not matter: the UI uploads in 8 MiB
chunks and resumes interrupted uploads. Downloads (including zips) stream.

## The data volume marker

The data dir must contain a file named `.kore-volume`. `kore init` creates it
(plus `blobs/` and `tmp/uploads/`); the API refuses to start without it:

```
volume: volume marker .kore-volume missing in /data (wrong or unmounted volume? run `kore init` to initialize)
```

This protects against the RAID (mdadm, ZFS, a USB disk, any mount) not being
mounted when the server boots: the empty mount point would otherwise look like
a fresh install and new files would land on the root disk. That is also why
nothing creates the marker or the data dir automatically, and why the compose
file refuses to start if `KORE_DATA_DIR` does not exist. Run `kore init` once,
by hand, on the real volume. It is safe to re-run (it never touches data).

## Backups

Everything lives in the data dir: `kore.db` (SQLite in WAL mode, with
`kore.db-wal`/`kore.db-shm` next to it), `blobs/` (file contents) and
`tmp/uploads/` (unfinished uploads, not needed in a backup).

Simplest consistent backup: stop the API, copy, start it again.

```sh
docker compose stop api
sudo rsync -a --delete /mnt/mirror/kore/ /backup/kore/
docker compose start api
```

Online (no downtime): copy the blobs first, then snapshot the database with
SQLite's backup command (needs `sqlite3` on the host: `sudo apt install
sqlite3`).

```sh
sudo rsync -a /mnt/mirror/kore/blobs/ /backup/kore/blobs/
sqlite3 /mnt/mirror/kore/kore.db ".backup '/backup/kore/kore.db'"
```

The order matters. A file uploaded between the two steps then exists only as
an extra blob that the snapshot does not know about, and Kore removes such
orphans by itself. The other order could give a snapshot that points at a
blob the backup does not contain. Without `--delete`, blobs of files purged
since the last run stay in the backup until you prune it (e.g. with a
stop-the-API backup).

Do not copy `kore.db` alone with `cp` while Kore is running. To restore, stop
the stack, put `kore.db`, `blobs/` and an empty `.kore-volume` into the data
dir (owned by `KORE_UID:KORE_GID`), and start it.

## Upgrading

```sh
git pull && docker compose build && docker compose up -d
```

Database migrations run automatically on start. If the `Caddyfile` changed,
also run `docker compose restart caddy` (its admin API is off, so it does not
reload by itself).

## First login and the admin password

Log in with `admin_email`/`admin_password` from `kore.toml`. The admin account
is created only on the very first start (when there are no users); after that
`kore.toml`'s password is ignored. Change it in the UI under **Account**
(top-right menu), and add users under **Admin**. You can then replace the
password in `kore.toml` with anything other than `change-me`.

## Troubleshooting

- **`api` keeps restarting, log says `volume marker .kore-volume missing`**
  (`docker compose logs api`): the data volume is not mounted, `KORE_DATA_DIR`
  points to the wrong place, or `kore init` was never run. Mount the volume or
  fix `.env`; run `kore init` only for a genuinely new data dir.
- **`bind source path does not exist`**: `KORE_DATA_DIR` or `./kore.toml` is
  missing. Create/mount it (see Install).
- **`admin_password is still the placeholder "change-me"`** or
  **`admin_password must be at least 8 characters`**: edit `kore.toml`.
- **Port already in use / `address already in use`**: change `KORE_PORT` in
  `.env`, then `docker compose up -d`.
- **`permission denied` on `/data/...`**: the data dir is not owned by
  `KORE_UID:KORE_GID`. Fix with
  `sudo chown -R "$(id -u):$(id -g)" /mnt/mirror/kore` (run as the user in
  `KORE_UID`/`KORE_GID`), or set
  `KORE_UID`/`KORE_GID` to the dir's owner.
- **Logged out right after logging in over plain HTTP**: something in front of
  Caddy is sending `X-Forwarded-Proto: https` for an `http://` URL; use the
  HTTPS hostname or remove that header.

## Development

See `api/` (Go, `go test ./...`) and `web/README.md` (Next.js, unit and
Playwright tests, including running e2e against a compose stack).
