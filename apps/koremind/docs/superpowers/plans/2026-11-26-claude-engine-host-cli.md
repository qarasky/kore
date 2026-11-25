# Claude through the host CLI: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Providers are chosen in the server's `.env`, the apps no longer connect providers, and Claude answers through the Pi's own `claude -p`, with the backend running natively on the Pi.

**Architecture:** A new `ClaudeEngine` (one `claude -p` process per message, resumed by session uuid) and the existing OpenCode engine sit behind an engine router that dispatches by provider id. `KOREMIND_PROVIDERS` decides which providers exist; OpenCode's process only starts when one of its providers is listed. Clients show status only.

**Tech Stack:** Bun + TypeScript backend (`bun:test`), Next.js web (`web/`), Kotlin/Compose Android (`android/`), Claude Code CLI 2.1.33x, systemd on Debian 12 aarch64.

**Spec:** `docs/superpowers/specs/2026-11-26-claude-engine-host-cli-design.md`. Read it first; it holds the spike findings.

## Global Constraints

- Work on `main`, commit per task; never branches or worktrees (Skyler's rule).
- AGENTS.md: Kore ID stays the only human sign-in; don't touch auth routes. Web and Android change 1:1, same wording, both string files, tests on both.
- The provider id is `claude`, its display name is **"Claude"**, never "Claude Code". No Anthropic logo: text/initial icon fallback.
- KoreMind never reads, copies or stores the Claude token, and has no Claude login UI.
- Claude is owner-only, enforced on the server.
- Claude runs with exactly: `-p --output-format stream-json --verbose --include-partial-messages --input-format stream-json --setting-sources "" --strict-mcp-config --mcp-config <json> --tools WebSearch --allowedTools "WebSearch mcp__koremind__*" --permission-prompts none --system-prompt <text> --model <id> [--effort <level>] (--session-id|--resume) <uuid>`; `complete()` uses `--tools "" --no-session-persistence` and no `--mcp-config`.
- Never `--bare` (it refuses subscription logins).
- Model catalogue: `claude-fable-5-2` "Fable 5.2", `claude-opus-5-5` "Opus 5.5", `claude-sonnet-5-5` "Sonnet 5.5" (default), `claude-haiku-5-5` "Haiku 5.5". Thinking levels `["low","medium","high","xhigh","max"]`. All `vision: true`, `free: false`.
- Chat titles always run on `claude-haiku-5-5`.
- New env: `KOREMIND_PROVIDERS` (default `claude`; known `claude`, `opencode`, `opencode-go`), `KOREMIND_HOST` (default `0.0.0.0`), `KOREMIND_CLAUDE_BIN` (default `claude`), `KOREMIND_CLAUDE_CONFIG_DIR` (optional → `CLAUDE_CONFIG_DIR`).
- Groq, OpenRouter, Codex (`openai`) are removed everywhere (engine, fake engine, icons, strings, tests).

## Review Focus

1. **Claude not signed in on the server** (`claude auth status` says logged out, or a run exits with an auth error): provider shows "Not signed in on the server" + hint, sending gives a clear `no_provider`-style error, never a hang. Test in Task 6.
2. **Usage limit hit** (`rate_limit_event` with a non-`allowed` status, or `result` with `is_error`): the reply ends with an error event marked `noProvider`, the chat stays usable. Test in Task 5.
3. **Stop pressed mid-reply**: the `claude` process is killed (no orphan), no further events. Test in Task 6.
4. **A non-owner account**: sees Claude `disabled` with no models and gets `model_not_allowed` on send. Test in Task 1.
5. **`claude` binary missing or crashing at start** (bad `KOREMIND_CLAUDE_BIN`): backend still starts, provider shows not connected, a send gives an error instead of crashing the server. Test in Task 6.

---

### Task 1: Providers are status-only (contract, engine interface, routes, fake engine, owner-only)

**Files:**
- Modify: `shared/src/api.ts` (ProviderConnection; drop SignInStart/SignInStatus), `backend/src/engine/types.ts`, `backend/src/engine/fake.ts`, `backend/src/engine/opencode.ts` (OFFERED, mapConnections, drop key/sign-in methods), `backend/src/models.ts`, `backend/src/services.ts`, `backend/src/http.ts:140-154`
- Test: `backend/test/models.test.ts`, `backend/test/http.test.ts`, `backend/test/engine.test.ts`, `backend/test/chats.test.ts`, `backend/test/memory.test.ts`, `shared/test/api.test.ts`

**Interfaces:**
- Produces:
  - `ProviderConnection = { id: string; name: string; connected: boolean; supportsFreeFilter: boolean; hint: string }` (`hint` "" when connected).
  - `Engine` loses `startSignIn`, `signInStatus`, `setProviderKey`, `removeProviderKey`. Everything else unchanged.
  - `OFFERED = [{ id: "opencode", name: "OpenCode" }, { id: "opencode-go", name: "OpenCode Go" }]`; `mapConnections(integrations)` returns those two with `hint` = `"Run \`opencode auth login\` on the server."` when not connected (OpenCode free tier: `connected` false but `hint` "").
  - `FakeEngine`: public `connected: Set<string>`; providers `claude` (Sonnet default + Haiku, ready only when connected), `opencode` (always ready, free models as today), `opencode-go` (ready when connected). `keys`/`signIns`/`finishSignIn` removed.
  - `createModels(db, engine, getSettings, isOwner: (userId: string) => boolean)`; `OWNER_ONLY = new Set(["claude"])` exported from `models.ts`.

- [ ] **Step 1: Write the failing tests**
  - `models.test.ts` `"Claude is the owner's only: others see it disabled and can't use it"`: owner sees `claude` `status: "ready"` with models; a second user sees `status: "disabled"`, `models: []`, and `allowed(other, "claude", "claude-sonnet-5-5")` is `false`.
  - `models.test.ts`: replace the "Groq and OpenRouter are recommended" test with `"providers come in engine order: claude, opencode, opencode-go"`.
  - `http.test.ts` `"connecting a provider from the app is gone"`: `PUT /providers/claude/key`, `DELETE /providers/claude/key`, `POST /providers/claude/signin` each answer 404 for the owner; `GET /providers` returns objects with exactly the keys `id,name,connected,supportsFreeFilter,hint`.
  - `engine.test.ts`: replace the mapConnections test with one asserting the two OFFERED entries, `hint` for a not-connected `opencode-go`, and that `groq`/`openrouter`/`openai`/`anthropic` integrations are ignored.
  - Rewrite every other test that connected Groq/OpenRouter/Codex through `setProviderKey`/`finishSignIn` to use `engine.connected.add("opencode-go")` or the owner + `claude`.

- [ ] **Step 2: Run to see them fail** — `bun test backend shared` → the new tests FAIL (unknown `hint`, routes still 200, no owner rule).

- [ ] **Step 3: Implement** the interface changes above. `models.providers(userId)`: for ids in `OWNER_ONLY` and `!isOwner(userId)` return `{ ...p, status: "disabled", models: [] }` before the existing rules. `services.ts` passes `isOwner` from the users table (`select is_owner from users where id=?`). Delete the two route blocks in `http.ts` (paths then fall through to the existing 404). Remove the OpenCode OAuth/key code (`oauthMethod`, `credentialIdsFor` and their tests).

- [ ] **Step 4: Run** `bun test backend shared` → PASS; `bunx --bun tsc --noEmit -p web` still fails only where web uses removed API (fixed in Task 7).

- [ ] **Step 5: Commit** `feat(backend): providers are status-only; Claude is owner-only; drop Groq, OpenRouter and Codex`

### Task 2: Config for providers, host and Claude

**Files:**
- Modify: `backend/src/config.ts`, `backend/src/index.ts` (use `config.host`)
- Test: `backend/test/config.test.ts` (create)

**Interfaces:**
- Produces: `Config` gains `host: string`, `providers: ProviderId[]`, `claude: { bin: string; configDir: string }` where `type ProviderId = "claude" | "opencode" | "opencode-go"` and `KNOWN_PROVIDERS: ProviderId[]` are exported from `config.ts`.

- [ ] **Step 1: Write failing tests** in `config.test.ts`:
  - `"providers default to claude"`: `loadConfig({}).providers` → `["claude"]`.
  - `"providers keep their order, trim, lower-case and dedupe"`: `KOREMIND_PROVIDERS=" Claude ,opencode-go,claude"` → `["claude","opencode-go"]`.
  - `"an unknown provider stops start-up"`: `"claude,groq"` throws `/KOREMIND_PROVIDERS: unknown provider "groq" \(claude, opencode, opencode-go\)/`.
  - `"host defaults to all interfaces and can be pinned"`: default `"0.0.0.0"`, `KOREMIND_HOST=127.0.0.1` → `"127.0.0.1"`.
  - `"claude bin and config dir"`: defaults `{ bin: "claude", configDir: "" }`; env values are trimmed and used.
- [ ] **Step 2: Run** `bun test backend/test/config.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `loadConfig`; an empty `KOREMIND_PROVIDERS` after trimming means the default.
- [ ] **Step 4: Run** → PASS, plus `bun test backend`.
- [ ] **Step 5: Commit** `feat(backend): KOREMIND_PROVIDERS, KOREMIND_HOST and Claude CLI settings`

### Task 3: MCP takes the session from a header too

**Files:**
- Modify: `backend/src/mcp.ts` (`handle(raw, headerSession?: string)`), `backend/src/http.ts` (`/mcp` passes `req.headers.get("x-koremind-session") ?? undefined`)
- Test: `backend/test/mcp.test.ts`, `backend/test/http.test.ts`

**Interfaces:**
- Produces: `mcp.handle(raw: unknown, headerSession?: string)`; session = `_meta["ai.opencode/sessionID"]` if a string, else `headerSession`. Exported const `MCP_SESSION_HEADER = "x-koremind-session"`.

- [ ] **Step 1: Failing tests**: `mcp.test.ts` `"a tools/call without _meta uses the header session"` (save_note lands in that chat); `"_meta wins over the header"`; `http.test.ts` `"/mcp passes x-koremind-session through"` (loopback, right secret, header set → note saved).
- [ ] **Step 2: Run** `bun test backend/test/mcp.test.ts backend/test/http.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(mcp): accept the chat session from the x-koremind-session header`

### Task 4: Engine router

**Files:**
- Create: `backend/src/engine/router.ts`
- Test: `backend/test/router.test.ts` (create)

**Interfaces:**
- Consumes: `Engine` (Task 1).
- Produces: `createRouter(routes: { providers: string[]; engine: Engine }[], opts?: { titleModel?: ModelRef }): Engine`.
  - `listProviders`/`listConnections`: each engine's results filtered to its `providers` and concatenated in route order. An engine that throws contributes nothing (logged once).
  - `createSession(model)`: routes by `model.providerId` (no model → first route); remembers `sessionId → engine`.
  - `prompt(a)`: by `a.model.providerId`. A provider with no route yields one `{ type: "error", message: "That provider isn't enabled on this server.", noProvider: true }`.
  - `deleteSession(id)`: the remembered engine, else every engine (errors ignored).
  - `complete(a)`: when `a.kind === "title"` and `opts.titleModel` is set and its provider is routed, use `titleModel`; otherwise by `a.model?.providerId`, falling back to the first route. An unrouted provider throws `Error("provider not enabled: <id>")` (memory.ts already falls back to the chat model on throw).
  - `close()`: closes all.

- [ ] **Step 1: Failing tests** with two `FakeEngine`s: provider lists are filtered and ordered; prompt/createSession/deleteSession go to the right engine; an unknown provider gives the `noProvider` error event; `complete({kind:"title", model: chat})` uses `titleModel` when routed and the chat model when not; `complete` for an unrouted provider throws; one engine throwing in `listProviders` still returns the other's.
- [ ] **Step 2: Run** `bun test backend/test/router.test.ts` → FAIL.
- [ ] **Step 3: Implement** `router.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): route each provider to its engine`

### Task 5: Claude engine, pure parts

**Files:**
- Create: `backend/src/engine/claude.ts` (pure exports only in this task), `backend/test/fixtures/claude-websearch.jsonl`
- Test: `backend/test/claude.test.ts` (create)

**Interfaces:**
- Produces (all exported from `claude.ts`):
  - `CLAUDE_MODELS: ModelInfo[]` (Global Constraints), `CLAUDE_DEFAULT = "claude-sonnet-5-5"`, `CLAUDE_TITLE_MODEL: ModelRef = { providerId: "claude", modelId: "claude-haiku-5-5" }`.
  - `claudeArgs(o: { model: string; effort?: string; sessionId: string; resume: boolean; system: string; mcpConfig?: string; tools: "chat" | "none"; persist: boolean }): string[]` — exactly the Global Constraints flags; `tools: "none"` → `--tools ""` and no `--allowedTools`/`--mcp-config`; `persist: false` → `--no-session-persistence` and no `--session-id/--resume`.
  - `mcpConfigJson(url: string, secret: string, sessionId: string): string` → `{"mcpServers":{"koremind":{"type":"http","url":…,"headers":{"authorization":"Bearer …","x-koremind-session":…}}}}`.
  - `userMessage(text: string, files: EngineFile[]): string` — one stream-json line `{"type":"user","message":{"role":"user","content":[…]}}`: `image/*` → `{type:"image",source:{type:"base64",media_type,data}}`; `application/pdf` → `{type:"document",source:{type:"base64",media_type:"application/pdf",data}}`; `text/*`/JSON → `{type:"text",text:"<file name>\n\n<decoded text>"}`; then the prompt text block last.
  - `linksFrom(content: unknown): { title: string; url: string }[]` — parses the `Links: [ … ]` JSON array out of a WebSearch tool_result string (or array of text blocks); dedupe by url, max 8; `[]` on anything unparseable.
  - `createClaudeMapper(): (line: unknown) => EngineEvent[]` — stateful: `stream_event`/`content_block_delta`/`text_delta` → `delta`; `content_block_start` of `tool_use` named `WebSearch` → `status: searching` (remembers the tool_use id); `user` message `tool_result` for a remembered WebSearch id → `source` events via `linksFrom`; `rate_limit_event` with `status` ≠ `"allowed"` → `error` `noProvider: true` message "Claude's usage limit is reached. Try again later."; `result` `subtype: "success"` and not `is_error` → `done`; any other `result` → `error` with its `result`/`errors` text (`noProvider: true` when it mentions login/auth or a limit); everything else → `[]`.
  - `CLAUDE_SYSTEM = AGENT_SYSTEM + " The apps list the pages you searched under your answer, so do not add your own list of sources or links to them."` (`AGENT_SYSTEM` imported from `opencode.ts`).

- [ ] **Step 1: Write the fixture** `claude-websearch.jsonl`, hand-trimmed from the 2026-11-26 spike shape (no signatures, no cost data): `system/init`, a `content_block_start` tool_use WebSearch id `toolu_1`, its `assistant` tool_use, a `user` tool_result for `toolu_1` with content `"Web search results for query: \"bun\"\n\nLinks: [{\"title\":\"Bun blog\",\"url\":\"https://bun.com/blog\"},{\"title\":\"Bun blog\",\"url\":\"https://bun.com/blog\"},{\"title\":\"npm\",\"url\":\"https://www.npmjs.com/package/bun\"}]\n\n…"`, three `text_delta`s `"The latest "`, `"is **1.4.5**."`, `""`, a `rate_limit_event` `status: "allowed"`, `result` `success`.
- [ ] **Step 2: Failing tests** in `claude.test.ts`:
  - `"the fixture maps to searching, two sources, the text and done"`: events equal `[status searching, source Bun blog, source npm, delta "The latest ", delta "is **1.4.5**.", done]` (empty delta dropped).
  - `"a usage limit ends the reply as noProvider"`; `"an error result is an error event"`; `"a not-logged-in result is noProvider"`.
  - `"chat args are locked down"`: `claudeArgs({…tools:"chat", resume:false})` contains `--setting-sources`,`""`,`--strict-mcp-config`,`--tools`,`WebSearch`,`--permission-prompts`,`none`,`--session-id`, and never `--bare`, `Bash`, `default`; `resume:true` uses `--resume`; `effort` absent → no `--effort`.
  - `"complete args have no tools and no session"`: `--tools`,`""`,`--no-session-persistence`, no `--mcp-config`, no `--session-id`.
  - `"userMessage puts files before the text"` for one PNG, one PDF and one text file.
  - `"linksFrom survives junk"`: `linksFrom("no links")` → `[]`, `linksFrom(42)` → `[]`.
- [ ] **Step 3: Run** `bun test backend/test/claude.test.ts` → FAIL.
- [ ] **Step 4: Implement** the pure exports.
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(engine): Claude CLI argument, message and event mapping`

### Task 6: Claude engine, process side

**Files:**
- Modify: `backend/src/engine/claude.ts` (add `createClaudeEngine`)
- Create: `backend/test/fixtures/fake-claude.ts` (a stand-in CLI)
- Test: `backend/test/claude.test.ts`

**Interfaces:**
- Consumes: Task 5 exports; `MCP_SESSION_HEADER` (Task 3).
- Produces: `createClaudeEngine(o: { bin: string; configDir?: string; dataDir: string; mcpUrl: string; mcpSecret: string; idleMs?: number }): Engine`.
  - Spawns `[o.bin, ...claudeArgs(…)]` with `cwd = <dataDir>/claude-work` (created), env = `process.env` minus every `CLAUDECODE` / `CLAUDE_CODE_*` key, plus `CLAUDE_CODE_ENTRYPOINT=koremind`, `MCP_TOOL_TIMEOUT=120000`, and `CLAUDE_CONFIG_DIR` when `configDir` is set. Writes `userMessage(...)` + `\n` to stdin, then closes it. Parses stdout line by line through `createClaudeMapper()`, then `separateAfterTools()`.
  - `prompt`: yields `status thinking` first; prefixes the `<context>` block on a session's first prompt (as OpenCode); `--session-id` on a session's first prompt, `--resume` after (tracked in memory, and resume also if the session is unknown but not new, i.e. after a backend restart: a `Set` of sessions created by this process decides "first"). Abort or idle (`idleMs`, default 120 000) → `proc.kill("SIGTERM")`; idle also yields "The assistant stopped responding. Try again.". Exit without a `result` → `error` with the last stderr line (max 300 chars). Spawn failure → `error` "Claude isn't installed on the server." `noProvider: true`.
  - `listProviders`/`listConnections`: `[o.bin, "auth", "status"]` (exit 0 and stdout not matching `/not logged in|logged out/i` → connected), cached 30 s, spawn failure → not connected. Provider `{ id:"claude", name:"Claude", recommended:false, connected, status: connected ? "ready" : "needs_connection", models: connected ? CLAUDE_MODELS : [] }`; connection `hint` when not connected: "Run `claude auth login` on the server, as the user KoreMind runs as."
  - `createSession` → `crypto.randomUUID()`. `deleteSession(id)` → remove `<configDir or ~/.claude>/projects/*/<id>.jsonl` if present (glob over `projects/`; ignore errors).
  - `complete`: `claudeArgs({ tools:"none", persist:false, model: a.model?.modelId ?? CLAUDE_DEFAULT, effort: a.thinking, system: a.system, … })`, collects `delta`s, throws on `error`.

- [ ] **Step 1: Write `fake-claude.ts`**: a Bun script (`#!/usr/bin/env bun`) that writes its argv and stdin to `$FAKE_CLAUDE_LOG` as JSON, then by `$FAKE_CLAUDE_MODE`: `ok` → prints the Task 5 fixture; `hang` → prints `system/init` and sleeps 60 s; `crash` → prints to stderr `boom` and exits 1; `auth` subcommand → prints `Logged in` (or `Not logged in`, exit 1, when `FAKE_CLAUDE_LOGGED_OUT=1`).
- [ ] **Step 2: Failing tests** (engine created with `bin` = path to `fake-claude.ts`, made executable):
  - `"a reply streams and the first prompt opens the session"`: events end with `done`; logged argv has `--session-id <id>`; stdin's text starts with `<context>`.
  - `"the second prompt resumes and sends no context"`.
  - `"stop kills the process"`: mode `hang`, abort after the first event → the iterator ends within 1 s and the child pid is gone (`process.kill(pid, 0)` throws).
  - `"a crash becomes an error with stderr"`: mode `crash` → error message contains `boom`.
  - `"a missing binary is a clear error and not connected"`: `bin: "/nonexistent/claude"` → `prompt` yields the "isn't installed" error; `listProviders()` → `claude` `needs_connection`.
  - `"logged out shows the hint"`: `FAKE_CLAUDE_LOGGED_OUT=1` → `listConnections()[0].hint` contains `claude auth login`.
  - `"complete runs without tools"`: argv contains `--tools` `""` and `--no-session-persistence`.
  - `"the parent's Claude Code env does not leak"`: with `CLAUDECODE=1` set in the test's env, the logged env (have the fake log `process.env.CLAUDECODE`) is undefined.
- [ ] **Step 3: Run** `bun test backend/test/claude.test.ts` → FAIL.
- [ ] **Step 4: Implement** `createClaudeEngine`.
- [ ] **Step 5: Run** → PASS; `bun test backend`.
- [ ] **Step 6: Commit** `feat(engine): Claude engine on the host's claude -p`

### Task 7: Wire it up in index.ts

**Files:**
- Modify: `backend/src/index.ts`
- Test: `backend/test/http.test.ts` only if helpers change; otherwise a manual check.

**Interfaces:**
- Consumes: `Config.providers/host/claude` (Task 2), `createRouter` (Task 4), `createClaudeEngine`, `CLAUDE_TITLE_MODEL` (Tasks 5-6).

- [ ] **Step 1: Implement**: with `KOREMIND_FAKE_ENGINE` keep the fake. Otherwise build routes in `config.providers` order: `claude` → `createClaudeEngine({ bin: config.claude.bin, configDir: config.claude.configDir || undefined, dataDir: config.dataDir, mcpUrl: \`http://127.0.0.1:${config.port}/mcp\`, mcpSecret })`; the OpenCode engine is created only if `opencode` or `opencode-go` is listed and routes the listed ones. `createRouter(routes, { titleModel: CLAUDE_TITLE_MODEL })`. `Bun.serve({ hostname: config.host, … })`. Log the enabled providers on start.
- [ ] **Step 2: Verify locally**: `KOREMIND_PROVIDERS=claude KOREMIND_HOST=127.0.0.1 KOREMIND_PORT=8799 KOREMIND_DATA_DIR=<scratch> bun backend/src/index.ts` starts, `ss -ltn` shows `127.0.0.1:8799` only, no `opencode` process is running (`pgrep -f "opencode serve"` empty).
- [ ] **Step 3: Run** `bun test backend shared` → PASS.
- [ ] **Step 4: Commit** `feat(backend): start only the engines KOREMIND_PROVIDERS lists`

### Task 8: Web settings show status only

**Files:**
- Modify: `web/components/settings/Providers.tsx`, `web/lib/api.ts` (drop `startSignIn`, `signInStatus`, `setProviderKey`, `removeProviderKey`), `web/lib/strings.ts`, `web/lib/settings-model.ts` (`providerStatus`), `web/lib/model-picker.ts` (`providerIconKey`: `claude` → `null` initial fallback; drop groq/openrouter/openai), `web/components/ProviderIcon.tsx` (drop removed logos)
- Test: `web/__tests__/provider-ui.test.ts`, `web/__tests__/settings-model.test.ts`, `web/__tests__/model-picker.test.ts`

**Interfaces:**
- Consumes: `ProviderConnection` (Task 1).
- Produces (strings, identical on Android in Task 9):
  - `providersHint`: "Where answers come from. Providers are set up on the server; the ones signed in there show their models in the picker."
  - `signedInOnServer`: "Signed in on the server"; `notSignedInOnServer`: "Not signed in on the server"; keep `freeTier` "Free tier, no key".
  - `providerNeedsConnection(name)`: "`${name}` isn't signed in on the server yet."
  - Removed: `recommended`, `addKey`, `hideKey`, `replaceKey`, `disconnect`, `apiKey`, `saveKey`, `signInChatgpt`, `signInWaiting`, `signInFailed`, `signInSameMachine`, `connected`, `notConnected`.

- [ ] **Step 1: Failing tests**: `provider-ui.test.ts` uses `claude`/`opencode`/`opencode-go` fixtures; `providerIconKey("claude")` → `null`; `railNotice` for a not-connected Claude → "Claude isn't signed in on the server yet."; `settings-model.test.ts` `providerStatus` → `"on"` connected, `"free"` for not-connected `opencode`, `"off"` otherwise.
- [ ] **Step 2: Run** `bun test web` → FAIL.
- [ ] **Step 3: Implement**: each card = icon, name, StatusDot with the new labels, the `hint` as muted text when not connected and non-empty, then the existing "Use in picker" / "Only free models" switches. Remove the key form, sign-in polling and error state.
- [ ] **Step 4: Run** `bun test web` and `bunx --bun tsc --noEmit -p web` → PASS.
- [ ] **Step 5: Commit** `feat(web): providers are set on the server; settings show status only`

### Task 9: Android, same change

**Files:**
- Modify: `android/app/src/main/java/dev/qarasky/koremind/data/Models.kt` (ProviderConnection), `data/Api.kt` (drop key calls), `ui/settings/SettingsScreens.kt` (provider card), `ui/settings/SettingsModel.kt` (status), `ui/model/ModelFilter.kt`/`ProviderIcon.kt` (icon keys, notice), `res/values/strings.xml`
- Test: `ContractJsonTest.kt`, `ProviderUiTest.kt`, `SettingsModelTest.kt`, `ModelFilterTest.kt`

**Interfaces:**
- Consumes: Task 1 contract; Task 8 strings (same text; Android names `providers_hint`, `signed_in_on_server`, `not_signed_in_on_server`, `free_tier`, `provider_needs_connection`).
- `ProviderConnection(id: String, name: String, connected: Boolean, supportsFreeFilter: Boolean, hint: String = "")`.

- [ ] **Step 1: Failing tests** mirroring Task 8 (decode `[{"id":"claude","name":"Claude","connected":false,"supportsFreeFilter":false,"hint":"Run `claude auth login` on the server, as the user KoreMind runs as."}]`; icon key `claude` → none; status mapping; notice text).
- [ ] **Step 2: Run** `cd android && ./gradlew :app:testDebugUnitTest` → FAIL.
- [ ] **Step 3: Implement** the card as on web; delete the removed strings and the key UI.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(android): providers are set on the server; settings show status only`

### Task 10: Live check against the real CLI (this machine)

**Files:**
- Create: `backend/scripts/claude-smoke.ts`

- [ ] **Step 1: Write** a script that builds `createClaudeEngine` (real `claude`, scratch data dir, a throwaway `Bun.serve` running `createMcp` with a stub `resolveSession` that logs tool calls) and runs, on `claude-haiku-5-5`: (a) "Reply with the single word pong" → prints events, expects a delta containing `pong` and `done`; (b) a follow-up "What did I just ask?" on the same session → mentions pong; (c) "Search the web: latest Bun version" → at least one `source`; (d) "Save a note titled Test with body hello" → the stub logs `save_note`; (e) a tiny PNG attachment "What colour is this?"; (f) `complete({kind:"title"})`; (g) `effort: "low"` on Haiku: record whether the CLI accepts it; if not, set Haiku's `thinkingLevels` to `[]` in `CLAUDE_MODELS` and add a test.
- [ ] **Step 2: Run** `bun backend/scripts/claude-smoke.ts`; every check prints `OK`. Also confirm no init event lists a tool other than `WebSearch` and `mcp__koremind__*`.
- [ ] **Step 3: Commit** `test(engine): live smoke script for the Claude engine`

### Task 11: Docs and deploy files

**Files:**
- Modify: `deploy/koremind.service`, `deploy/koremind.env.example`, `docs/deployment-linux.md`, `docs/deployment-docker.md`, `docs/claude-integration.md`, `docs/api.md` (removed routes, new ProviderConnection), `README.md`

- [ ] **Step 1: Edit**: unit runs the backend only (web is separate), `User=`/`Group=` placeholders with a comment "the user whose `claude auth login` KoreMind uses", PATH with `~/.bun/bin`, `~/.local/bin`, `~/.opencode/bin`; env example gains `KOREMIND_PROVIDERS=claude`, `KOREMIND_HOST=127.0.0.1` (with the trust-proxy reason), `KOREMIND_CLAUDE_BIN`, `KOREMIND_CLAUDE_CONFIG_DIR`; `claude-integration.md` status → "built 2026-11-26 as route C via `claude -p`", owner-only, link the spec; Docker doc says Claude needs the native install; README provider list = Claude, OpenCode, OpenCode Go.
- [ ] **Step 2: Verify** `grep -rniE "groq|openrouter|codex|chatgpt" README.md docs/*.md deploy/ web/lib web/components android/app/src/main` → only historical mentions in `docs/claude-integration.md`/research, none in code.
- [ ] **Step 3: Commit** `docs: Claude via the host CLI, providers in .env, native Pi deploy`

### Task 12: Deploy on the Pi (with Skyler)

Ask Skyler before Step 3 (it stops the running KoreMind) and before pushing.

- [ ] **Step 1:** Push `main` (after Skyler's OK). On the Pi: install Bun (`curl -fsSL https://bun.sh/install | bash`), `cd ~/kore/src/koremind && git fetch origin main && git reset --hard origin/main && bun install`.
- [ ] **Step 2:** Skyler runs `claude auth login` as `skyler` on the Pi; verify `claude auth status`.
- [ ] **Step 3:** `docker compose stop backend` in `~/kore/koremind`; copy the volume: `docker run --rm -v koremind_koremind-data:/from -v ~/kore/koremind-data:/to alpine cp -a /from/. /to/` then `chown -R skyler:skyler ~/kore/koremind-data`.
- [ ] **Step 4:** Write `/etc/koremind/koremind.env` (640, root:skyler) from the compose `environment:` block plus `KOREMIND_DATA_DIR=/home/skyler/kore/koremind-data`, `KOREMIND_PORT=4111`, `KOREMIND_HOST=127.0.0.1`, `KOREMIND_PROVIDERS=claude`, `KOREMIND_CLAUDE_BIN=/home/skyler/.local/bin/claude`; copy `KOREMIND_SECRET` from the compose `.env` into `KOREMIND_OIDC_CLIENT_SECRET` without printing it.
- [ ] **Step 5:** Install the unit (`User=skyler`), `systemctl enable --now koremind`; remove the `backend` service from `compose.yaml`, `docker compose up -d --remove-orphans`.
- [ ] **Step 6: Verify**: `curl -s https://mind-api.qarasky.dev/health` returns `{"name":"koremind",…}`; `ss -ltn | grep 4111` shows `127.0.0.1` only; Skyler signs in on `https://mind.qarasky.dev`, sends a message on Sonnet, sees a reply, a title from Haiku, and a web search with sources. Keep the Docker volume until Skyler says it can go.
- [ ] **Step 7:** Update the RPi deployment memory note (native backend, data dir, unit name).
