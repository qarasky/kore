<img src="assets/mark.svg" width="64" height="64" alt="Zero">

# Zero

A personal assistant that feels like the ChatGPT app, with its own apps instead of a bot inside Telegram or Discord. Fast, few settings, and it remembers you.

- **Backend** (`backend/`): Bun + TypeScript. Accounts, chats, memory, streaming. It drives a local [OpenCode](https://opencode.ai) server for the models.
- **Web UI** (`web/`): Next.js, runs as its own process on the same machine.
- **Android app** (`android/`): native Kotlin + Jetpack Compose.
- Dark only, with [Kore](https://github.com/qarasky/kore)'s palette. Web search is the only tool.

## Run it

You need [Bun](https://bun.sh) and the `opencode` CLI on your PATH.

```bash
bun install
bun run start        # backend on :8787 and web UI on :3210
```

The backend prints the addresses it is reachable at (local IP, a Tailscale address if you have one, or `ZERO_PUBLIC_URL` if you set it). Open the web UI on the same machine and it finds the backend by itself; create your account on first run (the first account is the owner).

For the phone, install the app, type one of the printed addresses into **Backend URL**, and sign in. Zero does no tunnel or TLS setup: use Tailscale, a Cloudflare tunnel or your own domain if you want access away from home, and put that address in the app.

OpenCode's free models work with no key, but the free quota is limited. When it runs out, Zero says so; add a key under **Settings → Connected providers**.

Zero also offers **Codex** (OpenAI, sign in with ChatGPT or paste an API key) and **OpenRouter** (API key) under the same section. The ChatGPT sign-in must be finished in a browser on the computer that runs Zero.

| Setting | Default |
| --- | --- |
| `ZERO_PORT` | `8787` |
| `ZERO_DATA_DIR` | `./data` (database, uploads, memory, OpenCode state) |
| `ZERO_WEB_PORT` | `3210` |
| `ZERO_PUBLIC_URL` | unset; shown as the `domain` address |
| `ZERO_TRUST_PROXY=1` | believe `x-forwarded-for` from any peer (a tunnel on this machine is trusted automatically) |
| `ZERO_FAKE_ENGINE=1` | run without OpenCode (scripted replies) for development |
| `ZERO_OPENCODE_BIN` | `opencode` |

## Develop

```bash
bun test                                         # backend, shared, web, scripts
cd android && ./gradlew :app:testDebugUnitTest   # Android logic
cd android && ./gradlew :app:assembleDebug       # debug APK
bun run backend/scripts/latency.ts               # time to first token against a running backend
bun run scripts/generate-icons.ts                # regenerate the mark everywhere
```

Docs: [design](docs/superpowers/specs/2026-11-02-zero-design.md), [plan](docs/superpowers/plans/2026-11-02-zero.md), [API contract](docs/api.md), [engine notes](docs/superpowers/notes/engine-spike.md).

## Design

See [`DESIGN.md`](DESIGN.md) for how Zero looks and moves, and [`docs/research/design-research.md`](docs/research/design-research.md) for the research behind it.

## Notes, approvals and phone pairing

The assistant can save, read and edit notes (per chat, per user). Asking it to use another chat's notes pops an Allow/Deny card in the chat. Notes tools are served to the local OpenCode engine by Zero itself on loopback (`/mcp`, protected by a per-run secret), so notes live in Zero's own database.

To sign a phone in without typing: Settings → Account → Show QR code on the web, then Scan QR code in the Android app.
