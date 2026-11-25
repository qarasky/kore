# Kore design system

How every Kore web UI looks, moves and talks: Kore (files), KoreMind (assistant), KoreCalendar (calendar),
KoreMonitor (Flatline, uptime) and Kore ID (accounts and admin). This file is the source of truth. An app's own
design doc only covers what is specific to it (KoreMind's chat, KoreCalendar's time grid, Flatline's board) and
defers to this one for everything else.

The code is `@qarasky/kore-ui` (this repo): `theme.css` holds the tokens, `src/` the React components. The showcase
(`npm run dev`) renders every component in every state; `docs/screenshots/` has the pictures.

## 1. Principles

1. **One product, five apps.** A user moving from Kore to KoreCalendar should feel they never left: same chrome,
   same controls, same words. App-specific views (a file list, a week grid, a chat) are built from kore-ui parts.
2. **Dense chrome, calm content.** Navigation, tables and settings are compact (Kore's density: 40px controls,
   48px rows). Reading surfaces (chat, markdown, event details) get room.
3. **Show state in words.** "Connected", "Saving…", "Disabled", "Down". Colour and icons support the word, never
   replace it.
4. **Nothing silent.** Every action ends in a visible result: the change itself, a toast, or an error next to
   where it was triggered that says what to do.
5. **Quiet surfaces, three themes.** Color (the original blue-grey dark), Light (white) and Dark (pure black), one
   set of rules and one accent. Hairline borders over boxes, no gradients, shadows only on things that float
   (menus, popovers, dialogs, toasts). One accent, used sparingly: one primary action per view, card or dialog.
6. **Keyboard and screen reader first.** Every control is reachable and operable by keyboard, has a visible focus
   ring, and has a name. Radix primitives do the heavy lifting; don't fight them.
7. **No network at runtime.** Fonts and icons are bundled. Nothing is fetched from a CDN.

## 2. Tokens

All tokens are Tailwind v4 theme variables in `theme.css`, so each is a utility (`bg-surface`, `text-muted`,
`h-row`, `max-w-form`, `shadow-overlay`, `animate-kore-pop-in`) and a CSS variable (`var(--color-accent)`).

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#16181d` | Page background, sidebar, top bar |
| `surface` | `#1d2026` | The main panel, cards, auth card |
| `raised` | `#23262d` | Menus, popovers, dialogs, toasts, active nav pill, filled inputs |
| `border` | `#2c3038` | Hairlines: panel edges, table rows, input borders |
| `border-strong` | `#3a3f49` | Overlay edges, secondary-button borders, checkbox/switch off state |
| `text` | `#e6e8ee` | Primary text |
| `muted` | `#8a8f9a` | Secondary text, labels, hints, idle icons and nav items |
| `accent` | `#5b8def` | Primary buttons, focus ring, active nav icon, links, checked controls |
| `accent-hover` | `#7aa3f2` | Hover on accent fills |
| `accent-fg` | `#5b8def` | The accent as text or a thin line: links, the active nav icon, accent badges, check marks. Equals `accent` in Color and Dark; Light darkens it to pass AA. Fills, rings and focus outlines use `accent` |
| `danger` | `#f2777a` | Error text, invalid borders (at 70%), destructive menu items |
| `danger-solid` / `-hover` | `#c94b4f` / `#d65b5f` | Fill of a confirming destructive button |
| `warning` | `#e5a54b` | Quota notices, "free tier", cautions |
| `status-up` | `#3fb950` | Up, active, success |
| `status-warn` | `#f0c54b` | Degraded, pending, flapping |
| `status-down` | `#e5484d` | Down (status only; UI errors use `danger`) |
| `status-maint` | `#a371f7` | Maintenance (violet so it never reads as the blue accent) |
| `status-off` | `#5b616d` | Paused, not connected, disabled |
| `status-down-muted` | `#8a3a3d` | An acknowledged (muted) outage: still the down diamond, dimmed |
| `status-critical` | `#c0262c` | A severity deeper than down: a meter or gauge past its critical threshold. Status only |
| `on-accent` | `#ffffff` | Text and icons on `accent` and `danger-solid` fills (`text-on-accent`). Never `muted` on accent |
| `scrim` | black 60% | The dim layer behind dialogs, sheets and the mobile drawer (`bg-scrim`) |
| `chart-1` … `chart-4` | `#e0d9c9` `#9eb8cd` `#b5c8a1` `#c4acd2` | Categorical series in charts (up to four). Quiet on purpose; status colours stay for status |

Interaction states are white overlays on whatever surface is below, not new colours. They are tokens, so apps never
write `white/5`:

| Token | Value | Use |
| --- | --- | --- |
| `hover` | white 5% | Hover on transparent controls, menu and select rows, the highlighted option |
| `hover-subtle` | white 4% | Hover on large rows: nav items, settings nav, interactive table rows, list rows, the active app tile |
| `active` | white 10% | The pressed or current row of a list (a picked model, a pressed key) |
| `track` | white 6% | The empty part of a bar, skeleton shapes, neutral badges |

Accent states stay accent tints: `bg-accent/15` for accent pills and pressed toggles, `bg-accent/10` for selected rows.

**Every token is also a CSS variable on the page** (`theme.css` uses `@theme static`), so `var(--color-chart-1)` in
an SVG or an inline style works even when no utility uses it. Where CSS cannot reach (the `theme-color` meta tag,
a web manifest, an SVG icon file, a QR code, a canvas) import `KORE_THEME` / `KORE_THEME_COLOR` from
`@qarasky/kore-ui` instead of typing the hex; a test keeps them equal to `theme.css`.

### Themes

Three themes share every rule in this file; only colours, overlay tints, the scrim and shadow strength differ.

| Theme | What it is |
| --- | --- |
| **Color** (default) | The original blue-grey dark look: every value in the tables above. Adopting kore-ui changes nothing until someone picks another theme |
| **Light** | White surfaces with the same accent. `bg` is a very light grey frame, `surface` and `raised` are white, hairlines are cool greys, the interaction overlays flip to black tints, shadows get softer, the scrim is lighter. The accent fill is unchanged; the semantic colours used as text (`danger`, `warning`, `status-*`, `accent-fg`) are darkened so text on white passes AA |
| **Dark** | Pure black for OLED screens: `bg` `#000000`, near-black `surface` and `raised`, the same accent and the same semantic colours as Color, stronger shadows and scrim |

| Token | Color | Light | Dark |
| --- | --- | --- | --- |
| `bg` | `#16181d` | `#f7f8fa` | `#000000` |
| `surface` | `#1d2026` | `#ffffff` | `#0b0b0d` |
| `raised` | `#23262d` | `#ffffff` | `#161619` |
| `border` / `border-strong` | `#2c3038` / `#3a3f49` | `#e2e4ea` / `#c9ccd5` | `#232327` / `#36363c` |
| `text` / `muted` | `#e6e8ee` / `#8a8f9a` | `#16181d` / `#5a606c` | `#ececf0` / `#8d929d` |
| `accent` / `accent-fg` | `#5b8def` / `#5b8def` | `#5b8def` / `#2c5fc9` | `#5b8def` / `#5b8def` |
| `danger` | `#f2777a` | `#c0262c` | `#f2777a` |
| `warning` | `#e5a54b` | `#8f5200` | `#e5a54b` |
| `status-up` / `-warn` / `-down` / `-maint` | `#3fb950` `#f0c54b` `#e5484d` `#a371f7` | `#176f31` `#8a6100` `#cf222e` `#7c4bd6` | as Color |
| `hover`, `active`, `track` | white tints | black tints | white tints |

Everything else (`theme.css` has the full list, including `chart-*`, `status-off`, `status-critical`, `status-down-muted`,
`danger-solid`, `accent-hover`, `scrim` and the shadow colours) follows the same idea.

**How it works.** `data-theme="color" | "light" | "dark"` on `<html>` swaps the variables, so every utility and every
`var(--color-…)` follows with no component change; the attribute works on any element to theme a subtree. Components
never name a theme and never hard-code a colour: use tokens (`bg-surface`, `text-muted`, `border-border`,
`bg-hover`, `bg-scrim`, `text-accent-fg`), and where the colour belongs to a user's thing (a calendar) mix it with the
tokens (`tintOf`). A colour typed as hex in an app does not change with the theme.

- **`KoreProvider`** includes the `ThemeProvider`: it sets `data-theme`, remembers the choice (`localStorage`, key
  `kore-theme`), follows the operating system while the choice is **System** (a light OS gives Light, a dark OS gives
  Color, or Dark with `theme={{ systemDarkTheme: "dark" }}`), syncs other tabs and keeps `<meta name="theme-color">` in
  step. `useTheme()` returns `{ theme, preference, setTheme }`. `onThemeChange` lets an app save the choice to the
  user's settings so it follows them to every device.
- **No flash.** Put `themeInitScript()` in `<head>` (Next: `<script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />`
  and `suppressHydrationWarning` on `<html>`; Vite: paste the string into `index.html`). It sets `data-theme` before
  the first paint from the same storage key, with the same defaults as the provider.
- **`ThemeSwitcher`** is the control for a settings page (see §4). **`KORE_THEMES`** holds each theme as hex for the
  few places CSS cannot reach (the `theme-color` meta tag, manifests, SVG files, QR codes, the switcher's previews);
  `koreThemeColor(theme)` gives the meta colour. `THEME_IDS` lists the three ids and `THEME_STORAGE_KEY` is `"kore-theme"`. A test keeps every palette equal to `theme.css`.

**Contrast is tested, not promised.** A test computes WCAG contrast for every theme: `text` and `muted` reach 4.5:1 on
`bg`, `surface` and `raised`; `accent-fg`, `danger`, `warning`, `status-up`, `status-warn` and `status-maint` reach 4.5:1 as
text on all three surfaces and on the tinted fills of Alert; the down diamond and the accent line reach 3:1 as
graphics, which is what keeps focus rings visible on the page background. Two limits are known and the same in every
theme: white on the accent fill is 3.2:1, fine for 24px or bold 18.5px text and icons but under AA for 15px button
labels; and `accent-fg` on the 15% accent tint of a Badge or pressed ToggleButton is 4.1:1 in Color (4.5 or more in Light and Dark).

### Type

Inter (variable, bundled via `@fontsource-variable/inter`), then system UI fonts. Features `cv11`, `ss01`.
**The root font size is 15px** with line height 1.45; rem-based Tailwind spacing (`p-4`, `gap-3`) scales with it.

| Token | Size | Use |
| --- | --- | --- |
| `text-2xs` | 12 | Badges, counters, menu group labels |
| `text-meta` | 13 | Field labels, table headers, hints, errors, timestamps |
| `text-sub` | 14 | Compact controls, settings nav, secondary descriptions |
| (body) | 15 | Everything else: buttons, inputs, menu items, table cells |
| `text-heading` | 16 | Page header title, settings section titles |
| `text-title` | 17 | Dialog titles, in-page section titles (`SectionHeader`) |
| `text-brand` | 18 | Wordmark in the top bar |
| `text-display` | 24 | Wordmark above the auth card, one-off hero lines |

Weights: 400 body, 500 for buttons/labels/active nav, 600 for titles. Titles use `tracking-[-0.01em]`; the
wordmark `-0.03em`. Numbers in tables are `tabular-nums` (right-aligned cells do it for you).

### Spacing and sizes

Spacing follows Tailwind's 4-step scale (in 15px rems). Fixed sizes are tokens:

| Token | Value | Use |
| --- | --- | --- |
| `row` | 48px | List and table rows, toasts |
| `control` | 40px | Buttons, inputs, selects, menu items, nav items |
| `control-sm` | 32px | Compact buttons, icon buttons, row actions, toolbar filters |
| `icon` | 22px | File/folder icons in lists. UI icons are 16px (`size-4`), 18–20px in 40px buttons |
| `topbar` | 60px | Top bar height |
| `header` | 52px | Page header height |
| `sidebar` | 256px | Sidebar width |
| `sidebar-collapsed` | 64px | Collapsed (icon-only) sidebar width |
| `settings-nav` | 200px | Settings section nav width |

Minimum hit target is 32px; primary controls are 40px.

### Radius, elevation, z-index

- `rounded-ui` 6px: controls, cards, nav items, the auth card. `rounded-overlay` 8px: the main panel, dialogs,
  popovers, tables. `rounded-full`: avatars, badges, switches.
- Shadows: `shadow-overlay` (menus, popovers, selects, toasts, tooltips), `shadow-dialog` (dialogs),
  `shadow-card` (auth card only). Nothing else has a shadow. Their colours are theme variables, so Light uses soft
  cool shadows and Dark stronger ones.
- Z-index: sticky headers 10 · drawer + its overlay 40 · dialogs, menus, popovers, selects 50 (later in the DOM
  wins, so a menu inside a dialog is above it) · toasts 60 · tooltips 70. For an app layer that must sit with
  these use the variables (`z-(--z-toast)`; `--z-sticky`, `--z-drawer`, `--z-overlay`, `--z-toast`, `--z-tooltip`),
  never a new number.

### Motion

| Kind | Duration / curve | Used for |
| --- | --- | --- |
| feedback | 100–150ms | Hover, press, switch thumb, colour changes (`transition-colors`) |
| pop | 140ms in / 100ms out | Menus, popovers, selects, tooltips: scale 0.96 → 1 from the trigger side |
| dialog | 220ms in / 140ms out | Dialogs: fade + 8px rise; overlay fades 160/120ms |
| drawer, sheet | 250ms in / 180ms out | Mobile navigation drawer and Sheets slide in from their edge |
| toast | 220ms in / 120ms out | Rise 8px + fade |
| fade | 160ms in / 120ms out | Overlay scrims and plain fades |
| sidebar | 200ms | Width change when the sidebar collapses/expands |
| view | 200ms | A period or view change inside a page (a calendar moving a week); `koreDuration.view` |
| indeterminate | 1.2s loop | Progress without a value (static 40% bar under reduced motion) |

Enter on `--ease-standard` `cubic-bezier(0.2, 0, 0, 1)`, leave on `--ease-exit` `cubic-bezier(0.3, 0, 0.8, 0.15)`.
Exits are shorter than entrances. Motion explains a change and never delays content. `prefers-reduced-motion`
cuts every animation and transition to ~0 globally (theme.css). Apps that use `motion` for richer effects
(KoreMind, KoreCalendar) keep their own presets but use these durations and curves: `koreDuration` and
`koreEase` export them as plain numbers (seconds) and bezier tuples, and a test keeps them equal to `theme.css`.

### Breakpoints

In px (so they don't shift with the 15px root): `sm` 640, `md` 768, `lg` 1024, `xl` 1280. The layout switches at
`md`: below it the sidebar is a drawer and settings nav becomes a pill row. The auth screen's art panel appears
from 900px.

## 3. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ▦ Kore          [ search ………………………… ]          ⊞  (A) Anna ▾ │  TopBar 60px
├────────────┬─────────────────────────────────────────────────┤
│ [+ New]    │ ╭ My files  8 items                  ⇪  ⊕   ╮   │  PageHeader 52px
│ ▣ My files │ │ Name                       Modified    Size │   │
│   Shared   │ │ ▤ Campaign shots           Today 07:43 60KB │   │  rows 48px
│   Trash    │ │ …                                           │   │
│            │ │                                              │   │
│ Storage ▬  │ ╰──────────────────────────────────────────────╯   │  main panel: surface, 8px radius
└────────────┴─────────────────────────────────────────────────┘
  Sidebar 256px (bg)
```

- **AppShell.** Top bar across the full width; the sidebar below it on the left; the content in a rounded
  `surface` panel with a hairline border, 8px from the window edges. The page background (`bg`) frames it.
- **TopBar.** Menu button (below `md`), wordmark in a column as wide as the sidebar, a flexible middle (search,
  view controls), actions on the right in this order: app-specific primary action, `AppSwitcher`, `AccountMenu`.
- **Sidebar.** Optional header action (Kore's "New"), nav groups (`SidebarNav`, 2px gap, 20px between groups),
  footer pinned to the bottom (storage meter, settings link). Nav items are 40px, icon 16px; the current item is a
  `raised` pill with medium weight and an accent icon. A list that can be empty (chats) gives `SidebarNav` an
  `empty` line ("No chats yet"), shown in place of the items.
- **Collapsible sidebar.** With `collapsible`, a toggle sits at the start of the top bar (desktop only) and the
  sidebar collapses to a 64px icon rail: labels, section titles and counts hide (titled groups get a hairline
  instead), each item keeps its accessible name and shows it as a tooltip on the right. `Sidebar` shows
  `collapsedHeader`/`collapsedFooter` instead of its header/footer (e.g. an IconButton "New", a label-less
  Meter). The app owns the state: pass `sidebarCollapsed`, store what `onSidebarCollapsedChange` reports (cookie,
  localStorage, user settings). The drawer is always expanded. Use it for apps people keep open all day with a
  wide content area (KoreMonitor); leave it off when the sidebar holds content, not just navigation.
  `collapseShortcut="b"` adds ⌘B / Ctrl+B (off by default; it does nothing while a text field has focus and calls the
  same `onSidebarCollapsedChange`, so one handler persists both the button and the key).
- **Mobile.** Below 768px the sidebar is a drawer (modal, slides from the left, `min(88vw, 300px)`), opened from
  the top bar's menu button; following a link closes it. The wordmark hides on phones when the top bar has middle
  content. Tables scroll sideways inside their frame; secondary columns may hide (`max-sm:hidden`).
- **PageHeader.** 52px bar at the top of the panel with a bottom hairline: title (`h1`, 16px semibold), or
  breadcrumbs ending in the title; muted meta (a count); tabs (`NavTabs`) next to the title; actions right.
- **PageBody.** The scrolling area under the header, 24px padding (16px on phones), content centred at one of
  three widths: `form` 576px (settings, account, single forms), `reading` 768px (chat, documents), `content`
  1040px (tables, admin; default). Full-bleed lists (Kore's file list) skip PageBody and use a framed-less Table.
- **SettingsLayout.** Inside the panel: a 200px section nav on the left (border-right), one content column (max
  576px) on the right. Sections are `SettingsSection`s separated by hairlines. Below 768px the nav becomes a
  horizontally scrolling pill row above the content. At most six sections; the current one is `aria-current`.
  Prefer autosave with a "Saving…/Saved" status (`SaveStatus`, in `header`) for toggles; forms with several
  fields get a Save button. In the pill row the current pill scrolls into view when the section changes.
- **Auth screens.** Centred 380px column: wordmark (24px) above a `surface` card with 24px padding. Optional art
  panel on the right half from 900px (Kore's login picture).

## 4. Components

Every component takes `className` (merged with `cn()`, later classes win). Interactive ones are client components
(`"use client"`); Badge, Kbd, Skeleton, Spinner, EmptyState, StatusDot, Card, Stat and AppMark also render on the
server. Links go through the link component set on `KoreProvider` (Next `Link`, or a plain `<a>` by default);
links to other apps and to Kore ID are always plain `<a>`.

### Setup: KoreProvider
Wrap the app once. Sets the link component and hosts the tooltip delay group and the toast region.

### Button
- Anatomy: optional leading icon (16px), label. `md` 40px / `sm` 32px. `asChild` renders a link with button
  styles. `loading` shows a spinner, disables the button and sets `aria-busy`.
- Variants: **primary** (accent fill; one per view), **secondary** (default; strong hairline), **ghost**
  (toolbars, low emphasis), **danger** (solid red; only the confirm button of a destructive ConfirmDialog),
  **danger-outline** (a row's "Delete" that opens the confirmation), **link** (inline).
- States: hover (lighter fill / white 5% tint), focus-visible (2px accent ring, 2px offset), disabled (60%
  opacity, not-allowed cursor), loading.
- Do: verbs ("Add user", "Save", "Move to trash"); put the primary action last in a group. Don't: two primary
  buttons side by side; "OK", "Submit", "Yes".

### IconButton
Square, 32px (`sm`, default) or 40px (`md`), ghost by default. `label` is required: it is the accessible name
and the tooltip. Use for toolbar and row actions whose icon is unambiguous; otherwise use a Button with text.

### Input, Textarea
40px (`sm` 32px), `bg-bg/60`, hairline border → `border-strong` on hover → accent border + 2px accent/25 ring on
focus; invalid: red border. `leadingIcon` (search), `trailing` (unit, clear button). `variant="filled"` is the
top-bar search (raised, borderless). Placeholders are examples, never labels. `Textarea` is 4 rows and resizes
vertically; with `autoGrow` it grows with its content from `rows` up to `maxHeight` (240px) and then scrolls, with
no manual resize (a message composer, a note).

### Field
Label (13px, muted, medium) above, control, then hint (13px muted) or error (13px danger, `role="alert"`).
Wires itself: the label's `htmlFor`, the control's `id`, `aria-describedby` (hint or error) and `aria-invalid`
are set on any kore-ui control inside it. `required` adds a muted asterisk and `required`. `labelAside` for a
counter or a link on the label row. Do: validate on submit, then live once a field has an error.

### Select
Radix Select, styled as an input with a chevron. Options as `options` or `SelectItem` children
(`SelectGroup` for labelled groups). The selected option shows an accent check. For more than ~15 options, or remote data, use
`Combobox`. `name` adds a hidden input for plain forms.

### Combobox
A searchable single select for long or remote lists (time zones, people, folders). Looks like a Select; opens a
popup (at least 280px, max 400px tall) with a search field on top and the options below; each option has a
label, an optional muted right-hand hint (`description`: "UTC+05:00", an email) and hidden `keywords` that also
match. Filtering is local by default (every typed word must match, accent-insensitive; pass `filter` to change
it); pass `loadOptions(query, signal)` to search on the server (debounced 200ms, stale requests aborted, a
spinner in the field, "Searching…", and "Couldn't load results. Try again." on failure). "No matches" when empty.
Keyboard: Enter/Space/ArrowDown open; typing filters; arrows, PageUp/PageDown and Home/End move (disabled options
skipped); Enter selects; Escape closes without changing anything and returns focus to the trigger. ARIA: the
search field is `role="combobox"` with `aria-activedescendant` into a `listbox`. Use Select for ≤ ~15 fixed
options, Combobox beyond that or for remote data.

### Checkbox, Switch, RadioGroup
- **Checkbox**: 16px box, accent when checked, `checked="indeterminate"` for "some". For choices submitted later.
- **Switch**: 36×20 track, for settings that apply immediately. `labelFirst` puts the label left and the switch
  right (settings rows).
- **RadioGroup**: 2–5 visible options, each with label and optional description; arrows move.
- All take `label` + `description`; clicking the label toggles; a disabled one dims the whole row to 50%.
- **Checkbox `truncate`** keeps a long label on one line (an ellipsis) so the row can hold something after it.
- **Checkbox `color`**: for things that carry their own colour (a calendar, a label). The box border is the colour,
  the fill when checked; the check turns black on light colours. Only for that use: everything else stays accent.

### PasswordInput
An Input with a show/hide toggle inside its right edge: a real button named "Show password" / "Hide password"
with `aria-pressed`. Autocomplete is `current-password`; `newPassword` switches to `new-password` (sign-up, setup
link, reset, change password), so browsers offer to generate and save one and never fill an old one in. `rules`
(e.g. `minLengthRule(10)`) render a live checklist under the field (check when met, "done"/"not yet" for screen
readers), referenced by `aria-describedby` next to the Field hint. Put it in a Field; errors come from the Field.
Don't block paste; don't add a second "confirm password" field when the toggle is there.

### ColorSwatchPicker
A row of round colour swatches (32px; `size="sm"` 24px) as a radio group: Tab enters at the selected one, arrow
keys move and select, the selected swatch has a check (black or white, whichever reads) and a ring. Each swatch
needs a name (`{ value, label }`, "Blue"); bare hex strings are named by their hex. `allowCustom` adds a hex field
(accepts #rgb/#rrggbb, flags anything else as invalid, never rewrites what is being typed). For colours of user
things (calendars, labels, groups), not for theming the UI. `tintOf(hex)` draws such a thing on a surface: a
fill of the colour at 24% over `surface` (`background`) and the solid colour (`edge`) for a left edge, a dot or the
text; an invalid hex falls back to the accent. `isHexColor`, `normalizeHex` and `readableOn` sit beside it.

### Dialog
Radix Dialog. Centred, `raised`, strong hairline, 8px radius, `shadow-dialog`, black/60 overlay. Widths `sm` 420,
`md` 520 (default), `lg` 680. `DialogContent` requires a `title` (17px semibold) and takes a `description`; parts
`DialogBody` (scrolls) and `DialogFooter` (right-aligned, primary last; stacked on phones). × button top-right.
Focus is trapped; Escape and the overlay close it; focus returns to the opener (also when opened from controlled
state or a menu item). Do: one task per dialog. Don't: nest dialogs; put navigation in them.

### ConfirmDialog
Radix AlertDialog for a yes/no question before something consequential. Title is a question naming the thing
("Delete “notes.md”?"), description the consequence, confirm label the verb from the title. **Cancel has initial
focus**, so Enter never confirms by accident. `onConfirm` may return a promise: both buttons disable and the
confirm button reads "Working…" until it settles; it closes on success and stays open if it throws (show the
error yourself). `danger` makes the confirm button red.

### Menu, ContextMenu
Radix DropdownMenu / ContextMenu with Kore's panel: raised, strong hairline, min 200px, 40px items, 16px muted
icons, optional shortcut on the right, `MenuLabel` for a heading, `MenuSeparator`, checkbox/radio items and
submenus. Destructive items (`danger`) are red and last, after a separator. Navigation items use `asChild` with a
link; `icon` and `shortcut` still render around the link's text. Keyboard: Enter/Space/ArrowDown open, arrows move (disabled items skipped), type-ahead, Enter selects,
Escape closes and returns focus. A context menu is a shortcut: the same actions must exist in a visible menu.
- **ContextMenu** opens on right-click and long-press, and from the keyboard (the Menu key or Shift+F10) at the
  focused element inside the trigger, the first item focused. Same parts as Menu: `ContextMenuItem` (icon,
  shortcut, `danger`), separators, labels, checkbox/radio items, `ContextMenuSub` + `SubTrigger`/`SubContent`.
- **PointMenu** is a Menu opened at a point (`point={{ x, y }}`, `null` = closed) for surfaces that handle
  right-click themselves (a canvas like KoreMonitor's superboard): `onContextMenu={(e) => { e.preventDefault();
  setPoint(pointFromEvent(e)); }}`. `pointFromEvent` uses the cursor, or the target's position for a keyboard
  event. `onClose(reason)` says why ("select", "escape", "outside"); focus stays where it was unless
  `returnFocus` names an element. Children are the normal Menu items. Non-modal, so an item can open a dialog.

### Sheet
A side panel over the page (Radix Dialog: modal, focus trapped, Escape and the overlay close it, focus returns
to the opener) for details and secondary tasks that keep the page's context: a monitor's peek, a file's
details, filters. Slides from the `right` (default) or `left` edge, full height, widths `sm` 360, `md` 480, `lg`
640, `xl` 880. Below 640px it is a bottom sheet (max 85% tall, with a grab handle). `SheetContent` needs a
`title` (`hideTitle` keeps it for screen readers when the content has its own heading); `SheetBody` scrolls,
`SheetFooter` pins actions to the bottom. Use a Dialog for a focused task with one outcome; a Sheet when the user
reads or edits something alongside the list it came from.

### CommandPalette
⌘K / Ctrl+K anywhere (text fields included, never over another dialog) opens a dialog near the top of the screen:
a search field, results in titled groups (icon, label, muted description, shortcut hint as Kbd), "No results"
when nothing matches, and a hint row (↑↓ move · ↵ select · Esc close). Arrows move (wrapping), Enter runs the
command and closes the palette, Escape closes it and returns focus. Commands come as `groups` data or composed
`CommandGroup`/`CommandItem` children; search matches labels and `keywords`. `shortcut` sets the letter (default
"k") or `false` to wire it yourself with `useCommandShortcut`. Built on cmdk. Put every top-level place and the
main actions in it; it complements, never replaces, visible navigation.

### Popover
A small non-modal panel anchored to a trigger (event details, pickers). 320px default, 16px padding (`flush`
removes it), raised + `shadow-overlay`. Escape/outside click closes; focus returns to the trigger.

### Tooltip
Text-only, 13px, appears after 400ms on hover and immediately on focus. Names icon buttons; never holds
information that exists nowhere else, never interactive content.

### Tabs, NavTabs
`Tabs` (Radix) switch views of one thing in place; `NavTabs` are links (each tab is a URL) with
`aria-current="page"`. Variants: **pills** (default; compact, in page headers, Kore's admin nav) and
**underline** (sections inside a page: user detail Profile / Apps / Security).

### ToggleButton, ToggleGroup
A button that is on or off and stays that way: a filter chip ("Down only"), a time range, weekdays. Radix Toggle:
`aria-pressed`, Space/Enter toggles. 32px (`sm`, default) or 40px (`md`); off is a strong hairline like a secondary
button, on is an accent hairline with an `accent/15` fill, so keep the label the same and let `aria-pressed` carry
the state (or swap the icon). `shape="round"` makes pills, or circles for one letter. `ToggleGroup` with `ToggleGroupItem`s joins related
ones: `type="single"` is a radio group (a time range; `joined` fuses the items into one segmented control),
`type="multiple"` picks any (weekdays); arrows move between items. Name the group with `aria-label` and give every
item text or an `aria-label`. A setting that applies at once is a `Switch`; a choice submitted later is a
`Checkbox`; navigation between views is `Tabs`/`NavTabs`.

### Alert, InlineMessage, SaveStatus
Feedback that belongs to the page, not to one field or one action. Say what is going on and what to do about it, in
the voice of §5.
- **Alert**: a hairline box with an icon, an optional title (medium weight) and a body (regular weight, `text` colour: `muted` on a tinted fill is under AA), one optional
  `action` (a small Button) and an optional close (`onDismiss`, named by `dismissLabel`). Tones: **info** (default),
  **success**, **warning**, **danger**; the tone is a tinted fill and border plus an icon, never colour alone.
  Danger is `role="alert"`, the others `role="status"`. `banner` makes a full-width strip (square corners, bottom
  hairline) for the top of a page or panel ("Monitoring is paused", "A new version is ready"). Use it for a state
  that stays until it changes; a result of an action is a Toast, a field's error is `Field error`.
- **InlineMessage**: one line of 13px feedback not tied to a field ("Couldn't reach the server. Check your
  connection and try again."). Tones danger (default, `role="alert"`), warning, success, muted. `animated` opens it with a 200ms height and fade
  (reduced motion skips it) for a message that appears under a control.
- **SaveStatus**: "Saving…" (spinner) → "Saved" (check) → "Couldn't save. Try again." (`role="alert"`) for autosaving
  forms; `idle` shows nothing but keeps the live region mounted. Strings are `labels`.

### Toast
Bottom centre, one at a time (a new one replaces the current one), in a polite live region. Tones: info, success
(green dot), error (red border and text, stays 10s instead of 6s). One optional action (Undo) that shows a spinner
while it runs. Hover/focus pause the timer; × dismisses. Use for results of actions that have no other visible
effect. Don't use for errors that belong next to a field. `useToast().show({ message, tone, action })`.
- The region never blocks the page: it is `pointer-events: none`; only the toast itself takes clicks.
- A toast never takes Escape from the page: Escape dismisses a toast only when focus is on it (F8 moves focus to
  it). With a dialog open, Escape closes the dialog. Clicking a toast (its Undo) never counts as clicking outside
  an open Dialog, Sheet or palette.

### Table
Hairline frame with 8px radius (`framed={false}` inside a panel), header row 40px with 13px muted labels, body
rows 48px separated by hairlines. `TableRowHeader` (`th scope=row`) for the naming cell, `TableCell muted` for
secondary columns, `align="right"` for numbers. Sortable headers (`onSort`, `sorted`) are buttons and set
`aria-sort`. `interactive` rows highlight on hover; `selected` rows get an accent tint. `TableEmpty` for "no
results" inside the table, `TableSkeleton` (`columns` as a count or a width class per column, `rows`, `label`) for
the first load: placeholder rows in the table body with one visually hidden "Loading…" status. Row actions: a `MoreHorizontal` IconButton opening a Menu in the last column, plus
the same Menu as a ContextMenu on the row.

### Badge
Pill, 12px medium (`size="md"`: 13px, a little roomier, for a status in a card header). Tones: neutral, accent
("You"), success, warning, danger, maint, outline (roles). One or two words, sentence case.

### StatusDot
8px indicator + the state in words: up (green), warn (yellow), down (red **diamond**, so it reads without
colour), maint (violet ring), off (grey ring), accent (connected). `pulse` for live states. `size`: `sm` 6px (dense
rows, chips), `md` 8px (default), `lg` 10px (headers). `muted` marks an acknowledged problem: the same shape in a
dim colour (`status-down-muted` for down) with a muted label, so a known outage stops shouting but still reads
as down. Without a `label` it is decorative; then the state must be written next to it.

### Avatar
Round, 24/32/40px. Image if given, else initials (first + last word of the name, else the email's first letter)
in white on the accent. Decorative: the name is always written next to it.

### Meter, Progress
- **Meter** (`role="meter"`): a measurement in a known range: storage used, quota. Label (13px muted) above, a 6px
  bar, the amount in words below ("12 MB of 64 MB used"), which is also the `aria-valuetext`. The bar is accent,
  turns `warning` from 80% and `danger` from 90% (`thresholds` changes or disables that); in danger the words turn
  red too, so say what to do ("Free up space to keep uploading."). In a collapsed sidebar use `hideLabel` and
  put the words in `aria-label`.
- `size="sm"` makes the bar 4px for rows of meters (hosts, disks). `thresholds.critical` (off by default) adds a
  deeper `status-critical` red above that fraction; the words turn red from `danger` on.
- **Progress** (`role="progressbar"`): a running task (upload, import). With `value` it fills; without it is
  indeterminate (a sliding segment, `aria-busy`). `showLabel` puts the label and "2 of 3 files" above the bar.
- Don't use either for things that aren't a fraction of something (a count, a score).

### EmptyState
Optional icon in a soft circle, title as a statement ("No shared links yet"), one or two sentences on what to do,
one action. Centred in the space the content would take.

### Spinner, Skeleton
Spinner: 16px ring in the current colour; give it a `label` when nothing else says what is loading. Skeleton:
shapes of the coming content in `track`, pulsing (`pulse={false}` for a screen that stays open all day and loads
quietly); use for first loads longer than ~300ms, not for actions. `LoadingState` is a spinner and its words centred
in the space the content will take, for a first load with no shape to skeleton.

### Kbd, CopyButton, Card
- Kbd: a key or shortcut (`⌘K`, `Esc`), 20px tall.
- CopyButton: copies, then says "Copied" (or "Couldn't copy") for 2s, announced politely; `iconOnly` for tight
  rows. Use for setup links, tokens, URLs.
- Card: hairline-bordered `surface` block for grouping (provider card, disk card). No shadow.
- Stat: one headline number in a Card: `label` (13px muted), the figure (24px semibold, tabular), an optional
  `hint` ("of 20 seats"), `tone` (default, accent, success, warning, danger) for the figure's colour (the label or hint must still say what it means), `loading`
  for a placeholder. A `dl` inside, so it reads label then value. Lay several out in a grid; for a fraction of a
  limit use `Meter`.
- CardList, ListRow: a Card of rows separated by hairlines (account details, a user's sessions, a provider's models).
  A row has an optional `icon`, a `label` with an optional `description` line, a muted `value` on the right and
  `actions` (Switch, IconButton, Menu) at the far end; `href` or `onClick` makes the label area a link or button
  and the row highlights on hover. Actions are never inside the link. Rows are 48px minimum. `wrap` lets the label and
  description wrap instead of truncating (notes, long names); `children` replaces them for a row with its own
  content, such as an inline editor, while `icon`, `value` and `actions` still frame it. For columns and sorting use
  `Table`.

### Time, CopyField, CodeBlock, DescriptionList
- **Time / `formatRelativeTime`**: a moment in words as §5 asks: "Just now" for the last minute, "Today 07:43",
  "Yesterday 21:05", then "Jan 3" (and "Jan 3, 2025" for another year). "Today" and "Yesterday" come from
  `Intl.RelativeTimeFormat`, so `locale` translates them and orders dates; the clock is 24-hour unless `hour12`.
  `inline` lower-cases the first word for mid-sentence use ("Last active today 07:43"); a missing value reads "Never".
  `<Time value>` renders a `<time>` with the exact moment as `dateTime` and as its tooltip.
- **CopyField**: a read-only `Input` with a `CopyButton` inside its end; focusing selects everything. For setup links,
  tokens and URLs; put it in a `Field` and say in the hint when a secret is shown once. `mono` for tokens.
- **CodeBlock**: a command or snippet, monospace on a quiet well, scrolling sideways (or `wrap`), with a Copy button
  and an optional `language` name. No syntax colouring.
- **DescriptionList**: label and value pairs in a real `dl` with hairlines between rows ("Issuer", "Redirect URIs");
  a value can be a list, `mono` for URLs and ids. Read-only facts; editable rows are `ListRow`s.

### SearchButton, FilterBar, SelectionBar, PointTooltip
- **SearchButton**: the top bar's search when searching opens something else (a `CommandPalette`): it looks like the
  filled search `Input` but is a button with the shortcut as a `Kbd` (`hint`, default ⌘K). No half-working text field.
- **FilterBar**: the wrapping row of controls above a list or table (a search `Input`, small `Select`s, `ToggleButton`s),
  as a named group.
- **SelectionBar**: a `role="toolbar"` that floats at the bottom centre while rows are selected: "3 selected", the
  actions on them (small Buttons, Delete last as `danger-outline`) and a × that clears. It renders nothing at `count` 0, sits
  at the drawer level (below dialogs and toasts), and the selection must also be visible in the list.
- **PointTooltip**: a tooltip that follows a point (a heatmap cell, a chart bar, a heartbeat) instead of sitting on an
  element: same look as `Tooltip`, never takes the pointer, stays inside the viewport. Drive `point` from
  `onPointerMove`; give it an `id` and reference it with `aria-describedby`. Text only, never the only place a fact lives.

### AppTile, ColorDot
- **AppTile**: an app's mark in a bordered square (40px or `sm` 32px) for app lists; an app Kore does not know (a
  client registered in Kore ID) shows its initials.
- **ColorDot**: a 16px (or `sm` 10px) swatch of a user-chosen colour, round or `square`. Decorative: the name is
  always written next to it.

### ThemeSwitcher
The control for the theme (§2, Themes): a radio group of tiles, each with a tiny window drawn in that theme's own
colours, the name and one line ("Color: The original blue-grey dark look", "Light: White surfaces, the same accent",
"Dark: Pure black, for OLED screens", "System: Match this device"). Arrows move and select; the choice applies and is
remembered at once, with no Save button. Put it in a settings section titled "Appearance". `includeSystem={false}` hides
System; `labels` translates the names and descriptions; `aria-label` names the group (default "Theme").

### AppShell, TopBar, Sidebar, PageHeader, PageBody, SectionHeader, SettingsLayout
See §3. `SectionHeader` is the in-page heading with a muted line and actions ("Users · 6 users · Add user").

### Identity
- **AppMark / Wordmark / KoreLogo.** Marks are drawn in the accent with Kore's 1 / 0.6 / 0.3 opacity ramp:
  Kore 2×2 tiles, KoreMind four arcs, KoreCalendar 3×3 grid, KoreMonitor a heartbeat whose flat line fades in (0.3) and out (0.6), Kore ID a core in a
  ring. Wordmark = mark + name, semibold, `-0.03em`; size it with `text-brand` (top bar) or `text-display`
  (auth). Don't recolour marks per app or add gradients.
- **AppSwitcher.** Grid button in the top bar; a popover with a 2×2 grid of app tiles (mark, name, one-word
  description). URLs come from config (`urls`); apps without a URL (no access) are hidden; the current app is
  highlighted and `aria-current`. Optional "Kore ID account" footer link. `AppGrid` is the same grid on its own
  (Kore ID's "Your apps").
- **AccountMenu.** Avatar + name (from `sm`) in the top bar (or a sidebar footer with `side="top"`). Menu: user
  header (avatar, name, email), **Kore ID account** (only when `accountUrl` is given), app-specific items
  (children: Settings, Change password, Keyboard shortcuts), **Switch app** (the other apps, when `apps` is
  given), separator, **Sign out**. With Kore ID off, omit `accountUrl`: the menu has no Kore ID item or mark and
  shows only what the app passes. Sign out must end the Kore ID session too when there is one (follow the app's
  end-session redirect).
- **AuthScreen.** Wordmark, card title ("Sign in"), one-line description, `notice` and `error` slots, **Continue
  with Kore ID** (primary, first), an "or" divider, the optional email + password form (submit becomes secondary
  when Kore ID is offered; primary when it isn't), `children` for other screens (set password, "You don't have
  access to KoreMind", sign-out confirmation), `footer` links, optional `aside` art. The password form manages its
  own pending state ("Signing in…") while `onSubmit` runs; the app passes `error` and `invalid` back. The
  password is a PasswordInput (show/hide). `mode="set-password"` is for first-account setup, setup links and
  resets: title "Set your password", a "New password" field with `new-password` autocomplete and the `rules`
  checklist, "Set password"/"Saving…"; `emailReadOnly` shows a known email without letting it be edited (it
  stays in the form so password managers save it against the right account).

## 5. Voice and copy

- **Sentence case** everywhere: titles, buttons, menu items, tabs, labels ("Add user", "Shared links").
  Product names keep their case (Kore ID, KoreMind).
- **Short and plain.** No exclamation marks, no "Oops", no "please" in errors, no jargon ("Not connected", not
  "Provider unavailable"). Address the user as "you"; the app doesn't say "I" or "we".
- **Buttons are verbs** that say what happens ("Reset password", "Move to trash"); the confirm button repeats
  the verb of the confirm title. Cancel is "Cancel".
- **Show state in words**: "Saving…" → "Saved"; "Active"/"Disabled"; "Free tier, no key". Use the ellipsis
  character (…) for in-progress states.
- **Errors** say what went wrong and what to do next, where it happened: "That email and password don't match.
  Try again, or ask your admin for a reset link." / "Use at least 10 characters." / "Couldn't reach the server.
  Check your connection and try again." Never only "Error" or a status code.
- **Toasts** are past tense facts: "Link copied", "Moved “Q3 budget.csv” to trash".
- **Empty states** state the fact, then the next step: "No shared links yet. Share a file or folder to get a link
  anyone can open."
- **Names in copy** go in curly quotes: “Q3 budget.csv”. Times are relative when recent ("Today 07:43",
  "Yesterday"), dates otherwise (`Time`, `formatRelativeTime`).
- All UI strings live in the app's strings module; kore-ui's own strings (Close, Dismiss, Cancel, Sign in,
  Continue with Kore ID…) are props with English defaults.

## 6. Accessibility

- Visible focus on everything: 2px accent outline with 2px offset (`:focus-visible`); inputs show accent border +
  ring instead. Never remove focus styles without a replacement.
- Every control has a name: visible label, or `aria-label` (IconButton `label`). Icons inside named controls are
  `aria-hidden`.
- Forms: labels above controls via `Field`; errors are announced (`role="alert"`) and referenced by
  `aria-describedby`; invalid controls have `aria-invalid`. Don't disable a submit button to signal invalid
  input; let it submit and show errors.
- Overlays: dialogs trap focus and return it; menus and selects are fully keyboard-operable; Escape always closes
  the topmost layer only.
- Navigation: current page/section marked with `aria-current="page"`; landmarks: `header` (top bar), `nav`
  (labelled), `main` (the panel).
- Live status: toasts and async results in polite live regions; errors in `role="alert"` (`Alert` danger,
  `InlineMessage` danger, `SaveStatus` error); other notices are `role="status"`.
- Colour is never the only signal (StatusDot words and shapes, invalid fields also have text).
- Contrast: in every theme `text` and `muted` on `bg`/`surface`/`raised` meet WCAG AA for body text, and so do
  `accent-fg` and the semantic colours used as text (tested, §2 Themes); don't put `muted` text on `accent` or on a
  tinted fill (Alert body text is `text`). Use `accent-fg`, not `accent`, for accent-coloured text.
- Targets ≥ 32px; primary controls 40px. Respect `prefers-reduced-motion` (global in theme.css).
- Tables have a caption (visually hidden is fine) and header cells with scope.

## 7. Decisions where the apps disagreed

One line each, so migrations know what changes.

- **Token names: Kore's** (`bg`, `surface`, `raised`, `muted` = text colour…). Flatline's shadcn names
  (`background`, `muted` = a surface, `muted-foreground`, `primary`, `destructive`) go away.
- **Root font size 15px** (Kore, KoreMind, KoreCalendar). Flatline moves up from 14px.
- **Status colours from Flatline** (`#3fb950` up, `#f0c54b` warn, `#e5484d` down, `#a371f7` maint) plus a grey
  `status-off`; UI errors keep Kore's softer `danger` `#f2777a`.
- **Top bar 60px, sidebar 256px** (Kore). KoreCalendar's 56/248 and KoreMind's full-height sidebar change.
- **Top bar spans the full width** with the wordmark above the sidebar (Kore, KoreCalendar); KoreMind's and
  Flatline's full-height sidebars with the logo inside go away.
- **Content in a rounded surface panel with a hairline** (Kore). KoreCalendar's borderless panels gain the border.
- **Mobile switch at 768px in px** (all used `md`, which was 720px at a 15px root); the drawer pattern is
  KoreMind's/KoreCalendar's (left slide-in, closes on navigation).
- **Inputs on `bg/60` with accent border + ring on focus** (Kore admin, KoreCalendar). KoreMind's `surface`
  inputs and Kore's `raised` login inputs change.
- **Labels 13px medium muted** (Kore). KoreCalendar's 14px labels shrink.
- **Secondary button = strong hairline, transparent** (Kore). KoreCalendar's raised-fill secondary and KoreMind's
  raised "ghost" change; Kore's muted `smallButton` becomes `Button size="sm"`.
- **Destructive: solid `danger-solid` only to confirm, `danger-outline` to open the flow** (Kore). KoreCalendar's
  outline-only danger and KoreMind's text-only danger change.
- **Dialogs: 8px radius, raised, strong hairline, title 17px** (Kore), on Radix instead of native `<dialog>`.
- **Menus: Kore's panel** (40px items, 16px muted icons) on Radix; Flatline's shadcn 32px items grow.
- **Switch 36×20** (KoreCalendar, denser) over KoreMind's 44×24.
- **Collapsible sidebar: opt-in icon rail with tooltips, state owned by the app** (Flatline's shadcn sidebar
  persisted itself in a cookie and had a ⌘B shortcut; kore-ui has neither, so apps decide).
- **Meter thresholds 80% / 90%** (Kore turned its storage bar red only above 90%; warning is new).
- **Toasts: one at a time, bottom centre** (Kore, KoreCalendar). Since 0.2 a small custom live region instead of
  Radix Toast, whose layers took Escape from open dialogs; no swipe-to-dismiss.
- **Command palette on cmdk** (Flatline's), restyled as a kore-ui dialog near the top; ⌘K never opens over
  another dialog (Flatline's rule).
- **Sheets: modal, from the right by default, bottom sheet on phones** (Flatline's peek panel, made a component).
- **Password fields show a toggle, not a confirm field** (Kore's PasswordInput); new passwords always use
  `new-password` autocomplete (KoreMind's request for first-account setup).
- **Colour swatches are a radio group with a check** (KoreCalendar's ColorPicker), named swatches preferred.
- **Kore ID item only when the app passes its URL** (all four apps hid it locally when SSO is off).
- **Settings: 200px section nav + one 576px column, pill row on phones** (KoreMind's proportions,
  KoreCalendar's bordered nav inside the panel).
- **Auth: Kore's centred card with optional art; Kore ID first and primary**, password form second (all apps
  previously put the password form first).
- **Breadcrumbs (Flatline) live in the PageHeader**, ending in the `h1`; Flatline's 48px sticky header becomes
  the 52px PageHeader.
- **Motion: KoreCalendar's durations and curves**, KoreMind's 140/220ms map onto them; no motion library in
  kore-ui (CSS only); apps may keep `motion` for app-specific effects.
- **Icons: lucide** everywhere; Kore's and KoreCalendar's hand-drawn `icons.tsx` go away.
- **Hover, active and track are tokens** (`hover` 5%, `hover-subtle` 4%, `active` 10%, `track` 6%, 0.3.0). Every app
  and kore-ui itself wrote `white/5` and friends by hand (about 50 places); nav hover stays 4%, interactive table
  rows go from 3% to 4%, the command palette's highlighted row from 6% to 5% (the menu's).
- **Pressed chips are `ToggleButton`** (0.3.0). KoreMind's `ToggleChip`, Flatline's filter chips and KoreCalendar's
  weekday picker each had their own; the old advice "Chip stays app-specific or becomes `Button size="sm"` with
  `aria-pressed`" is replaced. Flatline's chips (`h-7`, under the 32px minimum target) grow to 32px.
- **One component for notices: `Alert`** (0.3.0), with `InlineMessage` for a bare line and `SaveStatus` for
  autosave. Apps stop hand-rolling `role="alert"` paragraphs and warning cards.
- **All tokens are always CSS variables** (`@theme static`, 0.3.0): Tailwind would otherwise drop a variable no
  utility uses, which broke `var(--color-chart-1)` in SVG and inline styles.
- **Hex mirrors exist only for places CSS cannot reach** (`KORE_THEME`, 0.3.0): theme-color meta, manifests, SVG icon
  files, QR codes. Motion numbers for JS animation are `koreDuration`/`koreEase`. Both are tested against `theme.css`.
- **Themes: Color, Light, Dark** (0.3.0). Color is the original look and the default, so nothing changes until a user
  picks. Light is white with the same accent; the semantic colours used as text are darkened there because the
  brand values (`#e5a54b` amber, `#3fb950` green) are 2 to 3:1 on white. Dark is pure black for OLED with the same
  accent and semantic colours. "Dark only" is gone from the principles.
- **Accent as text is `accent-fg`** (0.3.0): the accent fill and focus ring stay the brand blue in every theme; only
  accent-coloured text and thin lines take `accent-fg`, which is darker in Light.
- **`StatusDot` labels for `down` use `danger`** (0.3.0), not `status-down`: the diamond keeps `status-down`, but that
  red as 15px text was 3.9 to 4.2:1 on `surface` and `raised` in Color. The label colour is slightly lighter there now.
- **Light page background is `#f7f8fa`**, lighter than a typical app grey, so the accent line (focus rings, the active
  nav icon) reaches 3:1 against it; hairlines carry the separation from the white panel.
- **Alert body text is `text`** (0.3.0), not `muted`: `muted` on a tinted fill measured 4.2 to 4.35:1.
- **Marks: one family in the accent**; KoreMonitor's cream heartbeat tile became the accent heartbeat with the
  family's opacity ramp (0.2.2). Its app id stays `flatline`.

## 8. Migrating an app

### Install

```jsonc
// package.json
"dependencies": {
  "@qarasky/kore-ui": "https://codeload.github.com/qarasky/kore-ui/tar.gz/refs/tags/v0.3.0",
  "lucide-react": "^1.67.0" // if the app imports icons itself
}
```

Peers: `react` and `react-dom` ^19, `tailwindcss` ^4. Radix, lucide, clsx, tailwind-merge, cva and the Inter font
come with kore-ui. The package ships TypeScript source: your `tsc` checks it with your settings (it is written for
`strict` + `noUncheckedIndexedAccess`).

### CSS

Replace the app's `@theme` block, base layer and font setup with:

```css
@import "tailwindcss";
@import "@qarasky/kore-ui/theme.css";
@source "../node_modules/@qarasky/kore-ui/src"; /* relative to this CSS file */
```

Keep only app-specific CSS below it (markdown styles, the calendar grid, the monitor board). Remove any
`@fontsource` import from the layout: theme.css brings Inter.

### Next.js

```ts
// next.config.ts
const nextConfig: NextConfig = { transpilePackages: ["@qarasky/kore-ui"], /* … */ };
```

```tsx
// app/providers.tsx — a client component, because a component (Link) can't be passed from a server component
"use client";
import Link from "next/link";
import { KoreProvider } from "@qarasky/kore-ui";
export function Providers({ children }: { children: React.ReactNode }) {
  return <KoreProvider linkComponent={Link}>{children}</KoreProvider>;
}
```

Wrap `{children}` in the root layout with `<Providers>`. Server components may import kore-ui directly (the
interactive parts are client components), but event handlers can only be passed from client components.

### Themes in an app

Nothing to do for the Color theme. To offer Light, Dark and System:

1. Add the no-flash script to `<head>`. Next: `<script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />` in
   `app/layout.tsx` and `suppressHydrationWarning` on `<html>`. Vite: paste `themeInitScript()`'s output into
   `index.html`. Pass the same options (`storageKey`, `defaultTheme`, `systemDarkTheme`) to `KoreProvider theme={{ … }}`.
2. Put `<ThemeSwitcher />` in an "Appearance" section of settings (or Kore ID's account page). To keep the choice per
   user across devices, save it from `theme={{ onThemeChange }}` and pass the saved value as `defaultTheme`.
3. Make the app's own colours follow: replace typed hex colours and `white/N`, `black/N`, `text-white`, `bg-black/N` with
   tokens; mix user colours with `tintOf`; use `KORE_THEMES[theme]` / `koreThemeColor` where CSS cannot reach (a manifest, a
   QR code, the chart or canvas drawing code, which should read `getComputedStyle` or `useTheme()`). A static `icon.svg` can
   stay in one theme (or use `@media (prefers-color-scheme)` inside the SVG).
4. Look at every screen in all three themes; a hard-coded dark assumption shows up at once in Light.

### Kore (`qarasky/kore`, web/)

- Delete: `Modal.tsx` (→ `Dialog`), `ConfirmDialog.tsx` (→ `ConfirmDialog`), `Menu.tsx` + `ContextMenu.tsx`
  (→ `Menu`/`ContextMenu`), `Select.tsx` + `lib/listbox.ts` (→ `Select`), `Toast.tsx` (→ `ToastProvider` via
  `KoreProvider`, `useToast().show({ message, tone, action: { label, onClick } })`; `action.run` → `onClick`),
  `EmptyState.tsx` (→ `EmptyState`), `wordmark.tsx` (→ `Wordmark app="kore"`), `icons.tsx` (→ lucide),
  `admin/fields.tsx` button/input class strings and `Field`/`CopyButton` (→ `Button`, `Input`, `Field`,
  `CopyButton`); empty/not-found messages can use `EmptyState`.
- Replace: `app/(app)/layout.tsx` shell markup → `AppShell` + `TopBar` (SearchBox inside, `variant="filled"`) +
  `Sidebar` (NewMenu as `header`, StorageMeter as `footer`); `SidebarNav.tsx` → `SidebarNav`/`SidebarItem` (keep
  the drop-target props by wrapping, or pass them through `className`/a custom link); `AccountMenu.tsx` → kore-ui
  `AccountMenu` (Kore ID account link, apps, sign out; "Change password" only while local login exists, as a
  child item); `admin/AdminNav.tsx` → `NavTabs` in a `PageHeader`; `UsersTable.tsx` → `Table` parts; the login
  page → `AuthScreen app="kore"` with `sso.href` = the OIDC start route and `aside={<LoginArt/>}`;
  `StorageMeter.tsx` and `admin/UsageBar.tsx` → `Meter` (`valueText` = "12 MB of 64 MB used"); upload tray bars
  → `Progress`.
- Visual changes: login inputs go from `raised` to `bg/60`; Kore ID button moves above the password form and
  becomes primary; row action buttons become `Button size="sm"`.

### KoreMind (`qarasky/koremind`, web/)

- Delete: `components/ui.tsx` (`Button` → `Button`; `Field` → `Field` + `Input`; `ErrorText` → `Field error` or
  AuthScreen `error`), `settings/parts.tsx` (`SectionHeader` → `SettingsSection`; `Card` → `Card`; `Switch` →
  `Switch`; `Chip` → `ToggleButton`, from 0.3.0), `Mark.tsx` (→ `AppMark
  app="koremind"`/`Wordmark`), the token block of `globals.css` (keep `.koremind-md` and `.dot-pulse`).
- Replace: `Shell.tsx` + `Sidebar.tsx` → `AppShell` + `TopBar` + `Sidebar`: the chat list is a `SidebarNav` of
  `SidebarItem`s (keep the motion list animation inside if wanted), "New chat" as the sidebar `header`, and the
  sign-out row becomes `AccountMenu` in the top bar (Settings as a child item). `app/(app)/settings/page.tsx` →
  `SettingsLayout` with `onSelect` items (hash sections) and `header={<SaveBadge/>}`. `app/login/page.tsx` →
  `AuthScreen app="koremind"` (sso `onClick` = `beginSso`, password form only while `passwordLogin`, the "Change
  server" link as `footer`).
- DESIGN.md: keep chat, composer, model picker, notes/approvals and Android parity; point tokens, type, layout,
  copy and accessibility here.

### KoreCalendar (`qarasky/korecalendar`, web/)

- Delete: `Button.tsx` (`buttonClass(v, small)` → `buttonVariants({ variant, size })` or `Button`), `Field.tsx`
  (→ `Field` + `Input`), `Modal.tsx` (→ `Dialog`; the drawer variant → AppShell's drawer), `Menu.tsx`,
  `Popover.tsx` (→ `Popover`; anchor event popovers with `PopoverAnchor`), `Select.tsx` (→ `Select`; keep
  `TimezoneSelect.tsx` → `Combobox` with the zone list as `options`, offsets as `description`, regions as
  `keywords`), `Switch.tsx`, `Toast.tsx`,
  `ConfirmDialog.tsx`, `CopyButton.tsx`, `EmptyState.tsx` (→ `EmptyState` with `action`), `AuthCard.tsx`,
  `AuthForm.tsx`, `SsoButton.tsx` (→ `AuthScreen app="korecalendar"`), `Logo.tsx`/`wordmark.tsx` (→ `AppMark` /
  `Wordmark`), `icons.tsx` (→ lucide), the token block of `globals.css` (keep `--hour`, `--gutter` and grid CSS).
- Replace: `AppShell.tsx` frame → kore-ui `AppShell` (keep the app's providers around it); `TopBar.tsx` →
  `TopBar` children (Today, prev/next, title, `ViewSwitcher` as pill `Tabs`/`NavTabs`, search) + actions (New
  event, AppSwitcher, AccountMenu); `Sidebar.tsx`/`MobileNav.tsx` → `Sidebar` (mini month and calendar list are
  app content; the drawer comes from AppShell); `AccountMenu.tsx` → kore-ui `AccountMenu` (Settings and Keyboard
  shortcuts as child items); `settings/SettingsNav.tsx` + `settings/layout.tsx` → `SettingsLayout` with `href`
  items; `settings/Section.tsx` → `SettingsSection`.
- Visual changes: top bar 56 → 60px, sidebar 248 → 256px, panels gain a hairline, labels 14 → 13px, secondary
  buttons lose their fill.

### KoreMonitor / Flatline (`qarasky/flatline`, apps/web)

- Delete: `components/ui/*` (Badge, Button, Checkbox, Command → `CommandPalette`, ContextMenu, Dialog, DropdownMenu,
  Input, Label, NativeSelect, Popover, Separator, Sheet, Sidebar, Skeleton, Textarea, Tooltip → kore-ui
  equivalents; `Label` → `Field`; `Sheet` → kore-ui `Sheet`; `Separator` → a `border-t
  border-border` or `MenuSeparator`), `components/legacy-ui/*` (→ kore-ui), `lib/utils.ts` `cn` (→ kore-ui `cn`),
  the shadcn variable block and `@theme inline` mapping in `globals.css`, `tw-animate-css`, and the
  `@fontsource-variable/inter` import in `app/layout.tsx`. The command palette is kore-ui's `CommandPalette`.
- Replace: `app-sidebar.tsx` → `AppShell` + `Sidebar` (sections as `SidebarItem`s, the attention count as
  `trailing`, search as a TopBar button with `<Kbd>⌘K</Kbd>`; `collapsible` replaces `collapsible="icon"`, with
  the app reading/writing its `sidebar_state` cookie through `sidebarCollapsed`/`onSidebarCollapsedChange`, and
  ⌘B, if kept, calling the same setter); its footer user dropdown → `AccountMenu` in the top
  bar; `page-header.tsx` → `PageHeader` with `breadcrumbs`; `sign-in-form.tsx` → `AuthScreen app="flatline"`
  (token sign-in and first-account setup go in `children`); status dots → `StatusDot`.
- Class renames across the app: `bg-background` → `bg-bg`, `bg-card`/`bg-sidebar`/`bg-muted` → `bg-surface`,
  `bg-popover`/`bg-secondary`/`bg-accent` (shadcn hover) → `bg-raised`, `text-foreground` → `text-text`,
  `text-muted-foreground` → `text-muted`, `bg-primary`/`text-primary` → `bg-accent`/`text-accent`,
  `text-destructive` → `text-danger`, `ok`/`warn`/`bad`/`maint` → `status-up`/`status-warn`/`status-down`/
  `status-maint`, `rounded-md` → `rounded-ui`. The board CSS keeps its own variables but reads kore-ui's.
- Visual changes: base text 14 → 15px, controls 32 → 40px (shadcn `h-9` at a 14px root), menu items ~28 →
  40px.

### Upgrading to 0.2.0: local workarounds to delete

0.2.0 is additive except toasts (no swipe-to-dismiss; F8 still focuses them) and an optional `accountUrl`.

- **Kore:** delete `components/PointMenu.tsx` → `PointMenu` (same idea: `point`, `label`, `onClose(reason)`; use
  `pointFromEvent` for the row's keyboard position) or a `ContextMenu` around the row; delete
  `components/PasswordInput.tsx` → `PasswordInput` (`current` → default, otherwise `newPassword`; the strength hints
  → `rules`; keep the "Generate" button as an app-side Button next to it); drop the workaround that passed a
  dummy/hidden account link to AccountMenu when Kore ID is off.
- **KoreMind:** first-account setup on the login page → `AuthScreen mode="set-password"` (new-password
  autocomplete, `rules` for the length hint) instead of the local Field; AccountMenu without `accountUrl` when the
  server has SSO off.
- **KoreCalendar:** delete `components/ColorPicker.tsx` → `ColorSwatchPicker colors={CALENDAR_COLORS}
  allowCustom`; in `CalendarList.tsx` the hand-drawn coloured checkboxes → `Checkbox color={calendar.color}`;
  AccountMenu without `accountUrl` when SSO is off.
- **KoreMonitor / Flatline:** delete `components/ui/command.tsx` and the cmdk markup in `command-palette.tsx` →
  `CommandPalette` with `groups` built by `buildCommands` (the `OPEN_PALETTE_EVENT` button can set `open`);
  `monitors/peek-panel.tsx`'s Dialog pinned to the edge → `Sheet` + `SheetContent title="Monitor details"
  hideTitle size="lg"` (keep the wide-screen `<aside>`); `superboard/server-menu.tsx`'s zero-size Menu anchor →
  `PointMenu` with `pointFromEvent`; `monitors/status-dot.tsx`'s `muted` class override and ignored `size` →
  `StatusDot muted size`, and drop the local `--status-muted` colour for `status-down-muted`; drop the
  `cmdk` dependency (kore-ui brings it).

### Upgrading to 0.3.0: local workarounds to delete

0.3.0 is additive. Two visible changes: interactive table rows and nav items use `hover-subtle` (4%) and the
command palette's highlighted row uses `hover` (5%), and `theme.css` is `@theme static` (more CSS variables, no
removed ones). Replace every hand-written `white/5`, `white/10`, `text-white` on accent and raw z-index with the
tokens (`bg-hover`, `bg-active`, `bg-track`, `text-on-accent`, `z-(--z-toast)`).

- **Kore ID:** bump from 0.1.0 (read "Upgrading to 0.2.0" too: toasts no longer block clicks or take Escape from
  dialogs); the set-password and change-password forms → `PasswordInput` / `AuthScreen mode="set-password"`;
  `admin/parts.tsx` stat tile → `Stat`; the three hand-built skeleton row blocks → `TableSkeleton`; the sessions
  list → `CardList` + `ListRow`; `lib/format.ts` `formatTime` / `formatTimeInline` / `fullTime` → `Time` /
  `formatRelativeTime` (`inline`); the read-only secret/link field in `admin/parts.tsx` → `CopyField`; the client
  endpoints in `AppsPage` → `DescriptionList`; the bordered app icon tile → `AppTile` (it also shows unknown apps);
  the Users/Activity filter rows → `FilterBar`; `Loading` in `lib/Shell.tsx` → `LoadingState`.
- **KoreMind:** `ToggleChip.tsx` → `ToggleButton`; `InlineError.tsx` and the settings `SaveBadge` → `InlineMessage`
  and `SaveStatus`; the `Card className="border-warning/40 p-4"` warning cards → `Alert tone="warning"`; the
  settings Account/Memory/Models rows → `CardList` + `ListRow`; the stat tile in `RichCard.tsx` → `Stat` (drops
  the off-scale `1.75rem`); the settings page's scroll-the-pill effect → delete (`SettingsLayout` does it); the
  raw sidebar empty `<li>` → `SidebarNav empty`; the AccountMenu "Settings" row → `MenuItem asChild icon`; the
  composer keeps its own wrapper but its auto-growing textarea → `Textarea autoGrow`; `themeColor` and the QR
  colours → `KORE_THEMES` / `KORE_THEME_COLOR`. The Memory rows (inline edit, long text) → `ListRow` with `children`
  (and `wrap`); the stat card "info" tone → `Stat tone="accent"`; the animated inline error → `InlineMessage animated`;
  `TONE_PILL` → `Badge size="md"`; the code block with its own copy button → `CodeBlock`. Its DESIGN.md no longer says it adds
  no components of its own: list what stays local (model picker, composer, markdown styles).
- **KoreCalendar:** `lib/colors.ts` `calendarTint` → `tintOf` and its own `isHexColor` → kore-ui's; the duration
  and ease constants of `lib/motion.ts` → `koreDuration` / `koreEase` (keep the springs and stagger); the nine
  `hover:bg-white/5` → `hover:bg-hover`; `RecurrenceEditor` weekday chips → `ToggleGroup type="multiple"
  shape="round"`; the hand-built link row in `AccountMenu.tsx` → `MenuItem asChild icon`; `text-white` on accent
  → `text-on-accent`; `themeColor` and the manifest → `KORE_THEME_COLOR`; `calendar/[view]/loading.tsx` → `Skeleton`
  instead of `animate-pulse bg-raised`; the default colour `#5b8def` repeated five times → one constant; the
  `koreDuration.pop`/`dialog` stand-ins for its 0.16s "enter" and 0.2s "view" → `koreDuration.fade.in` and
  `koreDuration.view`; event time text → `tintOf(color).text` (it stays readable in Light); the `Checkbox` layout
  hack in `CalendarList.tsx` → `Checkbox truncate`; the hand-built colour chips → `ColorDot`.
- **KoreMonitor / Flatline:** every `<p role="alert" className="text-meta text-danger">` → `InlineMessage`;
  `paused-banner.tsx` and the superboard strip → `Alert banner`; the filter chips and the time-range buttons →
  `ToggleButton` / `ToggleGroup type="single" joined`; the local `--color-status-critical` → the kore-ui token
  (delete the definition); the chart series hex values → `var(--color-chart-1)` … `-4`; copied z-index numbers →
  `z-(--z-…)`; `bg-white/5`, `border-white/10`, `bg-white/10` → `bg-hover`, `border-border`, `bg-active`/`bg-track`;
  `KORE_NAMES` in `lib/kore.ts` → delete (kore-ui names the app); `monitors/status-dot.tsx` → keep only the
  status mapping; the fleet `UsageBar` and `.fleet-meter-*` → `Meter size="sm" thresholds={{ critical }}`; the floating
  `selection-bar.tsx` → `SelectionBar`; the heartbeat tooltip → `PointTooltip`; the TopBar search-field button →
  `SearchButton`; the cookie write and ⌘B handler in `app-shell.tsx` → `collapseShortcut="b"` with the one
  `onSidebarCollapsedChange` (the cookie stays the app's); `BoardSkeleton` → `Skeleton pulse={false}`.

### Kore ID (`qarasky/kore-id`, web/)

Built on kore-ui from the start (Vite: `@tailwindcss/vite`, the CSS above, `KoreProvider` with the router's link).
`/login`, `/setup/:token`, no-access and logout-confirm are `AuthScreen app="kore-id"`; `/account` is
`AppShell` + `SettingsLayout` (Profile, Security, Your apps with `AppGrid`); `/admin` is `AppShell` with an admin
`Sidebar`, `PageHeader`, `Table` with sortable heads and row `Menu`s, "Add user" `Dialog` showing the setup link
with `CopyButton`, user detail with underline `Tabs`.
