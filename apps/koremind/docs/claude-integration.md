# Claude in KoreMind (not built yet)

**Status: documented, not implemented.** This records what was researched on 2026-11-03 so the work can be picked up later without redoing it. Nothing in the code uses the Claude Agent SDK today.

Anthropic restricts how Claude can be used inside other products, so the way Claude is added matters as much as the code. Re-read the sources below before building anything; the terms can change. This is our reading of the published text, not legal advice.

## The policy, in short

From the [Claude Code legal page](https://code.claude.com/docs/en/legal-and-compliance) and the [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview):

| Not allowed | Allowed |
|---|---|
| Offering "Claude.ai login" in your own application. | An end user signing in to the **unmodified Claude Code binary** with their own subscription. |
| Routing requests through Free/Pro/Max/Ultra plan credentials on behalf of your users. | A customer configuring **their own API key** for their own authorized users, billed to the key owner and not resold. |
| Collecting, storing or intermediating Claude.ai credentials or session tokens. Sign-in must finish in Anthropic's own flow. | Using the Agent SDK with API-key authentication (Claude Console, Bedrock, Vertex, Foundry). |
| Modifying the Claude Code binary, or removing/disabling its authentication methods. | |
| Calling a product "Claude Code", or mimicking Claude Code's look. Use "Claude" or "Claude Agent". | |

Plan usage limits "assume ordinary, individual usage". Preinstalling or running Claude Code inside a product (for example in a Docker image) additionally requires accepting Anthropic's Commercial Terms.

## How T3 Code does it

T3 Code (`pingdotgg/t3code`, `apps/server/src/provider/ClaudeProvider.ts` and `orchestration-v2/Adapters/ClaudeAdapterV2.ts`) uses `@anthropic-ai/claude-agent-sdk` but never touches credentials:

- Every `query()` gets `pathToClaudeCodeExecutable` pointing at the **user's own installed `claude`**. The SDK's bundled binaries are stripped from its desktop build.
- It reads the account state from the SDK (subscription type, token source, API key source). When nobody is signed in it only says "Run `claude auth login`". The login happens in Anthropic's CLI.
- An optional config folder is passed as `CLAUDE_CONFIG_DIR`; a custom `ANTHROPIC_BASE_URL` is honoured; its traffic is tagged `CLAUDE_CODE_ENTRYPOINT=t3-code`; variables from a parent Claude session are removed.
- Features used: partial-message streaming, `resume`, `canUseTool` (approvals), `mcpServers`, `allowedTools`/`disallowedTools`.

It is a desktop app for one person on their own machine, which is the case Anthropic's text clearly allows. KoreMind is a server with several accounts, so copying the pattern does not carry the same assurance.

## Three ways to add Claude

| | Route | Risk |
|---|---|---|
| A | Anthropic API key through OpenCode: add `anthropic` as a fourth provider, key only. | Low. |
| B | A `ClaudeEngine` on the Agent SDK with an API key. | Low. |
| **C** | **A `ClaudeEngine` on the Agent SDK using the owner's own `claude` subscription login on the server.** | **Real; see below.** |

Only route C is described further here, because it is the one that was asked to be recorded. A and B are the compliant defaults if C is never built.

## Route C: the owner's Claude subscription

### Why it is risky

The server would run requests through one person's plan credentials. With a single owner using their own plan from their own phone it is close to "ordinary individual usage", but it is still a hosted harness, which is the pattern Anthropic's wording targets, and it says it may act "without prior notice". Expect that the owner's Claude account could be limited or banned. Anthropic's own advice for doubtful cases is to contact their sales team.

### Hard rules if it is built

1. **Owner only.** The Claude models are offered to the owner's account and to nobody else. Enforced on the server (`models.allowed` and the send check, answered with `model_not_allowed`), not just hidden in the picker. Other accounts never route through the subscription.
2. **No Claude login UI in KoreMind.** The owner runs `claude auth login` on the server themselves. KoreMind has no button, QR code or OAuth flow for it.
3. **KoreMind never reads, copies or stores a token.** It only starts the SDK with the config folder (`CLAUDE_CONFIG_DIR`) where Claude Code keeps its own login, and asks the SDK for the account status.
4. **Unmodified binary, the owner's own.** `pathToClaudeCodeExecutable` points at a `claude` the owner installed. The SDK's bundled binary is not used, and **the Docker image does not bundle Claude Code** (that would bring in the Commercial Terms for bundling). Docker users mount their install and config folder.
5. **Honest wording.** The provider is "Claude" in the picker, never "Claude Code". The Settings text says plainly that this uses the owner's subscription and that Anthropic's terms apply. An API key (route B) stays the recommended way and is offered first.
6. **Off by default.** An explicit owner setting turns it on, after showing the risk text.

### Design sketch (not built)

KoreMind already has an `Engine` interface (`backend/src/engine/types.ts`) with a fake and an OpenCode implementation. Claude would be a third one, composed with OpenCode so each model is routed by its provider id.

| `Engine` method | In a `ClaudeEngine` |
|---|---|
| `listProviders` / `listConnections` | One provider `anthropic` named "Claude". `ready` only when the SDK reports an authenticated account. Methods: `signin` is **not** offered (rule 2); an API key is route B. |
| `startSignIn` / `signInStatus` / `setProviderKey` / `removeProviderKey` | Not supported for subscription mode (return a clear error). |
| `createSession` / `deleteSession` | Keep our own session id; map it to the SDK's `sessionId` / `resume`. |
| `prompt` | `query()` with `includePartialMessages` → `delta` events; tool use shown as `status`/`source` events; map the final result to `done` or `error`. |
| `complete` | One-shot `query()` with no tools and `persistSession: false` for titles and memory. |

Options to set on every query, so Claude behaves as a chat assistant and not a coding agent:

- Switch the built-in tools off (`tools: []`, or `disallowedTools` for Bash, Edit, Write, Read and the rest), so it cannot touch the server's files.
- `settingSources: []` and `strictMcpConfig`, so the server's own `~/.claude` skills, hooks and MCP servers do not leak into chats.
- Give it KoreMind's notes tools through `mcpServers` pointing at our existing `/mcp` endpoint with the per-run secret. The tools are named `mcp__koremind__*`, so the system prompt and the `koremind_*` permission rule need a Claude variant.
- Approvals for reading another chat's notes through `canUseTool`, feeding the existing approval UI and its 60-second timeout.
- A working directory that is an empty temp folder per session.

### Open questions to check before building

- Does the Agent SDK run correctly under Bun (KoreMind's runtime)? T3 runs it under its own server; this has not been tried here.
- Which environment variables the SDK needs when the backend runs as a service user (`HOME`, `CLAUDE_CONFIG_DIR`), and whether the macOS Keychain is reachable from a service. T3's note: changing `HOME` hides Keychain credentials, so use `CLAUDE_CONFIG_DIR`.
- Whether `tools: []` fully removes the built-in tools in the current SDK version, and what the SDK sends to the model by default (its system prompt) when we set our own.
- Web search: Claude has its own server-side web search; whether it is available on a subscription login through the SDK is untested.
- Android parity: the provider, the risk text and the owner-only rule need the same strings and tests on both clients (`web/lib/strings.ts` ↔ `strings.xml`).
- Logo: Anthropic's names and logos need permission beyond plain text. Use a text label or a neutral icon until that is sorted.

### Reasons to stop and pick A or B instead

If Anthropic's wording gets stricter, if the owner shares the server with anyone, or if the account is flagged, drop C and use an API key. Nothing in A or B depends on C.

## Sources

- <https://code.claude.com/docs/en/legal-and-compliance>
- <https://code.claude.com/docs/en/agent-sdk/overview>
- <https://github.com/pingdotgg/t3code> (`apps/server/src/provider/ClaudeProvider.ts`, `provider/Drivers/ClaudeHome.ts`, `orchestration-v2/Adapters/ClaudeAdapterV2.ts`)
