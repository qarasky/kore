# KoreMind: design

What is specific to KoreMind: the chat, the composer, the model picker, notes and approvals, the settings sections, and how the Android app keeps up. Everything else (principles, tokens, type, spacing, layout, components, motion durations, voice, accessibility) is the Kore design system: **[kore-ui's DESIGN.md](https://github.com/qarasky/kore-ui/blob/v0.1.1/DESIGN.md)** (also in `web/node_modules/@qarasky/kore-ui/DESIGN.md` after `bun install`). If the two disagree, kore-ui wins; change this file.

The web UI is built from `@qarasky/kore-ui` (pinned tag in `web/package.json`): its `theme.css` holds every token, and AppShell, SettingsLayout, AuthScreen, AccountMenu, AppSwitcher and the primitives come from there. This repo adds no colours, sizes or components of its own beyond the chat-specific views below. The research behind KoreMind's choices is in [`docs/research/design-research.md`](docs/research/design-research.md); the product design is in `docs/superpowers/specs/2026-11-02-koremind-design.md`.

## 1. KoreMind's own principles
On top of kore-ui §1:
1. **Open and ask.** The app opens to a blank chat with the cursor ready. Nothing stands between the user and the first message.
2. **No wait.** The user's message shows instantly, a "thinking" indicator shows immediately, tokens stream as they arrive. Motion never delays a reply.
3. **Calm chat, dense chrome.** Answers are comfortable to read (15px, 1.6 line height, `reading` width 768px). Everything around them is kore-ui density.
4. **Few things, honestly named.** Five settings sections. Presets named by outcome. The assistant says what it can really do (web search and notes), and anything that reaches into another chat asks first.

## 2. Frame
The standard kore-ui AppShell (kore-ui §3): top bar with the KoreMind wordmark, AppSwitcher (when the server lists other apps in `KOREMIND_KORE_APPS`) and AccountMenu (Kore ID account, **Settings**, other apps, Sign out, which also ends the Kore ID session). The sidebar is the chat list: **New chat** (primary) as the header, then a `SidebarNav` "Chats" of `SidebarItem`s, newest first. Each page starts with a `PageHeader`: the chat's title (or "New chat") with **Delete chat** (danger IconButton → ConfirmDialog) on the right; "Settings" with the autosave status. Sign-in and the connect-to-server screen are `AuthScreen app="koremind"`: **Continue with Kore ID** is the only way in (no password form, no first-account setup), with "Change server" as the footer.

## 3. Chat
- **Column.** `max-w-reading` (768px), 16px side padding, inside the main panel. User messages right-aligned in a `raised` block with the overlay radius (8px); assistant text is plain, unboxed Markdown (`.koremind-md` in `globals.css`: 1.6 line height, code on `raised`, code blocks on `bg` with a hairline).
- **Under an answer:** what the assistant did and its sources, as kore-ui `Badge`s (outline; denied access is the danger tone). Sources are links styled with `badgeVariants`.
- **Status.** "Thinking" / "Searching the web" in `meta` muted with the three-dot pulse (`.dot-pulse`), as a polite status.
- **Home.** A single centred line, "What's on your mind?" (`text-display`), and the composer.

### Composer
A multi-line field that looks like a kore-ui input scaled up: `bg/60`, hairline border, `border-strong` on hover, accent border + 2px accent/25 ring while focused, overlay radius. Attachment chips (32px, raised, hairline, × IconButton) sit above the text; below it: attach (IconButton), the model chip, a spacer, then **Send** (primary IconButton, 40px) which turns into **Stop** (secondary) while answering. Enter sends, Shift+Enter adds a line, IME composition never sends. Errors (file too big, no model, model can't read photos) appear under it.

### Model picker
A kore-ui `Popover` above the model chip (start-aligned, `flush`, 440px). Left rail (56px): favorites star, a divider, one real provider logo per provider (20px, monochrome, current text colour); each is a 40px button with a tooltip, the active one on a white/5 tint with a 3px accent marker that slides between entries. Right: a filled small `Input` with a search icon (focused on open), rows (name, a "Free" `Badge` when every price tier is zero, "No photos" if the model can't read images, `Kbd` ⌘1–⌘3 on the first three rows, favorite star IconButton, accent check and `accent/10` row tint on the current one), then a **Thinking level** row of toggle chips when the model has levels.

**Every offered provider is on the rail** (Groq, OpenRouter, OpenCode, Codex: the recommended two first, in the order the server returns them). One that can't be used right now is dimmed but still selectable, and its pane explains why instead of listing models: *"Connect {name} in Settings to use its models."* (no key / not signed in) or *"{name} is turned off in Settings."*, with an **Open Settings** button that goes to Settings → Providers. Favorites and the saved choice only count providers that are ready; if the saved choice stops being allowed, KoreMind falls back to the default of the first ready provider. OpenCode counts as ready without a key because its free tier needs none.

Logos come from `assets/providers/*.svg` (models.dev) and are bundled, never loaded from the network: inline SVG on web, tinted vector drawables on Android. Codex (provider id `openai`) uses OpenAI's mark.

### Notes and approvals
The assistant has three notes tools (save, read, edit). A note belongs to one chat of one user; by default a tool only touches the current chat. When the user asks it to look at or change **another chat's** notes, an **approval card** appears in the chat (a `Card` with a warning/40 border): *"KoreMind wants to read the notes from “{chat}”"* / *"…edit the notes in “{chat}”"* with **Allow** (primary, small) and **Deny** (secondary, small). It collapses the moment it is tapped, and the stream stays open while it waits (60 s, then "The request expired."). Allowing covers that chat for the rest of the turn; edit covers read. Nothing about another chat, not even whether a note exists, is revealed before the user agrees. What happened is kept as badges under the message: *Saved note “X”*, *Updated note “X”*, *Read notes*, *Read notes from “Y”*, *Access to “Y” was denied*.

### Chat titles
A new chat is titled with its first words immediately. After the first answer, the chosen model names it (at most 5 words, same language, no quotes). The title arrives after the reply and never overwrites a title the user typed.

### Errors
Kore-ui §5: where the action happened, in danger colour, with what to do next. Form fields use `Field error`; sign-in uses AuthScreen's `error`; everything else (composer, chat, a settings card) a small animated `role="alert"` line (`components/InlineError.tsx`). "No provider" (free quota used up) shows a warning card with **Open Settings**.

## 4. Settings
kore-ui `SettingsLayout` (200px section nav with icons + one 576px column; a pill row on phones that keeps the current pill in view) under a `PageHeader` "Settings" whose right side shows the autosave status. One section at a time, remembered in the URL hash (`#providers`). Each section is one or more `SettingsSection`s.

| Section | Content |
| --- | --- |
| Models | Favorite models in a `Card` (model, provider under it, a filled star to unpin). Empty: `EmptyState` "No favorites yet". |
| Providers | One `Card` per provider: logo tile, name, a `Badge` **Recommended** (Groq, OpenRouter), and the state as a `StatusDot` with words: Connected (up), Free tier, no key (warn, OpenCode), Not connected (off). Actions as small buttons: Codex **Sign in with ChatGPT** (primary) + "Use an API key"; others "Use an API key"; connected: "Replace key" and **Disconnect** (danger-outline). The key field (Field + password Input + **Save key**) is disclosed on demand. Under a hairline, `Switch` rows (label first): **Use in model picker** (every provider) and **Only free models** (OpenCode, OpenRouter: "Hide paid models from the picker."). |
| Personalization | Name, tone presets as toggle chips (Short and direct, Friendly, Formal, Playful), free-text tone, "Anything it should always know" (`Textarea`, 600 characters, counter as the Field's `labelAside`). |
| Memory | `Switch` "Remember things about me" with the count as its description, then the remembered items in a `Card` (edit → `Textarea` with Cancel / Save; delete). Empty: `EmptyState`. |
| Account | A `Card`: signed in as, Kore ID (**Link Kore ID** or "Linked"), server with **Change server**. Then **Connect your phone** (QR) and **Sign out** (danger-outline) as their own sections. |

Settings are **autosaved** 700 ms after the last change and flushed when leaving; the header says Saving… / Saved / an error. There is no Save button (kore-ui §3 prefers autosave for KoreMind).

**Toggle chips** (tone presets, thinking level) are kore-ui's small secondary `Button` with `aria-pressed`, tinted `accent/15` with an `accent/60` border when on (`components/ToggleChip.tsx`; kore-ui has no toggle button).

### Connect your phone (QR)
Settings → Account → **Show QR code** (web): a white tile with dark modules (scanners read that best), a countdown ("Expires in 1:42"), and **New code** once it expires or on demand. The code lives two minutes and works once. On Android, **Scan QR code** appears on the Connect-to-server and Sign-in screens (and a `koremind://pair` link opens the app): it tries each address in the code until one answers, then signs in as the same account.

## 5. Motion
kore-ui's durations and curves (§2 Motion); KoreMind keeps `motion` for chat-specific effects, in `web/lib/motion.ts`: `quick` 140 ms and `smooth` 220 ms on `cubic-bezier(0.2, 0, 0, 1)`, and a spring (stiffness 520, damping 42) for layout moves (rail marker, list reflow). Overlays, the drawer, menus, dialogs and switches use kore-ui's own CSS animations.

What moves: new messages rise 8px and fade in (not the ones already on screen when a chat loads); the status line crossfades; sources and activity badges pop in staggered by 40 ms; Send turns into Stop with a small scale; attachment chips scale in and out; the rail marker slides; settings content fades 8px between sections; the key field and sign-in hints expand; removed rows collapse; inline errors expand. The OS "reduce motion" setting is honoured (`MotionConfig reducedMotion="user"` plus kore-ui's global rule; animator-duration scale on Android).

## 6. Copy
kore-ui §5. KoreMind specifics: labels are about outcomes, not parameters ("Only free models", "Remember things about me"); say what happens next ("Finish signing in on the tab that opened. This updates by itself."). All UI strings live in `web/lib/strings.ts` and `android/…/res/values/strings.xml`; kore-ui's own labels are passed from there.

## 7. Android
The Compose app follows the same tokens (`ui/theme/Theme.kt`: kore-ui's colours incl. danger-solid and status colours, 6dp controls / 8dp overlays, 15sp body, 600-weight titles) and the same screens, strings and pure helpers (picker filtering and provider status, settings lists, activity text, chat reducer, SSO link routing), each with its own tests. When a feature changes, change both and the strings together. Deliberate differences, by platform convention: Material switches (52×32), a 56dp top app bar, the model picker as a bottom sheet, system font instead of bundled Inter, 18–20dp chat bubble and composer radii. Inherent asymmetries: showing the pairing QR (web) vs scanning it (Android), and Codex's ChatGPT sign-in, which must be finished in a browser on the computer that runs KoreMind (Android shows a note instead of a button).

## 8. What KoreMind does not do
No light theme, no gradients, no decorative animation, no onboarding tour, no upsells, no mode chip for web search (it is simply on), no memory tool exposed to the model, no per-section save buttons.
