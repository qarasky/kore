<img src="assets/mark.svg" width="64" height="64" alt="KoreMind">

# KoreMind

[![CI](https://github.com/qarasky/koremind/actions/workflows/ci.yml/badge.svg)](https://github.com/qarasky/koremind/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/qarasky/koremind?include_prereleases)](https://github.com/qarasky/koremind/releases)

A personal assistant that feels like the ChatGPT app, with its own apps instead of a bot inside Telegram or Discord. Fast, few settings, and it remembers you.

- **Backend** (`backend/`): Bun + TypeScript. Accounts, chats, memory, notes, streaming. It drives a local [OpenCode](https://opencode.ai) server for the models.
- **Web UI** (`web/`): Next.js, runs as its own process on the same machine.
- **Android app** (`android/`): native Kotlin + Jetpack Compose. Same features and wording as the web UI.
- Dark only, with [Kore](https://github.com/qarasky/kore)'s palette.

## What it does

- **Chat** with streaming Markdown, photos and files, a model picker (provider rail, favorites, thinking level) and web search. Chats are named automatically by the model you chose.
- **Providers:** OpenCode (free models need no key), **Codex** (OpenAI: sign in with ChatGPT or paste an API key) and **OpenRouter** (API key). Each can be turned off, and OpenCode and OpenRouter can be limited to free models, in **Settings → Providers**.
- **Memory** you can see and edit. The assistant decides what is worth remembering; it is written in the background so it never slows an answer.
- **Notes:** the assistant can save, read and edit notes, per chat and per user. Asking it to use another chat's notes shows an **Allow / Deny** card. Notes live in KoreMind's own database.
- **Phone pairing:** Settings → Account → **Show QR code** on the web, then **Scan QR code** in the Android app. It signs the phone in as you, no typing.

## Run it (development, one machine)

You need [Bun](https://bun.sh) and the `opencode` CLI (v2) on your PATH.

```bash
bun install
bun run start        # backend on :8787 and web UI on :3210
```

The first run builds the web UI. The backend prints the addresses it is reachable at (local IP, a Tailscale address if you have one, or `KOREMIND_PUBLIC_URL` if set). Open the web UI on the same machine and it finds the backend by itself; create your account on first run (the first account is the owner).

For the phone: install the app, scan the QR code from the web UI (or type one of the printed addresses into **Backend URL**) and sign in. KoreMind does no tunnel or TLS setup; use Tailscale, a Cloudflare tunnel or your own domain for access away from home.

To run it on a server: **[Docker](docs/deployment-docker.md)** (prebuilt images on GHCR, the easy way) or **[a Linux service with systemd](docs/deployment-linux.md)**. Android builds come with each [GitHub Release](https://github.com/qarasky/koremind/releases) as a signed APK.

### Settings (environment)

| Setting | Default |
| --- | --- |
| `KOREMIND_PORT` | `8787` (backend) |
| `KOREMIND_DATA_DIR` | `./data` relative to where you start it. Holds the database, uploads, memory and OpenCode's state, **including provider keys**. |
| `KOREMIND_WEB_PORT` | `3210` |
| `KOREMIND_WEB_MODE` | `start` (production build). `dev` runs Next.js in dev mode. |
| `KOREMIND_PUBLIC_URL` | unset; shown as the `domain` address and put into phone-pairing QR codes |
| `KOREMIND_TRUST_PROXY=1` | believe `x-forwarded-for` from any peer (a proxy on this machine is trusted automatically) |
| `KOREMIND_OPENCODE_BIN` | `opencode`; set the full path when running under a service manager |
| `KOREMIND_FAKE_ENGINE=1` | run without OpenCode (scripted replies, and `note: …` / `read <chat title>` to exercise notes) for development |

## Develop

```bash
bun test                                         # backend, shared, web, scripts
cd android && ./gradlew :app:testDebugUnitTest   # Android logic
cd android && ./gradlew :app:assembleDebug       # debug APK (app/build/outputs/apk/debug)
bun run build                                    # production build of the web UI
bun run backend/scripts/latency.ts               # time to first token against a running backend
bun run scripts/generate-icons.ts                # regenerate the mark everywhere
bun scripts/version.ts set 0.2.0                 # bump the version everywhere (see docs/releasing.md)
```

CI (`.github/workflows/ci.yml`) runs the same checks on every pull request. Releases are made by pushing a `vX.Y.Z` tag.

web and Android are kept 1:1: same features, same strings, same pure helpers with their own tests. When you change one, change the other.

## Docs

| Document | What it is |
| --- | --- |
| [DESIGN.md](DESIGN.md) | How KoreMind looks, moves and talks (tokens, components, motion, copy). The contract for both clients. |
| [docs/api.md](docs/api.md) | The REST + SSE contract. Source of truth is `shared/src/api.ts`. |
| [docs/deployment-docker.md](docs/deployment-docker.md) | Running KoreMind from the GHCR images with Docker Compose. |
| [docs/deployment-linux.md](docs/deployment-linux.md) | Running KoreMind on a Linux server with systemd. |
| [docs/releasing.md](docs/releasing.md) | Versioning, the CI/CD pipelines, image tags, Android signing. How to cut a release. |
| [docs/research/design-research.md](docs/research/design-research.md) | The design research behind Settings, the composer, the picker and motion. |
| [docs/superpowers/specs/2026-11-02-koremind-design.md](docs/superpowers/specs/2026-11-02-koremind-design.md) | The original product design, with a list of later amendments at the top. |
| [docs/superpowers/notes/engine-spike.md](docs/superpowers/notes/engine-spike.md) | What was learned about OpenCode (API shapes, quirks, how tools and titles work). |
| [docs/superpowers/plans/2026-11-02-koremind.md](docs/superpowers/plans/2026-11-02-koremind.md) | The first build plan (historical). |
