# KoreCalendar web: motion design

> Status: implemented and merged (2026-11-02); tests: `web/lib/__tests__/motion.test.ts`, `web/e2e/motion.spec.ts`.

What moves in the web app, how fast, and why. Written from the references below; the numbers in `web/lib/motion.ts` come from here.
Calls marked **(my call)** are the designer's, not the owner's. The owner asked for: animations with Framer Motion (now published as `motion`),
based on researched references, with design psychology and calendar references analysed first.

## References and what each one gave us

| # | Reference | Kind | What we take from it |
| --- | --- | --- | --- |
| 1 | NN/g, [Executing UX Animations: Duration and Motion Characteristics](https://www.nngroup.com/articles/animation-duration/) | research (read in full) | 100-500 ms overall; **~100 ms for simple feedback** (checkbox, toggle); **200-300 ms for substantial changes** (a modal entering); popups **~300 ms in, 200-250 ms out** (entering a little slower than leaving); big moves up to 400 ms is "very slow". "It is far more common for animations to be too long than too short." **The more often users see an animation, the shorter and more subtle it should be.** Linear motion looks unnatural: ease-out for entering, ease-in for leaving. |
| 2 | NN/g, [Animation for Attention and Comprehension](https://www.nngroup.com/articles/animation-usability/) | research (read in full) | Three legitimate jobs: draw attention, **explain a change of state / show how things relate**, and (weakest) look modern. A cause-and-effect link only feels direct if the response **begins within 0.1 s**. Repeated animations become obstacles; "employ animations sparingly and only when they add meaning". |
| 3 | Laws of UX, [Doherty Threshold](https://lawsofux.com/doherty-threshold/) (Doherty and Thadani, IBM Systems Journal, 1982) | design psychology | Interaction stays fluid when neither side waits on the other: **respond within 400 ms**. Animation is for perceived performance (something moves while data loads), never a reason to make anything slower. |
| 4 | W3C, [WCAG 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | accessibility standard (read in full) | Interaction-triggered **motion** (things that move or change size) must be stoppable; **opacity and colour changes are not "motion"**, so a fade remains allowed. Sufficient techniques: honour `prefers-reduced-motion`, or offer a user toggle. Vestibular disorders cause nausea and dizziness. |
| 5 | Motion for React docs: [Layout animations](https://motion.dev/docs/react-layout-animations) and [Accessibility](https://motion.dev/docs/react-accessibility) | the library (read in full) | `layout` animates position and size caused by a re-render using transforms (cheap); `layoutId` links an element that disappears with one that appears so it **glides** from one to the other; `AnimatePresence` gives exits; `LayoutGroup` for siblings. Caveats: children stretch unless they also have `layout`; scroll containers need `layoutScroll`; borders and `display:inline` don't animate. `MotionConfig reducedMotion="user"` turns off transform and layout animation but keeps opacity (matching reference 4); `"always"` / `"never"` override the OS for a profile setting. |
| 6 | Material Design 3 motion ([overview](https://m3.material.io/styles/motion/overview/specs); numbers via secondary summaries, e.g. [skills.lc](https://www.skills.lc/shelbeely/Shelbeely-Agent-skills/shelbeely-shelbeely-agent-skills-skills-material-design-3-motion-skill-md) and [the token source](https://docs.rs/crate/hydrolysis-m3/latest/source/src/theme/motion/tokens.rs)) | design system | A named scale of durations from 50 ms to 1000 ms; **standard easing `cubic-bezier(0.2, 0, 0, 1)`** (fast start, long gentle settle), emphasized-accelerate `cubic-bezier(0.3, 0, 0.8, 0.15)` for leaving; shorter on mobile, longer for larger things; reduced-motion users get a fraction or none. The newer "expressive" system uses springs (stiffness/damping). The official pages did not load as text, so only the secondary summaries are relied on. |
| 7 | Issara Willenskomer, [UX in Motion Manifesto](https://informationdesign.org/creating-usability-with-motion-the-ux-in-motion-manifesto) (secondary summaries: [Creative Bloq](https://creativebloq.com/news/principles-of-ux-motion), [Adobe](https://blog.adobe.com/en/publish/2016/11/08/redesigning-the-12-principles-of-animation-for-motion-design)) | design theory | UI motion needs its own principles, not Disney's physics: easing, **offset and delay** (stagger), **parenting** (children follow their container), **transformation** (one object turns into another: continuity), value change, masking, overlay, cloning, obscuration, parallax, dimensionality, dolly and zoom. We use easing, offset/delay, transformation and parenting; we do not use parallax or zoom. The full manifesto text could not be fetched; this rests on summaries. |
| 8 | Calendar references: Notion Calendar (ex-Cron), [Blake Crosley's design breakdown](https://blakecrosley.com/guides/design/notion-calendar) and [efficient.app](https://efficient.app/apps/notion-calendar); Google Calendar's Material You redesigns ([9to5Google, 2024](https://9to5google.com/2024/10/23/google-calendar-material-you-redesign-dark-theme/)) | the product category | Fast calendars are **keyboard-first and typographic**: sparse visuals, shortcuts for today/create/go-to, drag-to-create snapping to 15 minutes. People who live in a calendar do the same few actions hundreds of times (next week, open event, drag). **Honest gap:** none of the public sources describe these apps' motion in detail, so calendar-specific motion rules below are inferred from references 1-2 and the category's keyboard-first character, not copied. |

Not used: Apple's Human Interface Guidelines for motion (the page would not load as text; I will not cite what I could not read).

## What the references mean for a calendar

1. **A calendar is a tool used in bursts, not a showpiece.** The frequent actions (previous/next period, open an event, drag, switch view, hover) must be near-instant and nearly invisible (refs 1, 3, 8). The rare actions (open the editor, undo toast, drawer) can afford the fuller 200-300 ms.
2. **Motion should explain time.** Stepping to the next week should carry a small push in the direction of time (next = content arrives from the right); switching view should cross-fade, because nothing moved in time, only the way it is drawn (ref 2: show relationships and state change; ref 7: transformation, orientation).
3. **Objects keep their identity.** When you drag an event to Thursday or the refresh brings back its new time, the block should travel there instead of vanishing and reappearing (ref 5 `layoutId`; ref 2 object relationship). This is the most valuable motion in the app: it answers "did my change land, and where".
4. **Feedback must begin within 100 ms** (ref 2, 3). Every animation here starts immediately (no delay before it starts); optimistic motion is preferred to waiting for the server.
5. **Enter slower than exit, ease-out in, ease-in out** (refs 1, 6). A popover appears in ~160 ms and leaves in ~100 ms.
6. **No bounce.** A calendar is about control and trust; springs are used only for release-after-drag, critically damped (no overshoot) **(my call; ref 6 expressive springs, tempered by ref 1's warning about "fun" being the weakest reason)**.
7. **Reduced motion is a first-class path** (ref 4, 5): the OS setting is honoured and there is a Settings choice (Follow system / Reduce / Full) because WCAG allows either technique and a person on a shared machine may want it per site. Reduced = no movement or scaling, but fades stay.
8. **The page must never depend on animation to be readable.** Server-rendered content is visible at first paint (`initial={false}` on first load); animations run only on client-side changes.

## The motion scale (`web/lib/motion.ts`)

| Token | Value | Use |
| --- | --- | --- |
| `duration.feedback` | 0.10 s | hover/press, checkbox and switch, colour changes |
| `duration.enter` | 0.16 s | popovers, menus, tooltips, event blocks appearing |
| `duration.exit` | 0.10 s | popovers leaving, events removed |
| `duration.view` | 0.20 s | period/view change |
| `duration.dialog` | 0.22 s in / 0.14 s out | editor, scope dialog, confirm |
| `duration.drawer` | 0.25 s in / 0.18 s out | mobile drawer |
| `ease.standard` | `[0.2, 0, 0, 1]` | everything entering or moving |
| `ease.exit` | `[0.3, 0, 0.8, 0.15]` | everything leaving |
| `spring.settle` | stiffness 500, damping 45 (critically damped is about 44.7) | a dropped event settling, layout glides |
| `stagger` | 12 ms per item, **capped at 120 ms total** | events appearing on a fresh view (offset and delay) |

Nothing exceeds 250 ms (ref 1's "big moves up to 400 ms is very slow").

## What moves

| Where | Motion | Why |
| --- | --- | --- |
| Period change (prev/next/today/go-to) | content enters with a 20 px push in the direction of time + fade, 200 ms; first load and view switches without a time change: fade only | ref 2 (explain change), ref 7 (orientation); direction tells you where in time you went |
| View switch (Day/Week/Month/Agenda) | cross-fade 200 ms; the active segment's highlight **glides** between segments (`layoutId`) | transformation/continuity; zero extra movement of content |
| Events on a freshly loaded view | not animated one by one: the whole view's push or fade (row above) carries them. Blocks animate only when they appear later (created, imported, un-hidden) | a stagger on top of a push would be two animations for one change; frequent actions get the least motion (ref 1) |
| The "+N more" list | its chips fade in 12 ms apart, capped at 120 ms in total | offset and delay (ref 7), on the one list that opens all at once |
| Event created | scales in 0.96 to 1 + fade (160 ms) | confirms the action landed |
| Event moved, resized, edited, or a series changes | the block **glides** to its new place (layout animation); across columns it travels from the old column to the new one (`layoutId` per event key) | object constancy (ref 2, 5) |
| Event deleted, or its calendar hidden | fades and shrinks out (100 ms) | confirms removal; Undo toast follows |
| Popover, "+N more", menus | scale 0.96 to 1 from the anchor side + fade, 160 ms in / 100 ms out | ref 1 (popups), origin shows where it came from |
| Editor, scope dialog, confirm | 8 px rise + fade in 220 ms, backdrop fade; out 140 ms | ref 1 (substantial change 200-300 ms) |
| Mobile drawer | slides from the left 250 ms in / 180 ms out; backdrop fade | ref 1, 6 |
| Toasts | rise + fade in, fade out; the stack re-flows with `layout` | calm, non-blocking |
| Mini month | the current-week band glides between rows when the day changes | transformation |
| Calendar list and token list (Settings) | rows glide into place when one is added or removed; a new row fades in (the Users page has no list to animate) | explains the change |
| Calendar checkboxes, the view switcher and mini-month days | 100 ms colour transitions (the check mark pops in over 100 ms); Switch and Button keep Tailwind's default 150 ms colour transition; no scale on press | ref 1 (feedback ~100 ms); frequent |

Explicitly **not** animated: the grid while dragging (it follows the pointer; the pointer is the animation), the now-line, scrolling,
the time axis, anything on a keyboard shortcut repeat (holding `j` must not queue motion: new navigation interrupts the previous),
page loads, and the skeleton (already a plain pulse).

## Reduced motion

- `MotionConfig reducedMotion` is `"user"` by default, `"always"` or `"never"` from the Settings choice (cookie `kc_motion`: `system|reduce|full`).
- Under reduction: transforms and layout animations are off, opacity fades stay (ref 4, 5). With the **operating system** setting on, `globals.css` also cuts every CSS transition and animation (including the dialog backdrop fade) to ~0 ms; the in-app "Reduced" choice affects only Motion's animations.
- Playwright tests emulate `prefers-reduced-motion: reduce` and assert the end states are the same and no transform is left on an event block.

## Risks and how they are contained

- **Layout animation with absolutely positioned, `calc()`-positioned blocks.** They are positioned with `top`/`height` in CSS variables; `layout` measures the box, so it works, but children can stretch: event content uses `layout="position"`.
- **Native `<dialog>` and exit animations.** `AnimatePresence` keeps the dialog mounted (and modal) for the exit; exits are short (140 ms) so the page is inert for that long at most.
- **Server Components and exits.** App Router can't animate a page leaving, so only entering is animated at page level; exits are used inside client-owned lists.
- **Playwright.** The existing e2e tests (70 when this was written, 80 now) are the safety net: any animation that makes an element unclickable or leaves it mid-transition fails them.
- **Bundle size (measured).** `motion` adds about 45 KB gzipped (one chunk, 135 KB raw) to a ~256 KB gzipped app: the layout engine (`domMax`) is what costs, and the glide animations need it. Components use the small `m` component under `<LazyMotion features={domMax} strict>`, so the full `motion` component is never bundled. Loading the features asynchronously was tried and rejected: it made the streamed page briefly contain a second (hidden) copy of the grid, which broke deterministic tests for no visible gain. Dropping layout animation (`domAnimation`, about 17 KB) would give up the glides, which are the point of the feature.
- **One frame under reduced motion.** An element that enters with a transform start (`x: 20`) shows that offset for a single frame at opacity about 0.007 before Motion jumps to the end state; nobody can see it, and the tests assert on visible frames only.
