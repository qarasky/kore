# Thinking control, attachments and prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the thinking level its own gauge control, show attachments (with a camera shortcut and icons) from the moment they are picked, and make the assistant use notes, memory and rich formatting on its own, on web and Android.

**Architecture:** Pure, tested helpers hold the logic on both clients (`effort`, `pending-files`) with identical names and behaviour; the UI components only render them. Prompt changes live in `backend/src/engine/opencode.ts` and `backend/src/settings.ts` and are pinned by string assertions.

**Tech Stack:** Bun + TypeScript + Next/React + `@qarasky/kore-ui` + lucide-react (web); Kotlin + Jetpack Compose + Material 3 + Coil 3 (Android); bun test and JUnit.

**Spec:** `docs/superpowers/specs/2026-11-24-thinking-attachments-prompt-design.md`

## Global Constraints

- Web (`web/`) and Android (`android/`) stay 1:1: same features, wording and pure-helper names, each with tests; both string files updated (`web/lib/strings.ts`, `android/app/src/main/res/values/strings.xml`). (AGENTS.md)
- No new backend endpoints or schema; memory storage and the abstract profile are unchanged; no extra facts are put in the chat start.
- Android: no `CAMERA` permission; no `material-icons-extended` dependency (own vector drawables, drawn from the lucide path data in `web/node_modules/lucide-react/dist/esm/icons/`).
- Slider stops are `Default` first, then the model's `thinkingLevels`; label above it reads `"<Level> effort"` / `"Default effort"`.
- The gauge is hidden when the model has no thinking levels.
- Commit straight to `main` (no branches), one commit per task. Do not push and do not tag.
- Checks: `bun test backend shared web scripts`, `bunx --bun tsc --noEmit -p web`, `cd android && ./gradlew :app:testDebugUnitTest` (plus `:app:assembleDebug`). Run `bun install` once first (the installed kore-ui may be older than the locked v0.3.0).

## Review Focus

- A model with no levels, or a stored thinking level the newly chosen model doesn't offer: gauge hidden / slider sits on Default. (Task 2, Task 3 tests)
- Several photos picked at once finish out of order: the strip keeps pick order and each item updates in place. (Task 4, Task 5 tests)
- An upload fails or the user sends before it ends: Send stays disabled while uploading; a failed item is never sent and does not block sending text. (Task 4, Task 5 tests)
- The upload result arrives after the draft was cleared (chat switched, item removed): ignored, no crash, no ghost item. (Task 4, Task 5 tests)
- Camera cancelled or no camera app: nothing is added; "no camera" shows a message. (Task 5, manual check)
- Memory turned off by the user: the static prompt must not force `recall_memory`. (Task 1 test)

---

### Task 1: Prompt: notes, formatting, memory

**Files:**
- Modify: `backend/src/engine/opencode.ts:144-149` (`STYLE`, `RICH`, `TOOLS`), `backend/src/settings.ts:24`, `docs/rich-messages.md` (last paragraph)
- Test: `backend/test/engine.test.ts` (tests at ~185 and ~312-327), plus whichever test in `backend/test/` asserts the old `buildSystem` wording (find it with `grep -rn "never bring it up" backend/test`)

**Interfaces:**
- Consumes: none.
- Produces: `AGENT_SYSTEM` (unchanged export) containing the phrases below.

- [ ] **Step 1: Write failing tests** in `backend/test/engine.test.ts`, replacing the card/style assertions that the new wording contradicts. Assert `AGENT_SYSTEM` contains: `"working space"`, `"without being asked"`, `"multi-step"`, `"read_notes"`, `"recall_memory before"`, `"unless memory is turned off"`, `"instead of guessing"`, `"Never say you cannot remember"`, `"headings"`, `"numbered lists"`, `"tables"`, `"code blocks"`, `"quotes"`, `"a fenced block tagged card"`, `"\"type\": \"stats\""`, `"Valid JSON only"`, `"at most two per reply"`, `"never for a single fact"`, `"a greeting or a casual remark gets a sentence or two of plain prose, never a list"`, `"without waiting to be asked"`; and does **not** contain `"no decoration"`, `"never for ordinary answers"` or `"Use Markdown only where it helps reading"`. Add one assertion in the settings test that the memory lines no longer contain `"never bring it up on your own"` but do contain `"don't recite"`.
- [ ] **Step 2: Run** `bun test backend/test/engine.test.ts` → the new assertions FAIL.
- [ ] **Step 3: Rewrite the three constants.**
  - `STYLE`: keep every existing rule except the last sentence (Markdown only where it helps / no decoration); keep the greeting rule.
  - `RICH`: open with a catalogue of what the clients draw: headings, bold and italic, bullet and numbered lists, tables, code blocks (with a Copy button), quotes, links, https images (same image-address rule as today) and cards (same JSON format text as today). For each, one line on when it fits (headings for long answers with parts, tables for comparisons, numbered lists for steps, code blocks for any code or config, a card for a status or total with a breakdown). State: use them whenever they make an answer easier to scan, without waiting to be asked; chat, greetings and short answers stay plain prose. Keep "at most two per reply", "never for a single fact", "put the explanation in normal text outside the block", "A plain comparison is a Markdown table, not a card".
  - `TOOLS`: describe notes as the assistant's own working space, generic and per chat: for work that outlasts what it can hold in mind or must stay exact (multi-step research, a plan or draft built over turns, any state it would otherwise lose), save and update notes and read them back at the start of later turns, without being asked or announcing it; also when the user asks for something written down. Keep the cross-chat approval sentence and "Never mention or try other tools". Memory: call `recall_memory before` answering anything about the user's own projects, setup, preferences, plans or history, and whenever a detail about them seems missing, instead of guessing, unless memory is turned off; keep "save it with remember without announcing it" and "Never say you cannot remember things between chats".
- [ ] **Step 4: In `buildSystem`** (`settings.ts:24`) replace the "never bring it up on your own" line with: use what you know when it helps with what they ask; don't recite it, and don't bring it up in reply to a greeting. Update `docs/rich-messages.md`'s last paragraph to say the prompt now lists all blocks and invites their use.
- [ ] **Step 5: Run** `bun test backend` → PASS.
- [ ] **Step 6: Commit** `feat(prompt): notes as a working space, a block catalogue, recall before answering`.

---

### Task 2: Web: thinking gauge

**Files:**
- Create: `web/lib/effort.ts`, `web/components/EffortControl.tsx`, `web/__tests__/effort.test.ts`
- Modify: `web/components/ModelPicker.tsx` (drop the thinking row and the level suffix on the chip; `ul` gets a fixed `h-72`), `web/components/Composer.tsx` (render `<EffortControl />` right after `<ModelPicker />`), `web/lib/strings.ts`

**Interfaces:**
- Produces in `web/lib/effort.ts`:
  `effortStops(levels: string[]): (string | undefined)[]` (Default first),
  `effortIndex(levels: string[], thinking: string | undefined): number` (unknown level → 0),
  `effortAt(levels: string[], index: number): string | undefined` (index clamped to the stops),
  `effortLabel(thinking: string | undefined): string` (`"High effort"` / `"Default effort"`).
- Strings: `effortDefault: "Default effort"`, `effortOf: (level: string) => string`.

- [ ] **Step 1: Write failing tests** in `web/__tests__/effort.test.ts`: `effortStops(["low","high"])` equals `[undefined,"low","high"]`; `effortStops([])` equals `[undefined]`; `effortIndex(["low","high"],"high")` is 2; `effortIndex(["low","high"],"xhigh")` is 0 and `effortIndex(["low"],undefined)` is 0; `effortAt(["low","high"],9)` is `"high"` and `effortAt(["low"],-3)` is `undefined`; `effortLabel("high")` is `"High effort"`, `effortLabel(undefined)` is `"Default effort"`.
- [ ] **Step 2: Run** `bun test web/__tests__/effort.test.ts` → FAIL.
- [ ] **Step 3: Implement** the four functions (reuse `thinkingLabel` from `model-picker.ts`) and the two strings.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Implement `EffortControl()`**: reads `providers`, `choice`, `setThinking` from `useModelChoice()`; returns `null` when the model has no levels; otherwise a kore-ui `Popover` (`side="top" align="start"`) whose trigger is a ghost `IconButton` with the lucide `Gauge` icon (label `t.thinkingLevel` plus the current `effortLabel`; accent colour when a level is set). The content holds the `effortLabel` text and a native `<input type="range" min=0 max={stops-1} step=1>` bound to `effortIndex`, `aria-valuetext` the label, one dot per stop under the track; `onChange` calls `setThinking(effortAt(...))`.
- [ ] **Step 6: Edit `ModelPicker`** as listed above and wire the Composer. Delete the now-unused `levels` code and `ToggleButton`/`thinkingDefault` usage; keep `chipLabel` for `aria-label`.
- [ ] **Step 7: Run** `bun test web` and `bunx --bun tsc --noEmit -p web` → PASS.
- [ ] **Step 8: Commit** `feat(web): thinking level on its own gauge control, model list keeps a fixed height`.

---

### Task 3: Android: thinking gauge

**Files:**
- Create: `android/app/src/main/java/dev/qarasky/koremind/ui/model/Effort.kt`, `.../ui/model/EffortSheet.kt`, `android/app/src/main/res/drawable/ic_gauge.xml`, `android/app/src/test/java/dev/qarasky/koremind/EffortTest.kt`
- Modify: `.../ui/model/ModelSheet.kt` (remove the thinking block and the `onThinking` parameter; content `Row` gets a fixed `height(380.dp)` instead of `heightIn`, the list `weight(1f)`), `.../ui/chat/ChatScreen.kt` (Composer: gauge `IconButton` after the model chip, shows `EffortSheet`), `res/values/strings.xml`

**Interfaces:**
- Produces in `Effort.kt` (package `dev.qarasky.koremind.ui.model`): `effortStops(levels: List<String>): List<String?>`, `effortIndex(levels: List<String>, thinking: String?): Int`, `effortAt(levels: List<String>, index: Int): String?`, `@Composable fun effortLabel(thinking: String?): String` (`"High effort"` / `"Default effort"`) using the string resources `effort_default` and `effort_of` (`%1$s effort`).
- `@Composable fun EffortSheet(levels: List<String>, thinking: String?, onThinking: (String?) -> Unit, onDismiss: () -> Unit)`.

- [ ] **Step 1: Write failing tests** in `EffortTest.kt` mirroring Task 2's assertions for `effortStops`, `effortIndex` (incl. unknown level → 0) and `effortAt` (clamped).
- [ ] **Step 2: Run** `cd android && ./gradlew :app:testDebugUnitTest --tests '*EffortTest'` → FAIL (does not compile).
- [ ] **Step 3: Implement** `Effort.kt` and the two strings (`effort_default`, `effort_of`; `thinking_default` and its use go away).
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Implement `EffortSheet`** as a small `ModalBottomSheet` (same colours as `ModelSheet`): the label above, a Material 3 `Slider(value = index.toFloat(), valueRange = 0f..(stops-1).toFloat(), steps = stops - 2)` (no `steps` when stops ≤ 2), `onValueChange` rounds to an index and calls `onThinking(effortAt(...))`; tick dots come from `steps`. Draw `ic_gauge.xml` from lucide's `gauge.js`.
- [ ] **Step 6: Edit `ModelSheet` and `Composer`** as listed; the gauge shows only when `currentModel.thinkingLevels` is not empty and is tinted `KoreMindColors.Accent` when `choice.thinking != null`, else `Muted`; stop showing the level text after the model name. Update the `ModelSheet(...)` call and parameter list.
- [ ] **Step 7: Run** `./gradlew :app:testDebugUnitTest :app:assembleDebug` → PASS.
- [ ] **Step 8: Commit** `feat(android): thinking level on its own gauge control, model sheet keeps a fixed height`.

---

### Task 4: Web: attachment previews, camera, menu

**Files:**
- Create: `web/lib/pending-files.ts`, `web/__tests__/pending-files.test.ts`, `web/components/AttachmentStrip.tsx`, `web/components/AttachMenu.tsx`
- Modify: `web/components/Composer.tsx`, `web/lib/strings.ts`

**Interfaces:**
- Produces in `pending-files.ts`:
  `type PendingFile = { key: string; name: string; mime: string; size: number; state: "uploading" | "ready" | "failed"; attachment?: Attachment; error?: string; preview?: string; file?: File }`,
  `addUploading(list: PendingFile[], f: Omit<PendingFile, "state">): PendingFile[]`,
  `markReady(list, key: string, attachment: Attachment): PendingFile[]`,
  `markFailed(list, key: string, error: string): PendingFile[]`,
  `retrying(list, key: string): PendingFile[]`,
  `removePending(list, key: string): PendingFile[]`,
  `readyAttachments(list): Attachment[]`, `uploadingCount(list): number`.
  Every function returns the list unchanged when `key` is absent.
- Strings: `attachPhoto: "Photo library"`, `takePhoto: "Take photo"`, `attachFile: "File"`, `uploading: "Uploading"`, `uploadFailed: "Upload failed"`, `retry: "Retry"`, `removeFile: (name: string) => string`.

- [ ] **Step 1: Write failing tests** in `pending-files.test.ts`: add A, B, C as uploading; `markReady` B then C then A leaves the order A, B, C with the right states; `readyAttachments` lists only ready ones in pick order; `uploadingCount` counts only uploading; `markFailed` removes an item from both counts and `retrying` puts it back to uploading with `error` cleared; `markReady(list, "gone", att)` and `removePending(list, "gone")` return an equal list; `canSend({text:"hi",fileCount:0,uploading:0,...})` stays true when the only file failed, and false with `uploading: 1` (add this case to `chat-state.test.ts`).
- [ ] **Step 2: Run** `bun test web/__tests__/pending-files.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helpers and strings.
- [ ] **Step 4: Implement `AttachmentStrip({ files, onRemove, onRetry })`**: a horizontally scrolling row (`overflow-x-auto`, no wrap) of 64 px cards above the textarea. Images show `preview` as `object-cover`; other files show a `FileText` icon and the name. `uploading` puts a kore-ui `Spinner` over a dimmed card; `failed` shows an error mark with the error text as `title` and a Retry button; every card has a remove `IconButton` (`t.removeFile(name)`). Animate in/out with the existing `pop`/`spring`.
- [ ] **Step 5: Implement `AttachMenu({ onFiles })`**: kore-ui `Menu` opened by a `Plus` `IconButton` (label `t.attach`); items with icons `Image` (`t.attachPhoto`), `Camera` (`t.takePhoto`), `Paperclip` (`t.attachFile`) click three hidden `<input type="file">`: photos `accept="image/*" multiple`, camera `accept="image/*" capture="environment"`, files `accept="image/*,application/pdf,text/*,application/json" multiple`. Reset each input's value after use.
- [ ] **Step 6: Rework `Composer`**: state becomes `PendingFile[]`. On pick, each file over the limit still goes through `uploadSizeError` (shown as the notice, not added); every other file is added at once with `preview = URL.createObjectURL(file)` for images, then uploaded (`api.upload`), then `markReady` / `markFailed`. Retry re-runs the upload from the stored `file`. Revoke object URLs on remove, on send and on unmount. `canSend` gets `fileCount = readyAttachments(...).length` and `uploading = uploadingCount(...)`; `onSend` receives only ready attachments; `lacksVision` runs on ready ones. Replace the old chip row and paperclip with `AttachmentStrip` and `AttachMenu`.
- [ ] **Step 7: Run** `bun test web` and `bunx --bun tsc --noEmit -p web` → PASS.
- [ ] **Step 8: Commit** `feat(web): attachment previews while uploading, take photo, icons in the attach menu`.

---

### Task 5: Android: attachment previews, camera, menu icons

**Files:**
- Create: `.../ui/chat/PendingFiles.kt`, `.../ui/chat/AttachmentStrip.kt`, `android/app/src/main/res/xml/file_paths.xml`, `res/drawable/ic_camera.xml`, `ic_image.xml`, `ic_paperclip.xml`, `android/app/src/test/java/dev/qarasky/koremind/PendingFilesTest.kt`
- Modify: `.../ui/AppViewModel.kt` (`Pending` and `attach`/`removePending`/`send`/`newChat`), `.../ui/chat/ChatReducer.kt:102` (`canSend`), `.../ui/chat/ChatScreen.kt` (Composer), `AndroidManifest.xml`, `res/values/strings.xml`, `SendChecksTest.kt`

**Interfaces:**
- Produces in `PendingFiles.kt` (package `dev.qarasky.koremind.ui.chat`), mirroring Task 4 exactly: `enum class UploadState { Uploading, Ready, Failed }`, `data class PendingFile(val localId: String, val name: String, val mime: String, val uri: String, val state: UploadState, val attachment: Attachment? = null, val error: String? = null)` (the URI is a string so the helpers stay pure JVM), and `addUploading`, `markReady`, `markFailed`, `retrying`, `removePending`, `readyAttachments`, `uploadingCount` with the same semantics (absent id → list unchanged).
- Changes `canSend(text: String, fileCount: Int, uploading: Int, busy: Boolean, hasModel: Boolean): Boolean`.
- Strings: `attach_photo` → "Photo library", `take_photo` "Take photo", `uploading`, `upload_failed`, `retry`, `no_camera` "No camera app found".

- [ ] **Step 1: Write failing tests**: `PendingFilesTest` with the same cases as Task 4's `pending-files.test.ts`; in `SendChecksTest` update `canSend` to the new signature with the cases "text with `uploading = 1` is false", "text with only a failed file (`fileCount = 0, uploading = 0`) is true", "`fileCount = 1`, empty text is true".
- [ ] **Step 2: Run** `./gradlew :app:testDebugUnitTest` → FAIL (does not compile).
- [ ] **Step 3: Implement** `PendingFiles.kt`, the new `canSend` and the strings.
- [ ] **Step 4: Change the ViewModel**: `_pending` becomes `MutableStateFlow<List<PendingFile>>`. `attach(resolver, uri)` reads name, mime and size as today; an oversize file sets `_uploadError` and is not added; otherwise it adds an `Uploading` item at once, then reads and uploads on `Dispatchers.IO` and calls `markReady` or `markFailed(e.message ?: "Upload failed")`. Add `retry(resolver, localId)` (`retrying` then the same upload from `Uri.parse(uri)`). `send` uses `readyAttachments(_pending.value)` and clears the list; results arriving for an id no longer in the list are ignored by the helpers.
- [ ] **Step 5: Implement `AttachmentStrip`**: a `LazyRow` of 64 dp rounded cards above the text field. Images use Coil `AsyncImage(model = uri)`, `ContentScale.Crop`; other files an icon plus the name. `Uploading` draws a dim scrim with a `CircularProgressIndicator`; `Failed` draws an error mark with a Retry action; each card has a small remove button. Reuse `animateRow`.
- [ ] **Step 6: Menu and camera in `Composer`**: `DropdownMenu` items get `leadingIcon` (`ic_image`, `ic_camera`, `ic_paperclip`, tinted `KoreMindColors.Muted`) with `attach_photo`, `take_photo`, `attach_file`. Draw the three drawables from lucide's `image.js`, `camera.js`, `paperclip.js`. Camera: `rememberLauncherForActivityResult(ActivityResultContracts.TakePicture())` with a `rememberSaveable` target `Uri`; before launching, create `cacheDir/camera/IMG_<yyyyMMdd_HHmmss>.jpg` and get its URI from `FileProvider.getUriForFile(context, "${context.packageName}.files", file)`; on `true` call `vm.attach`, on `false` delete the file and add nothing; catch `ActivityNotFoundException` and show `no_camera` through `uploadError`. Manifest: a `<provider>` for `androidx.core.content.FileProvider` (`authorities="${applicationId}.files"`, `exported="false"`, `grantUriPermissions="true"`, paths from `@xml/file_paths` = `<cache-path name="camera" path="camera/"/>`) and `<queries>` for `android.media.action.IMAGE_CAPTURE`. Do not add `CAMERA`.
- [ ] **Step 7: Update `canSend` callers** in `ChatScreen.kt` with `readyAttachments(pending).size` and `uploadingCount(pending)`; the `lacksVision` check runs on ready attachments.
- [ ] **Step 8: Run** `./gradlew :app:testDebugUnitTest :app:assembleDebug` → PASS.
- [ ] **Step 9: Commit** `feat(android): attachment previews while uploading, take photo, icons in the attach menu`.

---

### Task 6: Whole-repo verification

**Files:** none new (fixes only); `docs/` if wording drifted.

- [ ] **Step 1: Run** `bun test backend shared web scripts`, `bunx --bun tsc --noEmit -p web`, `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug` → all PASS.
- [ ] **Step 2: Parity check:** the string keys, helper names and semantics added in Tasks 2 to 5 exist on both sides (grep both string files for `effort`, `takePhoto`/`take_photo`, `retry`).
- [ ] **Step 3: Live prompt check:** if a provider is connected locally (`opencode` auth list is not empty), run the dev server (`bun start`) and send three fresh-chat prompts through the API or the web app: a long multi-step research request (expect `save_note`), "what do you know about my projects" with memory on (expect `recall_memory`), and a comparison question (expect a table or heading). Report what the replies did. If nothing is connected, say plainly that the prompt's behaviour was not exercised against a model.
- [ ] **Step 4: Report** what was verified and what was not: the Android UI (jump gone, thumbnails, camera, icons) could not be viewed here and needs a look on a device or emulator; the web UI was typechecked and unit-tested only.
