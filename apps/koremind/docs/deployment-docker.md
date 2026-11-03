# Running KoreMind with Docker

The same thing as [the Linux guide](deployment-linux.md), without installing Bun, Node or OpenCode on the host. Two images, both from GHCR (see [releasing.md](releasing.md) for the tags):

| Image | Holds | Port |
|---|---|---|
| `ghcr.io/qarasky/koremind-backend` | The API, plus the OpenCode v2 engine it starts and owns. Runs as an unprivileged user. | `8787` |
| `ghcr.io/qarasky/koremind-web` | The web UI. It has no backend address built in: you enter it on the connect screen, so one image fits any setup. | `3210` |

## Start

```bash
curl -fsSLO https://raw.githubusercontent.com/qarasky/koremind/main/deploy/docker-compose.yml
KOREMIND_VERSION=0.1.0 docker compose up -d
docker compose ps                         # both should become "healthy"
curl http://localhost:8787/health         # {"name":"koremind","version":"0.1.0","setupRequired":true}
```

Open <http://localhost:3210>, enter `http://localhost:8787` when asked, and create the owner account (the first registration is the owner). Then add providers in **Settings → Providers**.

`KOREMIND_VERSION` can be a full version (`0.1.0`, recommended), a minor line (`0.1`, gets patch fixes), `latest` (newest stable release) or `edge` (current `main`, for trying things). Put the variables in a `.env` file next to the compose file if you prefer.

## Settings

| Variable | Meaning |
|---|---|
| `KOREMIND_VERSION` | Image tag. Default `latest`. |
| `KOREMIND_PORT`, `KOREMIND_WEB_PORT` | Host ports. Defaults `8787` and `3210`. |
| `KOREMIND_PUBLIC_URL` | The address phones and browsers use to reach the backend (`https://api.example.com`). **Set it** if you use QR sign-in: inside a container the backend only knows its internal Docker address, which a phone cannot reach. |
| `KOREMIND_TRUST_PROXY=1` | Only when a proxy on another machine terminates TLS in front of the backend. |

## Data and backups

Everything lives in the `koremind-data` volume, mounted at `/data`: accounts, chats, notes, uploads and the engine state, **including provider API keys and sign-ins**. Back it up and treat the backup as a secret.

```bash
docker run --rm -v koremind-data:/data -v "$PWD":/out alpine tar czf /out/koremind-$(date +%F).tgz -C /data .
```

## Updating

```bash
KOREMIND_VERSION=0.2.0 docker compose pull
KOREMIND_VERSION=0.2.0 docker compose up -d
```

Database migrations run at start. To go back, start the older tag, but restore a backup first if the newer version had already migrated the database.

## Remote access

Same options as the Linux guide ([Tailscale or a domain](deployment-linux.md)). Put TLS in front of both ports, keep `/mcp` unreachable from outside (it is for the engine inside the container only), and set `KOREMIND_PUBLIC_URL`.

## Sign in with ChatGPT (Codex) on a server

The sign-in callback listens on a port inside the container, so on a headless host use an API key for Codex, or sign in on a machine with a browser. This is untested in Docker.

## Building the images yourself

```bash
docker build -f backend/Dockerfile -t koremind-backend .
docker build -f web/Dockerfile -t koremind-web .
```

The build context is the repository root for both. `--build-arg OPENCODE_VERSION=…` picks the engine version.
