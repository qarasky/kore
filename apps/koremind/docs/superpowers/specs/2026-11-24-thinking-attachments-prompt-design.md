# Thinking control, attachments and prompt (short design)

Size: a small change per part, six parts in one pass. Web and Android change together (AGENTS.md: 1:1), each with tests.

## Why

- The thinking-level row in the model picker jumps up and down because the sheet is as tall as its model list.
- On Android a photo can't be taken from the app, a photo being uploaded is invisible (and Send isn't blocked, so it can be dropped silently), and the "+" menu has no icons.
- The assistant doesn't treat notes as its own working space, doesn't seem to use memory details, and avoids rich formatting unless asked.

## Goals / non-goals

Goals: stable picker; a separate thinking control; visible attachments from the first moment; a camera shortcut; a prompt that uses notes, memory and formatting on its own.
Non-goals: no new backend endpoints or schema; no change to what memory stores; the memory profile stays abstract (nothing sensitive is added to the chat start).

## Approaches considered

- Thinking level: (a) keep it in the picker with a fixed-height list; (b) a separate control next to the model chip. **Chosen (b)**, as asked: less crowding, no jump possible.
- Memory: (A) load the saved facts into every chat start; (B) keep the abstract profile and make the prompt require `recall_memory`. **Chosen (B)**: facts are not sent to the provider unless the model asks for them.

## Design

1. **Thinking control.** A gauge (speedometer) icon button right of the model chip. Hidden when the model has no levels. It shows the current level as a tooltip/label and opens a small popover (web) or bottom sheet (Android) holding the slider: a track with one stop per option (Default, then the model's levels), the current level named above it ("High effort"), tap or drag to change. The model picker loses its thinking row, so its height no longer depends on anything but its list; it gets a fixed list height too.
2. **Attachment previews.** Attachments are added to the composer the moment they are picked, with a state (uploading, ready, failed). They sit above the text in a horizontally scrolling row: images as ~64 px thumbnails (from the local file, so they appear instantly), other files as an icon card with the name. An uploading item shows a spinner over it, a failed one shows an error mark with Retry/Remove. Send is disabled while anything is uploading (Android had no such check).
3. **Take photo.** Android: "Take photo" in the "+" menu via the system camera (`TakePicture` into app cache through a FileProvider); no CAMERA permission. Web: the same menu entry uses `<input capture="environment">`, so phones open the camera and desktops open the file picker.
4. **"+" menu icons.** Photo library, Take photo, File, each with an icon. Web uses lucide (Image, Camera, Paperclip); Android gets matching small vector drawables, since only `material-icons-core` is a dependency. The web paperclip becomes the same three-item menu.
5. **Prompt: notes.** Describe notes as the assistant's own working space, generically: when a task will outlast the context or needs facts held steady (multi-step research, a plan being built, a story or game state, anything it would otherwise lose), save and update notes and read them back at the start of later turns, without being asked or announcing it. Mention that the tools are `save_note`, `read_notes`, `edit_note` and that notes are per chat.
6. **Prompt: formatting.** Replace "no decoration" and the card restrictions with a catalogue of what the clients draw: headings, bold/italic, bullet and numbered lists, tables, code blocks with Copy, quotes, links, https images, and cards (stats, table, bars, note), each with when to use it. Use them freely when they make the answer easier to scan; plain prose stays right for chat and short answers.
7. **Prompt: memory (B).** Require `recall_memory` before answering anything that touches the user's own projects, setup, preferences, plans or history, and when a name or detail seems to be missing, instead of guessing. Drop "never bring it up on your own" in favour of "use what you know when it helps; don't recite it".

## Calls I made (change any of these)

- Slider stops include Default as the first stop.
- Popover on web, bottom sheet on Android, for the slider.
- Vector drawables on Android instead of adding `material-icons-extended`.
- Prompt wording is checked by unit tests (the sections exist, the tool names match `backend/src/mcp.ts`), and by a few live replies if an engine is configured here; I can't prove the model's behaviour from tests alone.

## Left to the builder

Exact dp/px sizes, animation timings (reuse `LocalMotion` and `spring`), the string wording in both string files, and test layout.
