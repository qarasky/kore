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
