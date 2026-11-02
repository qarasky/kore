# Zero: design

How Zero looks, moves and talks. This is the contract for the web UI and the Android app; if you change one, change the other. The research behind it is in [`docs/research/design-research.md`](docs/research/design-research.md). The product design (what Zero is) is in `docs/superpowers/specs/2026-11-02-zero-design.md`.

## 1. Principles
1. **Open and ask.** The app opens to a blank chat with the cursor ready. Nothing stands between the owner and the first message.
2. **No wait.** The user's message shows instantly, a "thinking" indicator shows immediately, tokens stream as they arrive. Motion and polish never delay a reply.
3. **Calm chat, dense chrome.** Messages are comfortable to read (15px, 1.6 line height). Everything around them (sidebar, settings, pickers) is compact like Kore.
4. **Show state in words.** Connected, Free tier, Saving…, Saved. Colour supports the word, never replaces it.
5. **Few things, honestly named.** Five settings sections. Presets named by outcome. The assistant says what it can really do.
6. **Dark only.** One theme, Kore's palette.
7. **Nothing silent.** An action that fails says why, in the place it was triggered. A button never "does nothing".

## 2. Tokens
Kore's palette, taken as is. Web: `web/app/globals.css` (`@theme`). Android: `ui/theme/Theme.kt` (`ZeroColors`).

| Token | Value | Use |
| --- | --- | --- |
| bg | `#16181d` | Page |
| surface | `#1d2026` | Panels, cards, composer |
| raised | `#23262d` | Menus, hover, active nav pill, user bubble |
| border | `#2c3038` | Hairlines |
| border-strong | `#3a3f49` | Dividers, off switch, "not connected" dot |
| text | `#e6e8ee` | Primary text |
| muted | `#8a8f9a` | Secondary text, hints |
| accent | `#5b8def` | Primary action, focus ring, active marker, connected dot |
| accent-hover | `#7aa3f2` | Hover on accent |
| danger | `#f2777a` | Errors, destructive |
| warning | `#e5a54b` | "Free tier" dot, quota notices |

Rules: no gradients, no shadows except the model popover; hairline borders over boxes; accent used sparingly (one primary action per card).

## 3. Type and size
- Font: Inter, then system fonts. Nothing loads from the network.
- Base 15px. Scale: 12 (`2xs`, hints, counters), 13 (`meta`), 14 (`sub`, controls and rows), 16 (`heading`, message text and composer), 17 (`title`, section titles), 24 (`display`, home greeting).
- Controls 40px tall, compact controls 32px, list rows 48px. Corners 6px; the composer is the only large shape (20px); the user bubble is rounded-2xl.
- Icons: lucide on web, Material icons on Android, 14-20px, stroke style, never decorative.

## 4. Layout
- **Shell.** Sidebar (256px) on wide screens, a drawer on narrow ones. Top bar: menu, centered (mobile) or left-aligned (desktop) title, optional right action.
- **Chat.** Column max 768px, 16px side padding. User messages right-aligned in a raised bubble; assistant text is plain, unboxed Markdown. Sources are small chips under the answer.
- **Composer.** Floating card, 20px radius, hairline border that strengthens on focus. Attachment chips above the text; below: attach, model chip, spacer, send/stop (40px circle).
- **Home.** A single centered line, "What's on your mind?", and the composer.
- **Settings.** Left section nav (200px) + content column (max 576px) on desktop; a scrolling pill row above the content on phones. One section visible at a time; the active section is remembered in the URL hash (`#providers`).

## 5. Components

### Model picker
Opens above the composer. Left rail (56px): favorites star, divider, one real provider logo per provider (22px, monochrome, current text colour); a 3px accent marker slides to the active entry. Right: search with an accent underline, rows (name, a "Free" tag when every price tier is zero, "No photos" if the model can't read images, ⌘1-⌘3 on web for the first three rows, favorite star, check on the current one), then a "Thinking level" chip row when the model has levels.

**Every offered provider is on the rail** (OpenCode, Codex, OpenRouter). One that can't be used right now is dimmed to 40% but still selectable, and its pane explains why instead of listing models: *"Connect {name} in Settings to use its models."* (no key / not signed in) or *"{name} is turned off in Settings."*, with an **Open Settings** button that goes to Settings → Providers. Favorites and the saved choice only count providers that are ready; if the saved choice stops being allowed, Zero falls back to the default of the first ready provider. OpenCode counts as ready without a key because its free tier needs none.

Logos come from `assets/providers/*.svg` (models.dev) and are bundled, never loaded from the network: inline SVG on web, tinted vector drawables on Android. There is no separate Codex mark, so Codex (provider id `openai`) uses OpenAI's.

### Settings sections
| Section | Content |
| --- | --- |
| Models | Favorites, with the provider under each model. Empty state says to star a model in the picker. |
| Providers | One card per provider: logo tile, name, status (dot + words), one primary action. Codex: **Sign in with ChatGPT** + "Use an API key". OpenRouter and OpenCode: "Use an API key". Connected: "Replace key" and **Disconnect**. The key field is disclosed on demand. Under the actions, two switches: **Use in model picker** (every provider) and **Only free models** (OpenCode and OpenRouter, with the hint "Hide paid models from the picker."). Both are per user, autosaved, and the picker follows immediately. |
| Personalization | Name, four tone presets (Short and direct, Friendly, Formal, Playful), free-text tone, "anything it should always know" (600 characters, counter). |
| Memory | Switch with a count, then editable rows. |
| Account | Email, server address with "Change server", **Connect your phone** (QR), Sign out. |

Settings are **autosaved** 700 ms after the last change and flushed when leaving. The header shows Saving… / Saved / an error. There is no Save button.

### Provider states
`on` = accent dot, "Connected". `free` = warning dot, "Free tier, no key" (OpenCode only). `off` = muted dot, "Not connected". Sign-in is only offered for Codex and must be finished in a browser on the computer that runs Zero; the Android app says so instead of offering it.

### Connect your phone (QR)
Settings → Account → **Show QR code** (web). A white tile with dark modules (scanners read that best), a countdown ("Expires in 1:42"), and **New code** once it expires or on demand. The code lives two minutes and works once. On Android, **Scan QR code** appears on the Connect-to-server and Sign-in screens (and a `zero://pair` link opens the app): it tries each address in the code until one answers, then signs in as the same account. Scanning is Android-only and showing is web-only by nature; everything else is 1:1.

### Notes and approvals
The assistant has three notes tools (save, read, edit). A note belongs to one chat of one user; by default a tool only touches the current chat. When the owner asks it to look at or change **another chat's** notes, an **approval card** appears in the chat: *"Zero wants to read the notes from “{chat}”"* / *"…edit the notes in “{chat}”"* with **Allow** and **Deny**. The card is warning-bordered, collapses the moment it is tapped, and the stream stays open while it waits (60 s, then "The request expired."). Allowing covers that chat for the rest of the turn; edit covers read. Nothing about another chat, not even whether a note exists, is revealed before the user agrees.

What the assistant did is shown as small chips under its message and kept in the history: *Saved note “X”*, *Updated note “X”*, *Read notes*, *Read notes from “Y”*, *Access to “Y” was denied* (denied is danger-coloured).

### Chat titles
A new chat is titled with its first words immediately. After the first answer, the chosen model names it (at most 5 words, same language, no quotes). The title arrives after the reply, fades into the sidebar and header, and never overwrites a title the owner typed.

### Errors
Shown where the action happened, in danger colour, with what to do next. A provider that can't be disconnected (connected via an environment variable on the server) says exactly that. "No provider" (free quota used up) shows a warning card with a link to Settings → Providers.

## 6. Motion
One language, defined in `web/lib/motion.ts` (web) and `ui/theme` helpers (Android).

| Kind | Duration / curve | Used for |
| --- | --- | --- |
| quick | 140 ms, ease-out `[0.2, 0, 0, 1]` | Popovers, status swaps, exits |
| smooth | 220 ms, same curve | Section changes, entrances |
| spring | stiffness 520, damping 42 | Layout moves: nav pill, rail marker, list reflow, switch thumb |
| screen | 320 ms | Sign-in and connect screens, home greeting |

What moves:
- New messages rise 8px and fade in (not the ones already on screen when a chat loads).
- Thinking / Searching status crossfades; sources pop in staggered by 40 ms.
- Send turns into Stop and back with a small scale.
- Attachment chips scale in and out; remaining chips glide.
- Model popover: scale 0.96 → 1 from its bottom-left corner. Rail marker slides between providers.
- Sidebar: rows glide when a chat is added or removed; titles crossfade when renamed; the mobile drawer slides.
- Settings: nav pill slides between sections; content fades 8px; key field and sign-in hints expand; list rows collapse when removed; the switch thumb springs.
- Errors expand and fade in under the field.

Rules: motion explains a change and never delays content. Exits are shorter than entrances. The OS "reduce motion" setting is honored globally (`MotionConfig reducedMotion="user"` on web; animator-duration scale on Android): transforms and layout animation stop, opacity may remain.

## 7. Copy
- Plain, short, no exclamation marks. "Not connected", not "Provider unavailable".
- Say what happens next: "Finish signing in on the tab that opened. This updates by itself."
- Labels are about outcomes, not parameters.
- All UI strings live in `web/lib/strings.ts` and `res/values/strings.xml`.

## 8. Accessibility
- Visible focus ring in accent on every interactive element.
- Targets at least 32px (40px for primary controls).
- Status changes (saving, thinking, errors) use `role="status"` / `role="alert"`.
- Switches use `role="switch"` with `aria-checked`; presets use `aria-pressed`; the section nav marks the current page with `aria-current`.
- Keyboard: Enter sends, Shift+Enter adds a line (IME composition never sends); Esc closes the picker; ⌘/Ctrl+1-3 choose the first three models.

## 9. Parity: web and Android
Both clients implement the same behaviour with the same strings (`web/lib/strings.ts`, `res/values/strings.xml`) and the same pure helpers (picker filtering and provider status, settings lists, activity text, chat reducer), each with its own tests. When a feature changes, change both and the strings together. The only deliberate asymmetries are inherent to the device: showing the pairing QR (web) vs scanning it (Android), and Codex's ChatGPT sign-in, which must be finished in a browser on the computer that runs Zero (Android shows a note instead of a button).

## 10. What Zero does not do
No light theme, no gradients, no decorative animation, no onboarding tour, no upsells, no mode chip for web search (it is simply on), no memory tool exposed to the model, no per-section save buttons.
