# Design references behind the Settings rework and the motion pass (2026-11-02)

What was studied, what it taught, and what Zero took from it.

| # | Reference | What it shows | Taken for Zero |
| --- | --- | --- | --- |
| 1 | [ChatGPT settings](https://ai-design-patterns.pages.dev/gallery/chatgpt-settings) | Nine categories in one modal; Personalization split from Settings; named voices with preview | Five sections only. Behavior ("Personalization") is its own section, not buried. Human labels, never parameters. |
| 2 | [ChatGPT personalization](https://ai-design-patterns.pages.dev/gallery/chatgpt-personalization) | Outcome-named presets, free-text for power users, auto-save with a toast, memory master switch | Tone presets as chips plus a free-text box, autosave with a quiet "Saved" badge, memory switch with a count. |
| 3 | [Gemini settings](https://ai-design-patterns.pages.dev/gallery/gemini-settings) | Persistent left nav, settings stay inside the app frame | Left section nav on desktop; a scrolling pill row on phones. |
| 4 | [Settings layout pattern](https://callaloo.pages.dev/docs/patterns/settings-layout) | 240px nav + fluid content, one section visible at a time, single column below 768px | 200px nav, one section at a time, collapses to a pill row. Settings nav kept visually distinct from the app sidebar. |
| 5 | [Claude composer teardown](https://ai-design-patterns.pages.dev/teardowns/claude/composer) | Model and effort visible before first send; send appears only when ready; flyouts keep the parent visible | Model chip stays in the bar; send/stop morph; picker keeps its rail. Warning: "Low" next to a model name reads as a downgrade, so thinking levels stay a separate labeled row. |
| 6 | [Composer comparison](https://aiuxplayground.com/teardowns/compare/design-the-composer) and [guide](https://aiuxplayground.com/guides/how-to-design-ai-chat-composer) | Calm default bar, removable context chips, no hidden model switches, disabled send must explain itself | Attachment chips animate in and out; the "no model" and "no photos" messages stay under the bar. |
| 7 | [Vercel AI Elements prompt-input](https://github.com/andrew-chen-wang/ai-elements) / 21st.dev prompt input | Auto-growing textarea, status-aware submit, stop while streaming | Already matched; submit and stop now swap with a short scale. |
| 8 | OpenCode desktop provider flow ([guide](https://llmgateway.io/guides/opencode-desktop)) | Providers listed with a "Connect" action; keys stored once and shared | Provider cards with a status dot and one clear action each; the key field is disclosed on demand. |
| 9 | [Motion: AnimatePresence](https://motion.dev/docs/react-animate-presence) and [accessibility](https://motion.dev/docs/react-accessibility) | Stable keys, `popLayout` for lists, `layoutId` for shared elements, `MotionConfig reducedMotion="user"` | One motion language (`web/lib/motion.ts`): 100-220 ms, one spring. Reduced-motion respected globally. |

## Rules adopted
- One visible section at a time, five sections at most.
- No Save button for preferences: autosave, flush on leaving, always show state.
- Show state before action: connection dots, memory counts, favorites empty state that says what to do.
- Disclose power controls (API keys) on demand; keep the common path (sign in, pick a tone) one tap.
- Motion explains a change (something appeared, moved, was removed). It never decorates, and it never delays a reply.
