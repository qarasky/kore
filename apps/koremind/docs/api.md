# KoreMind API contract

Source of truth: `shared/src/api.ts` (zod). All bodies are JSON unless noted. Authenticated routes need `Authorization: Bearer <token>`. Errors are `{ "error": { "code": string, "message": string, "retryAfterSec"?: number } }` with the matching HTTP status.

## Routes

| Route | Auth | Request | Response |
| --- | --- | --- | --- |
| `GET /health` | no | | `{name:"koremind",version,setupRequired}` |
| `POST /auth/register` | only while no users exist, afterwards owner token | `{email,password(min 8)}` | `{token,user}` |
| `POST /auth/login` | no | `{email,password}` | `{token,user}`; 401 `bad_credentials`; 429 `rate_limited` with `retryAfterSec` |
| `POST /auth/logout` | yes | | `{ok:true}` |
| `POST /auth/pair` | yes | | `PairStart` `{code,expiresAt,urls[],link}`. See Pairing. |
| `POST /auth/pair/redeem` | no | `{code}` | `{token,user}`; 401 `bad_code`; 429 `rate_limited` |
| `GET /me` | yes | | `{id,email,isOwner}` |
| `GET /models` | yes | | `ProviderInfo[]` for this user. See Models and providers. |
| `GET /favorites`, `PUT /favorites` | yes | `string[]` of `"providerId/modelId"` | `string[]` (entries the user can't use are dropped) |
| `GET /providers` | yes | | `ProviderConnection[]` `{id,name,connected,methods:("key"\|"signin")[],supportsFreeFilter,recommended}` for Groq, OpenRouter, OpenCode and Codex (`openai`), in that order |
| `POST /providers/:id/signin` | owner | | `{attemptId,url,instructions}`: open `url` in a browser **on the server's computer** (the engine listens for the callback on its own localhost) |
| `GET /providers/:id/signin/:attemptId` | owner | | `{status:"pending"\|"complete"\|"failed"}` |
| `PUT /providers/:id/key` | owner | `{key}` | `{ok:true}` (never echoes the key) |
| `DELETE /providers/:id/key` | owner | | `{ok:true}`; 4xx with a reason if the connection comes from a server environment variable |
| `GET /chats` | yes | | `{id,title,updatedAt}[]` newest first |
| `POST /chats` | yes | | `ChatSummary` |
| `GET /chats/:id` | yes | | `{chat,messages:ChatMessage[]}` |
| `PATCH /chats/:id` | yes | `{title}` | `{ok:true}` |
| `DELETE /chats/:id` | yes | | `{ok:true}` (its notes go with it) |
| `POST /chats/:id/messages` | yes | `{text,attachmentIds[],model:{providerId,modelId},thinking?}` | `text/event-stream`. See StreamEvent. 400 `model_not_allowed` before any stream when the model isn't currently allowed. |
| `POST /chats/:id/abort` | yes | | `{ok:true}` |
| `POST /chats/:id/approvals/:approvalId` | yes | `{allow:boolean}` | `{ok:true}`; 404 if unknown, already closed, or not this user's |
| `POST /uploads` | yes | multipart field `file` | `{id,name,mime,size}`; 413 `attachment_too_large` |
| `GET /uploads/:id` | yes (`?token=` also accepted) | | file bytes |
| `GET /memory` | yes | | `{id,text,updatedAt}[]` |
| `PUT /memory/:id`, `DELETE /memory/:id` | yes | `{text}` / none | `{ok:true}` |
| `GET /settings`, `PUT /settings` | yes | `Settings` | `Settings` |
| `POST /mcp` | **local engine only** | JSON-RPC (MCP) | The notes tools for OpenCode. Loopback peers only, and `Authorization: Bearer <per-run secret>`; never used by a client. Put a deny rule on it in any reverse proxy as well. |

`Settings` = `{memoryEnabled, displayName, tone, about, disabledProviders: string[], freeOnlyProviders: string[]}`. The last two default to `[]`, so older clients that omit them keep working.

## Models and providers
- `GET /models` returns **every offered provider** (Groq, OpenRouter, OpenCode, Codex = `openai`, in that order: the recommended providers first): `{id,name,connected,recommended,status,models}`. Groq's safety classifiers (Prompt Guard, Safety GPT OSS) are not listed because they cannot chat.
  - `status` is `ready`, `needs_connection` (no key / not signed in; OpenCode counts as ready because its free tier needs no key) or `disabled` (the user turned it off in Settings).
  - `models` is empty unless `ready`, and already honors the user's "only free models" choice. A model is `{id,name,vision,thinkingLevels[],isDefault,free}`; `free` means every price tier is zero.
- Picker behavior (both clients): all providers appear in the rail; non-`ready` ones are dimmed and selecting one explains why ("Connect X in Settings." / "X is turned off in Settings.") with an Open Settings action. A saved choice that is no longer allowed falls back to the default of the first ready provider.

## Pairing (QR sign-in)
- `POST /auth/pair` (signed in) returns `{code, expiresAt, urls, link}`. The code is 128-bit, single-use and valid for 2 minutes; one live code per user. `urls` are the backend's addresses, best first (local network, Tailscale, `KOREMIND_PUBLIC_URL`). `link` is `koremind://pair?c=<code>&u=<url>&u=<url>` (percent-encoded) and is what the QR contains.
- `POST /auth/pair/redeem {code}` (no auth) trades the code for a normal session of the same account. Guessing is rate limited per address (10 attempts per 15 minutes).
- Web shows the QR (Settings → Account → Connect your phone). Android scans it, or opens the `koremind://pair` link: it tries each url's `/health` in order, redeems against the first that answers, and saves the url and token.

## StreamEvent (SSE `data:` lines)
| Event | When |
| --- | --- |
| `{type:"status",state:"thinking"\|"searching"}` | immediately, and when web search starts |
| `{type:"delta",text}` | answer text as it arrives |
| `{type:"source",title,url}` | a web search source |
| `{type:"activity",kind:"saved"\|"read"\|"edited"\|"denied",title,chat?}` | the assistant used (or was refused) the notes tools; `chat` is set when another chat was involved |
| `{type:"approval",id,action:"read"\|"edit",chat}` | the assistant wants another chat's notes; the stream stays open until answered or 60 s pass |
| `{type:"approval_closed",id,outcome:"allowed"\|"denied"\|"expired"}` | the card is resolved |
| `{type:"done",messageId}` | the answer is complete |
| `{type:"title",title}` | first turn of a chat only, best effort, after `done` |
| `{type:"error",code,message}` | `code` is `no_provider`, `attachment_too_large`, `engine`, `aborted` or `model_not_allowed` |

A stream ends after `error`, or after `done` (and on the first turn of a chat up to about 8 s later, after `title`). Clients treat the turn as finished at `done` and keep reading only for `title`. Assistant messages carry `activity: Activity[]` (same shape as the event, without `type`) so history shows what was done. Keep-alive `: ping` comment lines arrive every 15 s.

## Notes and approvals
- The assistant has three tools: `save_note`, `read_notes`, `edit_note`. A note belongs to one chat of one user; by default a tool only touches the current chat.
- Touching another chat's notes (the `chat` argument names it by title) needs the user's approval: an `approval` event, answered with `POST /chats/:id/approvals/:approvalId`. Allowing covers that chat for the rest of the turn (edit covers read). Nothing about the other chat, not even whether a note exists, is revealed before the user agrees. Denied or expired requests return an error to the model and show as a `denied` activity.
- Limits: title 120 characters, note 20,000 characters, 50 notes per chat.

## Examples
```
POST /auth/login {"email":"me@home.lan","password":"correct horse"}
-> {"token":"…","user":{"id":"u1","email":"me@home.lan","isOwner":true}}

POST /chats/c1/messages {"text":"note: buy milk","attachmentIds":[],"model":{"providerId":"opencode","modelId":"big-pickle"}}
-> data: {"type":"status","state":"thinking"}
   data: {"type":"activity","kind":"saved","title":"buy milk"}
   data: {"type":"delta","text":"Noted."}
   data: {"type":"done","messageId":"m2"}
   data: {"type":"title","title":"Shopping list"}
```
