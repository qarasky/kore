# KoreMind: design

> **Amendments since this spec was written (2026-11-03).** This is the original product design; the owner later approved the changes below. Where they conflict with the text, they win. For how things work today see `README.md`, `DESIGN.md` and `docs/api.md`.
> - **Tools:** web search is no longer the only tool. The assistant can save, read and edit **notes** (per chat, per user). Reaching into another chat's notes needs the owner's approval through an Allow/Deny card. Memory is still not a tool.
> - **Providers:** besides OpenCode there are **Codex** (OpenAI via ChatGPT sign-in or an API key) and **OpenRouter** (API key). Each can be turned off per user, and OpenCode and OpenRouter can be limited to free models. Unusable providers are dimmed in the model picker with an explanation.
> - **Settings:** now five sections (Models, Providers, Personalization, Memory, Account) with autosave. Memory moved inside Settings.
> - **Sign-in:** a signed-in web session can show a QR code that signs the Android app in as the same account.
> - **Authentication:** **Kore ID only.** Email + password login, first-account registration and password setup/reset were removed on web, Android and the backend. Existing accounts link to Kore ID by verified email; QR pairing is Kore ID-backed.
> - **Chat titles:** after the first answer the chosen model names the chat.
> - **Engine:** the OpenCode SDK could not be used (see `docs/superpowers/notes/engine-spike.md`); KoreMind talks to `opencode serve` over HTTP.

A personal AI assistant with its own apps: a native Android app and a web UI, both talking to a backend that runs on the owner's home server. It should feel like the ChatGPT app: you open it and ask. It is the opposite of OpenClaw, which the owner hated.

Calls marked **(my call)** were made by the designer, not the owner. Everything else was decided by the owner.

## Why

The owner tried OpenClaw and disliked four things:

1. It is slow.
2. It lives inside chat channels (Telegram, Discord). The owner wants a standalone app.
3. Its configuration is confusing.
4. It ships too many tools, and some are wrong for them.

KoreMind is built to fix those four, in that spirit.

## Who and how it is used

- One owner, on a home server, using it for **everyday questions and light chat**. Nothing heavy.
- Used from an Android phone and a browser. Login is **email and password**.
- Multiple accounts are possible but not the point **(my call)**: the first account created on first run is the owner. Chats and memory belong to an account. Whether the owner can add more accounts is left to the builder, as long as it needs no extra configuration.

## Goals

- **Fast.** This is the owner's main anti-goal: *"the big latency to answer."* See Latency.
- **Standalone apps**, with no channel integrations.
- **Almost no configuration.** Sensible defaults. The Settings screen is short.
- **Few tools.** Web search only in v1, with a design that allows more later.
- **Remembers the owner** across chats, in a visible and editable way.
- **Looks like the owner's other work**: dark, compact, restrained (Kore's palette).

## Non-goals and anti-goals

Not in v1, and not to be built:

- Telegram, Discord, or any messaging-channel integration.
- Any tool other than web search and notes (reading files, writing files and a terminal are the later wishlist, not now).
- Voice input or output.
- A light theme.
- iOS.
- Remote-access setup (Tailscale, Cloudflare tunnels, port forwarding). The owner explicitly does not want KoreMind to care about this. See Networking.
- Plugin systems, config files, or environment-variable tuning that an ordinary user must touch.
- Multiple providers beyond Opencode (the architecture must allow them; none are built).

Failure even if every feature works: **noticeable latency before the answer starts**, or a settings and setup experience that needs documentation.

## Architecture

Three parts. The stack for each was chosen by the owner, except where marked.

| Part | Decision |
| --- | --- |
| Backend | **Bun + TypeScript.** Wraps **OpenCode through its SDK**. OpenCode is the engine and provider layer, running as a process on the same machine (the SDK talks to an OpenCode server). |
| Web UI | **Next.js**, a separate process on the same machine as the backend. It talks to the backend by URL. |
| Android | **Native.** Kotlin with Jetpack Compose **(my call)**. |

Notes:

- The backend is a thin layer: authentication, accounts, chat storage, streaming passed through from OpenCode, provider keys, memory. It must add as little as possible between the client and the model.
- The owner first said Rust for the backend and then moved to Bun + TypeScript so the OpenCode SDK (which is TypeScript) can be used as designed and types can be shared with the web UI. Do not revisit this choice.
- **Assumption to verify early:** that the OpenCode SDK can (a) have all of its built-in tools turned off except web search, (b) keep sessions warm, (c) stream with low overhead, (d) list models and expose a thinking or reasoning level, (e) accept image and file attachments. If any of these fail in a way that breaks the latency goal, say so to the owner before working around it. The fallback is calling Opencode's model API directly from the backend and owning a small agent loop. That is a change of direction and needs the owner's approval.
- **"Opencode" as a provider** means OpenCode's own hosted model service (the Zen/Go gateway), reached with an API key pasted in Settings **(my call)**. On a fresh install the app shows one short "connect a provider" step before the first chat. After that it opens straight to a blank chat. If other providers that OpenCode supports are added later, they appear as extra icons in the picker's left rail.
- **Web search** uses OpenCode's built-in search tool **(my call)**. It must work with no extra key or setting. If it turns out to need its own key or account, tell the owner before adding a settings field, because that would go against the "almost no configuration" goal.
- **Memory writes** happen in a **background step after each reply** **(my call)**: a separate, small, fast model call reads the turn and updates the Markdown memory. This keeps memory off the answer path so it adds no latency to the reply. Memory is read into the system prompt at the start of a chat. This is not a user-facing tool.
- **Transport** is plain HTTP on the local network by default **(my call)**. The Android app must allow cleartext traffic to the owner-configured backend URL. If the owner puts the backend behind HTTPS themselves (a domain or a tunnel), the same URL field works. TLS is not set up by KoreMind. Because passwords cross the network, login must never log or echo them, and the rate limiting above applies.
- Chat history and accounts live in the backend's database. SQLite is a sensible default **(my call)**. The clients also cache recent chats locally.
- Provider API keys are entered in the app, stored only on the server, and never sent back to a client in full **(my call)**.

## Networking

The owner's instruction: *"You should not care for it."*

- The backend binds to **all interfaces**.
- On startup it shows its address: the **local IP** by default, a **Tailscale address** if one exists, or a **domain** if the owner has set one up. Nothing more.
- Both clients have a **backend URL** field. The Android app and the web UI are pointed at the backend the same way.
- KoreMind does not configure tunnels or VPNs. The owner handles that themselves.
- Because the server may be reachable beyond the home network, login must have basic brute-force protection (rate limiting) **(my call)**.

## Latency (the main requirement)

Design everything against this.

- The user's message appears instantly on send. A "thinking" or "searching the web" indicator appears immediately. Tokens stream as soon as the first arrive.
- The OpenCode engine is always running with sessions ready. No request waits on a cold start.
- The backend adds as little processing as possible between client and model.
- Both apps open fast: recent chats and the chat list come from a local cache, so something is on screen before the network responds.
- The default model should be a fast one, not a slow deep-thinking one. Thinking level is chosen by the owner per chat.
- Suggested measure **(my call)**: backend overhead on top of the model's own time to first token should be small enough that the owner cannot perceive it (roughly tens of milliseconds). The builder should measure it.

## Features (v1)

### Chat
- Opens to a **new, blank chat with the input ready** (the ChatGPT-style home). History is in a **side drawer** (a sidebar on web).
- Streaming answers, rendered as Markdown.
- The user can attach **photos and files**. The assumption is that the model can read photos if it supports images and files if they are text, PDFs or similar. Models that cannot read photos should be marked as such in the picker.
- Chat history: list, open, delete. Rename is left to the builder.
- Web search is the only tool. The UI shows when it is searching and, after, shows what sources were used. The exact presentation is left to the builder.

### Model picker
Based on the owner's screenshot of the T3 Code model picker:
- A chip in the input bar shows the current **model and its thinking level**, for example "Sonnet 5.5 High".
- Tapping it opens a popover (web) or bottom sheet (Android).
- **Left rail**: a **favorites star** at the top, a divider, then **one icon per provider** with a blue marker on the active one. Only Opencode exists at first.
- **Right side**: a search box (blue underline), then model rows. The current model has a check. On the web, the first few rows show keyboard shortcuts (the owner's screenshot shows ⌘1, ⌘2, ⌘3). Android omits the shortcuts **(my call)**.
- **Favorites and the thinking level are in v1.** The thinking level is chosen near the model chip. Its exact control is left to the builder.
- The set of models and their capabilities comes from the provider, not a hard-coded list.

### Memory
Inspired by OpenClaw and ChatGPT:
- The assistant decides what is worth remembering. There is no "save this" step.
- Memory is stored as **plain readable text** (Markdown files, per account) **(my call on the exact format)**, loaded into context at the start of a chat.
- The app has a **Memory screen** where the owner can see what it remembers, edit an entry, or delete it. Turning memory off is available.
- Memory is on by default and needs no configuration.
- Reading and writing memory is an internal capability of the assistant, not a user-facing tool **(my call)**. See Architecture for how writes happen.

### Settings
Short, one tap deep. Nothing else in v1:
- **Backend URL.**
- **Favorite models** (the same favorites as in the picker).
- **Connected providers.** Add or remove a provider by pasting its key (or signing in if the provider supports it). Opencode to start.
- **Personalization.** Name, how the assistant should talk to the owner, anything it should always know, plus the Memory screen.
- **Account** (email, password, sign out).

## Visual design

Dark only, with Kore's tokens taken as they are. (The `kore` repo's `web/app/globals.css` and the `ai-docs` repo are the sources.)

| Token | Value | Use |
| --- | --- | --- |
| bg | `#16181d` | Page |
| surface | `#1d2026` | Panels |
| raised | `#23262d` | Menus and raised elements |
| border | `#2c3038` | Hairlines |
| border-strong | `#3a3f49` | Stronger dividers |
| text | `#e6e8ee` | Primary text |
| muted | `#8a8f9a` | Secondary text |
| accent | `#5b8def` | Primary actions, focus, links |
| accent-hover | `#7aa3f2` | Hover |
| danger | `#f2777a` | Errors and destructive actions |
| warning | `#e5a54b` | Warnings |

- 6px corners, a 15px base size, 40px controls, 32px compact controls, Inter then system fonts, no external loads (fonts and icons bundled), lucide icons on web, focus rings in the accent color.
- Hairline borders over boxes. Short motion that respects reduced-motion settings.
- Chat feels calm and readable, closer to the owner's website: comfortable text in messages. The surrounding chrome is dense and compact like Kore.
- Avoid decorative labels and tiny text. Avoid anything that looks like a generic enterprise tool.
- The Android app uses the same tokens so both clients read as one product.
- The product has a mark in the owner's usual style: one geometric glyph on a rounded dark tile, drawn as SVG, with raster icons generated by a script. The name is **KoreMind** for now (the repo's name) **(my call)**. The mark itself is left to the builder.

Reference: the home screen is "A" from the mockups, a blank chat with a centered "What's on your mind?" and an "Ask anything…" input, with a top bar of menu, title and options.

## Left to the builder

- Database schema and the API between clients and backend.
- How each client authenticates after login (tokens or sessions) and how long a session lasts.
- How the thinking level maps onto what the provider offers.
- Android architecture, local caching and offline behavior.
- How web search results and sources are shown.
- Project layout (single repo with the three parts is expected), tests, and how it is run and deployed on the home server (it should be a one-command start).
- The logo.
- The order of work. The owner expects this to be planned across backend, web and Android.

## Open assumptions

- OpenCode SDK capabilities (see Architecture). To verify first.
- Which Opencode models are available and their image support. Learn from the provider at runtime.
