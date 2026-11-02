# Zero API contract

Source of truth: `shared/src/api.ts` (zod). All bodies are JSON unless noted. Authenticated routes need `Authorization: Bearer <token>`. Errors are `{ "error": { "code": string, "message": string, "retryAfterSec"?: number } }` with the matching HTTP status.

| Route | Auth | Request | Response |
| --- | --- | --- | --- |
| `GET /health` | no | | `Health` `{name:"zero",version,setupRequired}` |
| `POST /auth/register` | only while no users exist, afterwards owner token | `AuthRequest` `{email,password(min 8)}` | `AuthResponse` `{token,user}` |
| `POST /auth/login` | no | `AuthRequest` | `AuthResponse`; 401 `bad_credentials`; 429 `rate_limited` with `retryAfterSec` |
| `POST /auth/logout` | yes | | `{ok:true}` |
| `GET /me` | yes | | `User` `{id,email,isOwner}` |
| `GET /models` | yes | | `ProviderInfo[]` `{id,name,connected,models:[{id,name,vision,thinkingLevels[],isDefault}]}` |
| `GET /favorites`, `PUT /favorites` | yes | `string[]` of `"providerId/modelId"` | `string[]` |
| `GET /providers` | yes | | `[{id,name,connected,methods:("key"\|"signin")[]}]` for OpenCode, Codex (`openai`) and OpenRouter |
| `POST /providers/:id/signin` | owner | | `{attemptId,url,instructions}`; open `url` in a browser on the server's computer (the engine listens for the callback on its localhost) |
| `GET /providers/:id/signin/:attemptId` | owner | | `{status:"pending"\|"complete"\|"failed"}` |
| `PUT /providers/:id/key` | yes | `{key}` | `{ok:true}` (never echoes the key) |
| `DELETE /providers/:id/key` | yes | | `{ok:true}` |
| `GET /chats` | yes | | `ChatSummary[]` `{id,title,updatedAt}` newest first |
| `POST /chats` | yes | | `ChatSummary` |
| `GET /chats/:id` | yes | | `{chat:ChatSummary,messages:ChatMessage[]}` |
| `PATCH /chats/:id` | yes | `{title}` | `{ok:true}` |
| `DELETE /chats/:id` | yes | | `{ok:true}` |
| `POST /chats/:id/messages` | yes | `SendMessageRequest` `{text,attachmentIds[],model:{providerId,modelId},thinking?}` | `text/event-stream`: each frame `data: <StreamEvent JSON>` |
| `POST /chats/:id/abort` | yes | | `{ok:true}` |
| `POST /uploads` | yes | multipart field `file` | `Attachment` `{id,name,mime,size}`; 413 `attachment_too_large` |
| `GET /uploads/:id` | yes (query `?token=` also accepted) | | file bytes |
| `GET /memory` | yes | | `MemoryEntry[]` |
| `PUT /memory/:id` | yes | `{text}` | `{ok:true}` |
| `DELETE /memory/:id` | yes | | `{ok:true}` |
| `GET /settings`, `PUT /settings` | yes | `Settings` `{memoryEnabled,displayName,tone,about}` | `Settings` |

## StreamEvent (SSE `data:` lines)
`{"type":"status","state":"thinking"|"searching"}`, `{"type":"delta","text":"..."}`, `{"type":"source","title":"...","url":"..."}`, `{"type":"done","messageId":"..."}`, `{"type":"title","title":"..."}` (first turn of a chat only, best effort, sent after `done`), `{"type":"error","code":"no_provider"|"attachment_too_large"|"engine"|"aborted","message":"..."}`. A stream ends after `error`, or after `done` (and, on the first turn of a chat, up to ~8 s later after the `title` event). Clients should treat the turn as finished at `done` and keep reading only for `title`.

## Examples
```
POST /auth/login {"email":"me@home.lan","password":"correct horse"}
-> {"token":"…","user":{"id":"u1","email":"me@home.lan","isOwner":true}}

POST /chats/c1/messages {"text":"hi","attachmentIds":[],"model":{"providerId":"opencode","modelId":"big-pickle"}}
-> data: {"type":"status","state":"thinking"}
   data: {"type":"delta","text":"Hel"}
   data: {"type":"delta","text":"lo"}
   data: {"type":"done","messageId":"m2"}
```
