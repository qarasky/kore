# Design research

Everything learned while researching design for Zero: personal AI assistant UIs, composers, settings, provider and model pickers, memory UX, and motion. Written 2026-11-02. Sources are teardown sites, component libraries and docs found by web search; none is an authoritative usability study, so treat conclusions as informed practice, not proof. Where a source did not say something, this document says so.

Zero's own decisions that came out of this live in [`/DESIGN.md`](../../DESIGN.md).

## 1. Sources

| # | Source | What it covers |
| --- | --- | --- |
| S1 | [ChatGPT settings](https://ai-design-patterns.pages.dev/gallery/chatgpt-settings) | Settings as a centered modal, nine categories, Personalization split out, named voices with a Play button. |
| S2 | [ChatGPT personalization](https://ai-design-patterns.pages.dev/gallery/chatgpt-personalization) | Outcome-named style presets, free-text instructions, memory master switch, saved-memory list with timestamps, version history, autosave with a toast. |
| S3 | [Gemini settings](https://ai-design-patterns.pages.dev/gallery/gemini-settings) | Persistent left sidebar of settings, blue "attention" dots, upgrade prompts inside settings. |
| S4 | [Settings layout pattern](https://callaloo.pages.dev/docs/patterns/settings-layout) and a design-system spec found beside it | 240px nav + fluid content, 3rem gap, one section visible, per-section save, single column below 768px, nav as its own landmark. |
| S5 | [Claude composer teardown](https://ai-design-patterns.pages.dev/teardowns/claude/composer) | Calm empty card, model + effort visible before the first send, web search on by default (no mode chip), "+" menu with flyouts, dictation waits for confirmation. |
| S6 | [Composer comparison](https://aiuxplayground.com/teardowns/compare/design-the-composer) and [composer guide](https://aiuxplayground.com/guides/how-to-design-ai-chat-composer) | ChatGPT vs Claude vs Perplexity vs Gemini: control placement, outcome labels, context chips, five composer patterns. |
| S7 | [Vercel AI Elements](https://github.com/andrew-chen-wang/ai-elements) / prompt-input ports and 21st.dev prompt inputs | Component anatomy: body, attachments, footer, submit, textarea; auto-grow, max height ~240px, Enter to send, status-aware submit. |
| S8 | OpenCode desktop provider flow ([guide](https://llmgateway.io/guides/opencode-desktop)) | Providers in a settings sidebar with "Connect", keys stored once and shared, model picker in the input bar with type-to-filter. |
| S9 | [Motion: AnimatePresence](https://motion.dev/docs/react-animate-presence), [layout animations guidance](https://skills.sh/c-jeril/framer-motion-skills/framer-motion-layout), [accessibility](https://motion.dev/docs/react-accessibility) | Stable keys, exit inside AnimatePresence, `popLayout` for lists, `layoutId` for shared elements, `MotionConfig reducedMotion="user"`. |
| S10 | OpenCode docs ([permissions](https://opencode.ai/v2/docs/permissions/), [skills](https://opencode.ai/v2/docs/skills/)) and the OpenCode config schema | How the engine decides which tools exist. Used for the "what tools do you have" finding below. |
| S11 | The owner's own brief and screenshots (T3 Code model picker), plus their Kore palette | The strongest source: dark only, compact chrome, calm chat, provider rail + favorites picker. |

Searches that found nothing useful: a rigorous UX audit of ChatGPT's or Linear's settings page. What exists is mostly community complaints and pattern galleries.

## 2. Findings by area

### 2.1 Settings structure
- **Keep behavior settings visible.** ChatGPT split Personalization out of Settings because "how the AI behaves" is a core need, not an advanced one (S1, S2). Zero gives it its own section instead of a fold at the bottom.
- **Dense category lists hurt.** Nine categories in one modal, including Orders and Parental controls, was read as clutter (S1). Zero caps Settings at five sections.
- **Persistent nav keeps context.** Gemini's left settings sidebar keeps the user in the app frame (S3). A full page instead of a modal was criticised by some ChatGPT users because quick tweaks became a context switch (S1 community thread). Zero uses a page with a left section nav, so the chat sidebar stays visible.
- **Two-column baseline.** ~240px nav plus a fluid column, single column on narrow screens (S4). Zero uses a 200px nav (its own sidebar is already 256px) and a pill row on phones.
- **One level only.** Don't nest category navigation inside category navigation; split heavy categories into cards (S4).
- **Distinguish settings nav from app nav.** Large title and its own landmark (S4). Zero sets `aria-label="Settings"` on the section nav and shows the page title in the header.
- **Blue "attention" dots are ambiguous.** Gemini's dots mean "something needs attention" without saying what (S3). Zero shows state in words ("Connected", "Free tier, no key", "Not connected") rather than dots alone.
- **Upsells in a utility area read as sales placement** (S3). Zero has none.

### 2.2 Saving
- Autosave with a quiet confirmation removes friction for preferences (S2). Weakness: no undo and a brief toast can hide mistakes (inference).
- Per-section save limits accidental cross-section changes (S4). Zero's sections are small, so it autosaves the whole Settings object after 700 ms of quiet and flushes when the user leaves.
- Always show state: Saving…, Saved, or an error that says what happens next.

### 2.3 Personalization and memory
- **Presets named by outcome** onboard casual users; free text serves power users (S2). Zero: four tone presets plus a free-text field.
- **Separate declared from inferred.** ChatGPT keeps "About you" (declared) apart from saved memories (inferred) and offers a master switch (S2). Zero does the same: Personalization is declared, Memory is inferred and editable.
- **Show memory as readable rows with control.** Search, prioritise, delete and timestamps build trust; version history lowers perceived risk (S2). Zero shows a count, edit and delete per row; no history yet.
- **Disclose when memory is used.** ChatGPT notes when search is applied to memory (S2). Zero's assistant is told memory exists and is given it at the start of a chat, so it no longer claims it cannot remember (see 2.8).

### 2.4 Composer
- **Calm, messaging-like default.** ChatGPT's bar looks like messaging, so casual users don't meet mode chips on day one (S6). Claude is similar with starter pills (S5, S6).
- **Show model and effort before sending** when cost, latency or quality varies (S5, S6). Zero's chip shows "Model Level" and opens the picker.
- **Do not hide switches that change quality.** (S6)
- **Context chips for what the next turn will use**; invisible context surprises, overcrowded chips clutter (S6). Zero's attachment chips show an image thumbnail or file icon, a name, and a remove button.
- **Send appears when there is something to send; it becomes stop while streaming** (S5, S7). Zero swaps the two with a short scale animation.
- **Disabled send with no explanation is an anti-pattern** (S6). Zero shows the reason under the bar: no model, uploading, photos unsupported.
- **Weak labels.** Claude's "Low" next to the model name reads as a downgrade, not a lower effort; two "how hard" controls (effort, thinking) with no guidance (S5). Zero keeps the thinking level in its own labeled row inside the picker.
- **Voice and dictation should be visually distinct** and should wait for confirmation (S5, S6). Voice is out of scope for v1.
- **Textarea behavior** (S7): auto-grow with a max height (~240px in the ports; Zero uses 200px), Enter sends, Shift+Enter adds a line, IME composition must not send.

### 2.5 Model and provider picker
- The owner's T3 Code screenshot is the reference: provider rail (favorites star, divider, provider icons with an accent marker), search with an accent underline, rows with a check on the current model, shortcut chips for the first three rows (S11).
- Outcome labels ("everyday", "complex", "quick") help casual users (S5, S6). Zero shows the provider's own names for now, plus "No photos" where a model can't read images.
- Free-tier gating should be visible before sending, not after (S6). Zero shows "Free tier, no key" on OpenCode and explains when the quota is gone.
- OpenCode desktop lists providers with a Connect action and filters models by typing (S8). Zero mirrors this: one card per provider with one clear action; a key field is disclosed on demand.
- A freshly connected provider may not appear until the engine reloads its catalog (S8). Zero retries internally and refreshes the picker after connecting.

### 2.6 Tool transparency (found in practice, then confirmed against the engine)
- When this was first researched Zero had one real tool, web search. OpenCode 2.2.5 also registers an inert `skill` tool that the model is shown and no config removes (verified: the `tools` array sent to the model was `skill, websearch`, and the skill list is empty because every skill is denied). Asked "what tools do you have", a model therefore listed skill and websearch.
- Mitigation: the system prompt tells the model plainly what it has and that memory is automatic. Since then Zero added three notes tools (`save_note`, `read_notes`, `edit_note`), so the model now sees five tools (the inert `skill` among them) and the prompt names the real four.
- Memory is not a tool. Giving the model a memory tool would add latency and tokens to every turn; Zero injects memory at the start of a chat and updates it in a background step. Notes are different on purpose: they are things the user explicitly asks to have written down, so they are tools.

### 2.7 Chat titles
- ChatGPT, Claude and others name chats automatically after the first exchange. Zero does the same with the model the owner has chosen, so it works for people who only have, for example, an OpenRouter key.
- OpenCode makes its own second model call to name each session, on the same model. Giving the engine session a title of its own suppresses that call, so Zero names chats once instead of paying twice.
- The title never blocks the reply: it is requested concurrently, sent as an event after `done`, and a title typed by the owner meanwhile wins.

### 2.8 Motion
- Motion explains change: something appeared, moved or was removed. It does not decorate.
- Stable keys, exit animations inside `AnimatePresence`, `popLayout` for list removals, `layoutId` for shared elements such as an active-nav pill or the picker's rail marker (S9).
- Keep exits short (about 100-150 ms). `mode="wait"` doubles perceived duration, so use it only for tiny swaps (S9).
- Layout animation is expensive; use it on small lists.
- Respect the OS reduce-motion setting globally via `MotionConfig` (S9). With `reducedMotion="user"`, transform and layout animations are disabled while opacity still animates.
- Never let motion delay a reply: animate entrances, don't gate rendering on them.

### 2.9 Settings controls worth copying
- Named options with a preview (ChatGPT voices) make an abstract choice concrete (S1). Zero's equivalent is tone presets that show their effect text as a placeholder.
- Helper text under a field says what it does ("Zero reads this at the start of every chat.").
- Lists with a real empty state that says what to do next (favorites, memory).

## 3. Anti-patterns to avoid (collected)
1. Many categories in one place with unrelated products (orders, parental controls).
2. Ambiguous attention dots with no meaning.
3. Upgrade prompts inside settings.
4. Disabled send with no reason.
5. A separate mode chip for the default behavior (web search is on by default).
6. Hidden model switches.
7. Two similar-looking voice controls.
8. A long "+" menu with equal visual weight for every row.
9. Silent failures: a button that "does nothing" (this actually happened with Disconnect, see DESIGN.md "Errors").
10. Animations that block or delay content.

## 4. What this research did not settle
- **Approval cards.** The "Zero wants to read the notes from X" card (Allow / Deny, 60 s timeout, allow lasts for the turn) was designed from OpenCode's own ask-permission model and common sense, not from a researched pattern. No source in section 1 covers it. Treat it as a first version to observe in use.
- **Provider logos.** Taken from models.dev (the registry OpenCode uses). It has no separate Codex mark, so Codex shows OpenAI's.
- No source gave touch-target sizes or accessibility guidance for composers (S6 says so). Zero follows its own Kore sizes: 40px controls, 32px compact.
- No evidence on whether autosave vs explicit save is better for this audience. Chosen from S2 and S4 and kept reversible.
- Android-specific patterns (bottom sheets, predictive back) were not researched beyond what the owner's brief and Material 3 give by default.
