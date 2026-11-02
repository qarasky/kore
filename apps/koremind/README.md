<img src="assets/mark.svg" width="64" height="64" alt="Zero">

# Zero

A personal assistant that feels like the ChatGPT app, with its own apps instead of a bot inside Telegram or Discord. Fast, few settings, and it remembers you.

- **Backend** (`backend/`): Bun + TypeScript. Accounts, chats, memory, notes, streaming. It drives a local [OpenCode](https://opencode.ai) server for the models.
- **Web UI** (`web/`): Next.js, runs as its own process on the same machine.
- **Android app** (`android/`): native Kotlin + Jetpack Compose. Same features and wording as the web UI.
- Dark only, with [Kore](https://github.com/qarasky/kore)'s palette.

## What it does

- **Chat** with streaming Markdown, photos and files, a model picker (provider rail, favorites, thinking level) and web search. Chats are named automatically by the model you chose.
- **Providers:** OpenCode (free models need no key), **Codex** (OpenAI: sign in with ChatGPT or paste an API key) and **OpenRouter** (API key). Each can be turned off, and OpenCode and OpenRouter can be limited to free models, in **Settings → Providers**.
- **Memory** you can see and edit. The assistant decides what is worth remembering; it is written in the background so it never slows an answer.
- **Notes:** the assistant can save, read and edit notes, per chat and per user. Asking it to use another chat's notes shows an **Allow / Deny** card. Notes live in Zero's own database.
- **Phone pairing:** Settings → Account → **Show QR code** on the web, then **Scan QR code** in the Android app. It signs the phone in as you, no typing.

## Run it (development, one machine)

You need [Bun](https://bun.sh) and the `opencode` CLI (v2) on your PATH.

```bash
bun install
bun run start        # backend on :8787 and web UI on :3210
```

The first run builds the web UI. The backend prints the addresses it is reachable at (local IP, a Tailscale address if you have one, or `ZERO_PUBLIC_URL` if set). Open the web UI on the same machine and it finds the backend by itself; create your account on first run (the first account is the owner).

For the phone: install the app, scan the QR code from the web UI (or type one of the printed addresses into **Backend URL**) and sign in. Zero does no tunnel or TLS setup; use Tailscale, a Cloudflare tunnel or your own domain for access away from home.

To run it as a service on a Linux server, see **[docs/deployment-linux.md](docs/deployment-linux.md)**.

### Settings (environment)

| Setting | Default |
| --- | --- |
| `ZERO_PORT` | `8787` (backend) |
| `ZERO_DATA_DIR` | `./data` relative to where you start it. Holds the database, uploads, memory and OpenCode's state, **including provider keys**. |
| `ZERO_WEB_PORT` | `3210` |
| `ZERO_WEB_MODE` | `start` (production build). `dev` runs Next.js in dev mode. |
| `ZERO_PUBLIC_URL` | unset; shown as the `domain` address and put into phone-pairing QR codes |
| `ZERO_TRUST_PROXY=1` | believe `x-forwarded-for` from any peer (a proxy on this machine is trusted automatically) |
| `ZERO_OPENCODE_BIN` | `opencode`; set the full path when running under a service manager |
| `ZERO_FAKE_ENGINE=1` | run without OpenCode (scripted replies, and `note: …` / `read <chat title>` to exercise notes) for development |

## Develop

```bash
bun test                                         # backend, shared, web, scripts
cd android && ./gradlew :app:testDebugUnitTest   # Android logic
cd android && ./gradlew :app:assembleDebug       # debug APK (app/build/outputs/apk/debug)
bun run build                                    # production build of the web UI
bun run backend/scripts/latency.ts               # time to first token against a running backend
bun run scripts/generate-icons.ts                # regenerate the mark everywhere
```

web and Android are kept 1:1: same features, same strings, same pure helpers with their own tests. When you change one, change the other.

## Docs

| Document | What it is |
| --- | --- |
| [DESIGN.md](DESIGN.md) | How Zero looks, moves and talks (tokens, components, motion, copy). The contract for both clients. |
| [docs/api.md](docs/api.md) | The REST + SSE contract. Source of truth is `shared/src/api.ts`. |
| [docs/deployment-linux.md](docs/deployment-linux.md) | Running Zero on a Linux server with systemd. |
| [docs/research/design-research.md](docs/research/design-research.md) | The design research behind Settings, the composer, the picker and motion. |
| [docs/superpowers/specs/2026-11-02-zero-design.md](docs/superpowers/specs/2026-11-02-zero-design.md) | The original product design, with a list of later amendments at the top. |
| [docs/superpowers/notes/engine-spike.md](docs/superpowers/notes/engine-spike.md) | What was learned about OpenCode (API shapes, quirks, how tools and titles work). |
| [docs/superpowers/plans/2026-11-02-zero.md](docs/superpowers/plans/2026-11-02-zero.md) | The first build plan (historical). |
