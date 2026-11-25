# Claude through the Pi's own CLI, providers set on the server

Date: 2026-11-26. Status: approved design, not built.

## Why

Skyler wants KoreMind to use the CLIs installed and signed in on the Pi itself, not keys pasted into the apps. Signing in happens once in SSH (`claude auth login`); the apps never see or handle a credential. Claude is added as a provider through `claude -p`. OpenCode's monthly limit is used up, so OpenCode is switched off for now but kept in the code to come back.

KoreMind (like all Kore projects) has one user: Skyler. Claude still stays owner-only, as `docs/claude-integration.md` (route C) requires.

## Goals

1. **Providers come from the server's `.env`.** `KOREMIND_PROVIDERS=claude` (comma list). Providers not listed don't exist for the apps. OpenCode's engine process starts only when an OpenCode provider (`opencode`, `opencode-go`) is listed.
2. **No connecting from the apps.** Web and Android lose Add key / Replace key, ChatGPT sign-in and Disconnect. Each provider card shows only its server status and the per-person switches.
3. **A Claude engine on `claude -p`**: streaming replies, web search with sources, KoreMind's notes and memory tools, thinking levels, photo/PDF/text attachments, chat titles and memory summaries.
4. **The backend runs natively on the Pi** as user `skyler` under systemd, so it uses Skyler's CLI logins. The web UI stays in Docker.

## Non-goals

- Groq, OpenRouter and Codex: removed from `OFFERED` and the UI.
- Upgrading OpenCode to 2.4.x: later, once the limit resets. The Pi has 2.2.5, which the code is written against.
- A Claude login, button or QR inside KoreMind. Never.
- The Agent SDK. `claude -p` on the installed binary is enough and keeps the binary unmodified.

## Anti-goals (failure even if it "works")

- Claude Code able to run shell commands, read or write files on the Pi, spawn agents, schedule tasks or use Skyler's own skills, plugins, hooks, MCP servers or `CLAUDE.md`.
- KoreMind reading, copying or storing the Claude token.
- Calling it "Claude Code" in the apps.
- Claude reachable by any non-owner account (server-enforced).

## Constraints found

- `--bare` would be the cleanest isolation but accepts only `ANTHROPIC_API_KEY`, not a subscription login. Not used.
- Spike (2026-11-26, Claude Code 2.1.331, Haiku 5.5): with `--setting-sources "" --strict-mcp-config --tools WebSearch --system-prompt …` the init event lists only `WebSearch`, no MCP servers, and the model saw no `CLAUDE.md`. Skills and plugins are still *listed* in init, but without the `Skill`/`Task` tools they can't be called.
- `--resume <uuid>` continues a conversation; a short turn costs ~2.3 s wall and ~250 MB RSS while it runs, then the process exits.
- Web search results arrive as a `tool_result` whose text holds `Links: [{"title","url"}…]`. The model also tends to append its own "Sources:" list; the system prompt tells it not to (the apps show sources).
- The rate-limit state arrives as a `rate_limit_event` (`status: allowed|…`).
- The notes/memory MCP server identifies the chat by `_meta["ai.opencode/sessionID"]`, which Claude doesn't send.
- Pi: Debian 12 aarch64, 8 GB RAM, Claude Code 2.1.332 at `~/.local/bin/claude`, OpenCode 2.2.5 at `~/.opencode/bin/opencode`, no Bun yet. KoreMind runs today in Docker (`~/kore/koremind`, volume `koremind_koremind-data`), backend on `127.0.0.1:4111` behind the Cloudflare tunnel.

## Approaches considered

| | How | Trade-off |
|---|---|---|
| **A (picked)** | One `claude -p` process per message; KoreMind's session id is the Claude session uuid (`--session-id` first, `--resume` after). | Stateless, a crash loses one reply, no idle RAM. ~1–2 s startup per reply. |
| B | One long-lived `claude --input-format stream-json` per open chat. | Faster first token, but ~150–250 MB per idle chat and lifecycle code (idle kill, restart). |
| Docker + mounts | Keep the container, mount the host binary and `~/.claude`. | Fragile paths and token refresh; rejected for native systemd. |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` pointing at the host binary. | Extra dependency, untested under Bun; `-p` gives the same features. |

Skyler picked native systemd and Claude only with OpenCode dormant. Approach A is Claude's call (offered, not objected to).

## Design

### Engines and providers (backend)

- `KOREMIND_PROVIDERS` (config.ts) → list of provider ids, default `claude`. Unknown ids fail start-up with a clear message. Known: `claude`, `opencode`, `opencode-go`.
- An **engine router** implements `Engine` over several engines and dispatches each call by `providerId` (sessions remember their engine). `listProviders` / `listConnections` concatenate in `KOREMIND_PROVIDERS` order. `complete()` without a model uses the first listed provider's default model.
- `OFFERED` shrinks to `opencode`, `opencode-go`. Groq, OpenRouter and Codex code paths go (ChatGPT OAuth, `methods: signin`).
- Removed HTTP routes: `POST/DELETE /providers/:id/key`, `/providers/:id/signin[...]`. They answer 404. `GET /providers` stays (status only).
- `ProviderConnection` becomes `{ id, name, connected, supportsFreeFilter, hint }`: `hint` is the server-side instruction shown when not connected (e.g. "Run `claude auth login` on the server"). `methods` and `recommended` go; clients are updated in the same change.
- Owner-only: `models.providers(userId)` returns Claude with `status: "disabled"` and no models for non-owners; `models.allowed` therefore refuses it (`model_not_allowed`).

### Claude engine (`backend/src/engine/claude.ts`)

- Binary: `KOREMIND_CLAUDE_BIN` (default `claude` on PATH). Optional `KOREMIND_CLAUDE_CONFIG_DIR` → `CLAUDE_CONFIG_DIR`; unset = the user's own `~/.claude`.
- Every run: `claude -p --output-format stream-json --verbose --include-partial-messages --setting-sources "" --strict-mcp-config --mcp-config <json> --tools WebSearch --allowedTools "WebSearch mcp__koremind__*" --permission-prompts none --system-prompt <AGENT_SYSTEM + Claude note> --model <id> [--effort <level>] (--session-id|--resume) <uuid> --input-format stream-json`, stdin = one user message, `cwd` = `<dataDir>/claude-work` (empty), env without `CLAUDECODE`/`CLAUDE_CODE_*` from a parent session, `CLAUDE_CODE_ENTRYPOINT=koremind`.
- `--mcp-config` is a JSON string: `{"mcpServers":{"koremind":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"authorization":"Bearer <mcpSecret>","x-koremind-session":"<uuid>"}}}}`. `mcp.ts` takes the session from `_meta` (OpenCode) **or** the `x-koremind-session` header (Claude). Approval waits (60 s) must fit the MCP tool timeout (`MCP_TOOL_TIMEOUT` env ≥ 120 s).
- Event mapping: `stream_event` `text_delta` → `delta`; `tool_use` start named `WebSearch` → `status: searching`; `tool_result` of a WebSearch → `source` events parsed from `Links: […]` (max 8, deduped); `result` `success` → `done`; `result` error, non-zero exit, or a rejected rate limit → `error` (`noProvider: true` when it's a limit or "not logged in"). `separateAfterTools()` is reused. Idle watchdog as OpenCode (120 s). Abort → SIGTERM the process.
- First prompt of a session carries the `<context>` block, as OpenCode does.
- Files: sent as content blocks in the stream-json user message: images → `image` (base64), PDF → `document`, text/JSON → `text` with the file name.
- Models: a fixed catalogue in code, each `{ id, name, vision: true, thinkingLevels }`: Fable 5.2 (`claude-fable-5-2`), Opus 5.5 (`claude-opus-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`, default), Haiku 5.5 (`claude-haiku-5-5`). Thinking levels `low, medium, high, xhigh, max`; any model that rejects `--effort` in testing gets `[]`.
- `listConnections`/`listProviders`: `claude auth status` (cached ~30 s) decides `connected`/`ready`.
- `createSession` → new uuid (no process). `deleteSession` → delete that session's transcript file under the config dir's `projects/<cwd-slug>/<uuid>.jsonl` if present.
- `complete()` (titles, memory): `--tools "" --no-session-persistence`, no MCP, its own short system prompt. **Titles (`kind: "title"`) always run on Haiku 5.5** (Skyler's call), whatever model the chat uses; memory summaries use the given model or the default (Sonnet 5.5).

### Clients (web and Android, 1:1, same strings, tests on both)

- Settings → Providers: one card per listed provider: icon, name, status ("Signed in on the server" / "Not signed in on the server") and, when not connected, the server `hint`. Keeps "Use in picker" and, where `supportsFreeFilter`, "Only free models". No key field, no sign-in, no disconnect.
- Remove now-unused strings, API calls (`setProviderKey`, `removeProviderKey`, `startSignIn`, `signInStatus`) and their tests; add a neutral/text icon for Claude (no Anthropic logo).
- Model picker needs no change beyond the new provider.

### Deployment (Pi)

- Install Bun; run the backend from `~/kore/src/koremind` as `skyler` via a systemd unit (adapted `deploy/koremind.service`: `User=skyler`, PATH with `~/.bun/bin`, `~/.local/bin`, `~/.opencode/bin`; drop `PrivateTmp` only if it breaks the CLI).
- Data: stop the container, copy volume `koremind_koremind-data` to a host dir (e.g. `~/kore/koremind-data`), point `KOREMIND_DATA_DIR` there. OpenCode's credentials come along in it for later.
- New `KOREMIND_HOST` (default `0.0.0.0`, as today). On the Pi: `KOREMIND_HOST=127.0.0.1`, `KOREMIND_PORT=4111`, so the tunnel mapping is unchanged and the port is not open on the LAN or Tailscale. This matters because `KOREMIND_TRUST_PROXY=1` trusts `X-Forwarded-For`, which only cloudflared on the same host may set. (Claude's call: a production service behind the tunnel is the exception to "listen on all interfaces".)
- The backend's environment moves from `compose.yaml` into `/etc/koremind/koremind.env` (mode 640). The OIDC client secret comes from the compose `.env` (`KOREMIND_SECRET`) and is copied without being printed. The web container keeps talking to the same public URL. The backend service is removed from the compose file.
- Skyler runs `claude auth login` once as `skyler` on the Pi.
- Docs: update `deployment-linux.md`, `koremind.env.example` (`KOREMIND_PROVIDERS`, `KOREMIND_CLAUDE_*`), `claude-integration.md` (status: built, route C, owner-only), README provider list. Docker deployment docs say Claude needs the native install.

## Left to the builder

- Exact stream-json input format for attachments (verify with a real image and PDF).
- Whether Haiku accepts `--effort`.
- Exact transcript path for `deleteSession`.
- Whether `PrivateTmp`/`NoNewPrivileges` interfere with the CLI.
- Wording of the new strings (match existing tone; both clients).
