# Engine spike (Task 0), 2026-11-02

Run with `bun run backend/scripts/spike-engine.ts` (isolated XDG dirs; never touches the owner's own opencode data).

## Verdicts
- **SDK is NOT usable as designed.** `@opencode-ai/sdk@1.19.5` (latest on npm) targets the old server API. The installed CLI is `opencode v2.2.5`, whose server (`opencode serve`) speaks a different API (`/api/*`, flat prompt body `{text, files}`, events as `{type, data}`). The SDK's own launcher also times out because the CLI prints `server listening on URL` instead of `opencode server listening on URL`. **Decision:** Zero's engine is a thin typed HTTP client written against the server's own `/openapi.json`, with no SDK dependency. Owner's SDK choice cannot be honored; same language/runtime, same engine.
- **Startup:** `opencode serve --hostname=127.0.0.1 --port=0` prints `server listening on http://127.0.0.1:PORT` and `server password <pw>`. Auth: HTTP Basic, user `opencode`, that password, on `/api/*`. `/openapi.json` is served. Starts in about 0.4 s.
- **Streaming works.** `POST /api/session` `{model:{id,providerID}}` -> `data.id`; `POST /api/session/{id}/prompt` `{text, files?:[{uri,name}]}` returns the admitted message (about 0.4 s ack the first time); `GET /api/event` (SSE, frames `data: {id,type,data,location}`) carries `session.text.delta` (`data.delta`), `session.text.ended`, `session.execution.succeeded|failed`, `session.step.failed` (`data.error.{type,message}`), `session.renamed`.
- **Free models need no key.** Provider `opencode` is enabled with a public key; model `big-pickle` answered. Free tier is rate limited: error `provider.free-limit` ("Free usage limit reached. Connect a provider or subscribe to OpenCode Go").
- **Tools can be limited, and the prompt shrinks 100x.** Config `{"default_agent":"zero","agents":{"zero":{"mode":"primary","system":"...","permissions":[{"action":"*","resource":"*","effect":"deny"},{"action":"websearch","resource":"*","effect":"allow"}]}},"websearch":{"provider":"random"},"warming":true}` (passed through `OPENCODE_CONFIG_CONTENT`): input tokens per turn fell from 9833 (default `build` agent) to 94.
- **Warm sessions:** config key `warming: true` exists (keeps recently active sessions warm).
- **Models:** `GET /api/model` -> `data[]` with `id`, `providerID`, `name`, `capabilities.input` (e.g. `["text"]`; images expected as `"image"`), `variants[]` (thinking levels; empty for big-pickle), `status`, `enabled`.
- **Keys:** `POST /api/integration/{integrationID}/connect/key` `{key}`; listing `GET /api/integration` shows `connections`.
- **Direct search endpoint:** `POST /api/websearch` `{query}` -> `data.results[]`.

## Not verified (needs the free limit to reset or a key)
- That the model actually calls the web search tool and its event names (`session.tool.*` expected), and permission action name `websearch`.
- Image attachments end to end, thinking `variant` on a model that has variants, time to first token.
- Backend overhead measurement (`backend/scripts/latency.ts`).

## Backend overhead (Task 9, fake engine with 20 ms scripted delay)
`bun run backend/scripts/latency.ts`: first stream frame 7 ms, first delta 30 ms against a 20 ms engine delay, so the backend adds about 10 ms. Real engine through the full backend reaches OpenCode and returns its free-limit error mapped to `no_provider` (happy path still needs the free limit to reset or a key).


## Later findings (2026-11-02 and 2026-11-03), all against `opencode` 2.2.5

- **Disconnecting a provider:** there is no `DELETE /api/integration/{id}`. Remove the saved credential instead: `GET /api/integration/{id}` lists `connections` (`type: "credential"` with an `id`, or `type: "env"`), then `DELETE /api/credential/{credentialID}`. Env connections can't be removed through the API.
- **Connecting a key right after start** can answer 404 ("Integration not found") for a few seconds while the provider catalog loads; retry.
- **OAuth sign-in:** `POST /api/integration/openai/connect/oauth` `{methodID:"chatgpt-token-sharing"}` returns `{attemptID,url,instructions,mode:"auto"}`; the engine itself listens on a loopback port for the callback, so the browser must be on the same machine. Poll `GET .../connect/oauth/{attemptID}`. The first call on a fresh engine answers 500; retry.
- **Models:** `cost` is an array of price tiers; a model is free when every tier has `input` and `output` of 0. After an OpenRouter key is connected the catalog grows from 8 to ~350 models.
- **The `skill` tool** is always registered and described as "Load a specialized skill…"; none of `permissions`, per-agent `tools`, or global rules hides it. With every skill denied it is inert. The system prompt says what tools exist.
- **Session titles:** OpenCode makes a second model call to name each session. Creating the session with a `title` of our own suppresses it. Zero names chats itself on the chosen model.
- **Custom tools:** a remote MCP server in config (`mcp.servers.<name>`, `type: "remote"`, `oauth: false`, `codemode: false`, `headers`, `timeout.execution`) exposes its tools directly as `<server>_<tool>`. Permission action `zero_*` allows them. For calls made on behalf of a session OpenCode sends `params._meta["ai.opencode/sessionID"]`, which is how Zero maps a call back to a chat. Zero hosts the server itself at `/mcp`.
- **Mocking a provider** for tests: `providers.<id>.settings.baseURL` in `OPENCODE_CONFIG_CONTENT` redirects a built-in provider (e.g. `openrouter`) to a local server. `backend/test/engine.test.ts` uses this to test connect, disconnect, titles and the notes tools against the real engine with no network.
- **Models listing and config schema:** the config schema is at <https://opencode.ai/config.json>; the server's own API description is `GET /openapi.json` (needs the Basic auth header).
