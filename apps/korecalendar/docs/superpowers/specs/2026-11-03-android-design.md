# KoreCalendar: Android app

> Status: approved (2026-11-03). Stage 1 (foundation, agenda, widget, first signed release) is implemented by [../plans/2026-11-03-android-stage1.md](../plans/2026-11-03-android-stage1.md); stages 2 to 4 are not started. User docs: [../../android.md](../../android.md). Overall design: [2026-11-02-korecalendar-design.md](2026-11-02-korecalendar-design.md) (its "Android" section is superseded by this document). Release mechanics so far: [../../releasing.md](../../releasing.md).

Calls marked **(my call)** were made by the designer, not the owner. The owner's decisions are listed first.

## What the owner asked for

- The phone app exists mainly for **widgets** and for **checking the calendar quickly**.
- The first widget is an **Agenda widget**, in the style of the web app's Agenda view, tall enough for **about three events**. It lists *all* events (every calendar, repeating events expanded). If nothing is left today it shows tomorrow's, or whenever the next event is. It starts from *now*, not from midnight.
- **Full editing**, "the same as Proton Calendar or Google Calendar": create, change, delete, repeating events, reminders.
- **Reading works offline; editing needs the server** (queued offline edits are explicitly a later piece, not part of this design).
- Released as a **signed APK** on GitHub, from CI, "properly versioned and tagged". The four signing secrets already exist as repository secrets: `KORECAL_KEYSTORE_BASE64`, `KORECAL_KEYSTORE_PASSWORD`, `KORECAL_KEY_ALIAS`, `KORECAL_KEY_PASSWORD`.
- Device: **Nothing Phone (4a), Android 16**. Native Kotlin + Jetpack Compose, dark only, no Google dependencies (from the overall design).

## Why

The API is the product and the web app already does everything. What a phone adds is what a browser tab cannot: a glanceable list on the home screen, reminders that fire as alarms even when the server is unreachable, and a small fast app for "what is next?". Everything else (heavy editing, import, user admin) is more comfortable on a big screen, but the owner still wants to be able to edit from the phone, so the app is a complete calendar client, built in the order that delivers the glance first.

## Goals

1. The Agenda widget is correct and always instant: it draws from the phone's own copy, never waits for the network.
2. The app opens on the same agenda, full screen, in well under a second, offline or online.
3. Every edit the web app can make to an event, the app can make, with the same repeat-scope choices and the same safety (no lost typing, no double create, no overwriting someone else's change).
4. Reminders fire on time as Android alarms, from the local copy, with no push service.
5. A release is one tag away and cannot be published unsigned, unsigned-by-the-wrong-key, or with a version Android would refuse to install over the previous one.

## Non-goals and anti-goals

Not in this design: offline *editing* (queue and sync); Play Store or F-Droid; tablets, foldables and Wear layouts; a light theme; languages other than English; import, export, user administration and token management on the phone (use the web app); CalDAV on the phone (the app is its own client); push services or any Google dependency; widgets other than the Agenda widget (more can follow); sharing, invitations, attendees.

Would make it a failure even if it technically works:

- Losing what the person typed when a save fails.
- A reminder that silently does not fire (denied permission, battery policy, a reboot) with no sign anywhere in the app.
- A widget that shows stale data as if it were current, or events that ended hours ago.
- The account password stored on the device.
- Sending credentials to a plain-`http://` server without having said so.
- Showing a time that is an hour wrong around a daylight-saving change.

## Constraints

- Android 16 (API 36) on the owner's phone. **minSdk 33 (Android 13), compile/target 36 (my call):** the owner is the only known user; 13 is where `POST_NOTIFICATIONS` and the calendar-app exact-alarm permission (`USE_EXACT_ALARM`) are simple, and it covers nearly every phone in use. The builder may lower it if a lower floor costs nothing.
- Use only the public API (`docs/openapi.yaml`). **No server change is required by this design;** if the builder finds one is needed, it goes through the normal API rules (documented, tested, OpenAPI).
- No external resource is loaded by the app except the user's server and the one optional update check below.
- Every user-visible string lives in one resources file (`strings.xml`), as in the web app's `en.ts`.
- The repo layout is `android/` next to `api/` and `web/` (from the overall design). Package and application id: `dev.qarasky.korecalendar` **(my call)**. Name in the launcher: "Calendar".
- Toolchain follows the owner's Zero app (`~/.t3/projects/zero/android`): Gradle with a version catalogue, Kotlin, Compose BOM, OkHttp, kotlinx.serialization, coroutines, JDK 21 in CI. The builder checks current versions rather than copying Zero's.

## How it works

### Connecting (my call)

First run asks for the **server address** and **email and password**. The app signs in, and then **creates its own named access token** ("Android, <phone model>") through `POST /api/tokens`, stores *only that token* (in encrypted storage, Android Keystore-backed), and discards the session. Consequences: the password is never kept; the token does not expire; it can be revoked from the web app (Settings, Access tokens) without touching other devices; a phone that is lost is one click away from being cut off. If the token is ever rejected (revoked), the app says so and returns to sign-in, keeping its local copy until the next successful sign-in to the same account.

A plain `http://` address (LAN, Tailscale) is allowed, because that is how most installs run, and the app **says so plainly** at sign-in and in Settings. A mismatched account on re-sign-in empties the local copy.

### The local copy and sync (my call on the numbers)

- The phone keeps **calendars, events (the series definitions) and a window of server-expanded occurrences**: from 14 days back to **60 days ahead** by default. Recurrence is *never* computed on the phone: occurrences come from `GET /api/occurrences`, which already applies exclusions, changed occurrences and daylight-saving rules.
- **Refresh** = ask `GET /api/changes?since=<cursor>` (the cursor is kept), and for anything that changed, or when the window moved, re-fetch the affected occurrences. First sync starts at `since=0`. Deleted ids come from the same feed.
- **When it refreshes:** when the app opens or returns to the foreground; after any edit the app itself makes; by a periodic background job about every **15 minutes** (Android decides the exact moment; this is a floor Android imposes, not a promise); when the phone's time zone or clock changes; and once after boot. A manual pull-to-refresh exists.
- **Offline:** everything above keeps showing what the phone has. The app shows a quiet "last updated …" when the copy is older than a few hours, and a clear offline state on write attempts (below).
- Calendars are not part of the changes feed, so every refresh also re-fetches `GET /api/calendars` (names, colours, deletions).
- The window slides forward on every refresh. If the next event is beyond the window, the Agenda widget and screen say "Nothing in the next 60 days".

### Time

Events are wall-clock times in their own zone on the server; occurrences carry `start_utc`/`end_utc`. Like the web app, the phone **shows times in the account's chosen time zone** from `GET /api/me` (Settings on the web), not in whatever zone the phone is currently in **(my call, for parity with the web app; revisit if travelling makes it annoying)**. Positions, groupings by day and "today" all use that zone.

### Screens

Built in this order (see Stages): sign-in; **Agenda** (home); event details; event editor; day, week and month views with the same view switcher idea as the web app; search; a calendars list with show/hide (a local choice, like the web app's hidden calendars); Settings (server, account, sign out, clock 12/24h, week start, update check, reminder status).

- **Agenda (home):** the web Agenda's structure at phone scale: day headings ("Today", "Tomorrow", "Fri 6 Nov"), rows with time range, title, calendar colour, all-day events first within their day; scrolls forward through the window; a Today button; a floating "new event" button.
- **Hidden calendars (my call):** the calendars list lets the person hide a calendar. Hiding is a *local display choice*, like the web app's: the calendar disappears from every screen **and from the widget** (which refreshes when the choice changes), and from the "Nothing in the next 60 days" test. It does **not** silence the calendar's reminders: hidden is not muted. (A per-calendar "no reminders on this phone" switch can follow if wanted.)
- **Event editor:** every field the web editor has: title, calendar, start and end (with the all-day switch and time zone), repeat (the same presets; a rule the editor cannot express is carried through untouched, as on the web), reminders (up to 20, same units), location, notes. Saving a repeating event asks **"this event / this and following events / all events"** exactly as the web app does, and tells the person which changed occurrences were reset when a series' time changes.
- **Delete** asks, then offers **Undo** (via the restore endpoint, valid for 30 days), as on the web.
- Visual language mirrors the web app: the same dark palette and tokens, the same colours per calendar, 48 dp touch targets, system font scaling honoured, TalkBack labels on every control. Motion follows the web motion rules: nothing longer than 250 ms, no bounce, and the system's "remove animations" setting is obeyed.

### Writing (online only)

Every write goes straight to the server with the same safety the web app has: `If-Match` with the event's version (a lost race becomes a clear "this event changed, reload?" prompt, never a silent overwrite), an `Idempotency-Key` on creates (so a retry after a dropped connection cannot create twice), and the API's error codes mapped to readable messages. If the server cannot be reached, **the editor stays open with everything the person typed** and says why; it can be retried or abandoned. After a successful write the app updates its copy from the response and refreshes the affected window, so the widget and screens agree at once.

### The Agenda widget (Jetpack Glance)

- A vertical list in the Agenda style: day heading when the day changes, then rows (time, title, colour dot); all-day events first within a day.
- **From now:** an event is listed until it ends. With fewer than three left today the list simply continues into tomorrow and later days, so it is never empty while an event exists inside the window. Resized taller, it shows more rows; the three-row height is the default size.
- Empty state: "Nothing in the next 60 days".
- Tap on a row opens that event in the app; tap on the heading area opens the Agenda.
- It reads only the local copy. It is refreshed after every sync and **when the first listed event ends** (so an ended event leaves the widget promptly rather than at the next 15-minute job). If the copy is stale (older than three hours) the widget shows a small "updated 5 h ago" line instead of looking current.
- Dark, with the app palette; large font settings do not break it (fewer rows, never clipped rows).

### Reminders (my call)

From the local occurrences, the app schedules **exact alarms** for each reminder of each upcoming occurrence (a bounded horizon, for example the next 7 days, rescheduled on every sync, edit, boot, time or zone change). A reminder shows a notification (title, time, location) that opens the event. The app declares `USE_EXACT_ALARM`, `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED`; if the notification permission is refused, or the system later restricts alarms or battery use, **Settings shows a "Reminders" status line saying what is wrong and how to fix it**, and the app shows it again when it notices. Known limit: an event added from another device a few minutes before it starts may remind late, because there is no push; opening the app syncs at once.

### Update check (my call)

Once a day while the app is used, it asks GitHub for the newest `android-v*` release of this public repository and shows "Version X is available" with a download link. It is the app's only request to any host other than the owner's server, it carries no identifier, and it has a switch in Settings (**on by default**; the owner may flip the default). Installing is done by the person from the downloaded APK; Android replaces the old app because both are signed with the same key.

## Releasing and CI (the owner asked for this explicitly)

- **Tags:** `android-vX.Y.Z` (and `android-vX.Y.Z-rc.N` for pre-releases) releases the app. Server tags `vX.Y.Z` do not trigger it and its tags do not trigger the server's `images` workflow (the filters already differ). Each product has its own GitHub release.
- **One source of version:** `android/version.properties` holds `versionName` and `versionCode`, written by a script (`scripts/release-android.sh X.Y.Z`, the sibling of `scripts/release.sh`, which also commits and creates the annotated tag). The tag is verified against the file in CI. `versionCode` is derived from the version so it **only ever increases, including from a pre-release to its final release**: for example `major*1_000_000 + minor*10_000 + patch*100 + 99` for a final release and a lower slot for `-rc.N` (the exact formula is left to the builder; the monotonic property is the requirement and has a unit test).
- **Pull requests touching `android/`:** Android lint, JVM unit tests and `assembleDebug`.
- **On the tag:** verify the tag matches `version.properties` and is on `main`; run the same checks; decode the keystore from the secrets into the runner's temp directory; build the **signed release APK**; check it with `apksigner verify` and compare the certificate's SHA-256 fingerprint against the one recorded in the repository, in `android/signing-fingerprint.txt` (so a wrong or missing key fails the release, never ships an APK signed by another key). **Recording it (my call):** a manually started workflow, "Android signing check", decodes the keystore from the secrets, confirms it holds the configured alias, and prints the certificate fingerprint (a fingerprint is public); the first commit of the app records that value. It publishes nothing and runs before the first tag, so the first release is not trust-on-first-use; name it `korecalendar-<version>.apk`; publish a **SHA-256 checksum** next to it; create the GitHub release (pre-release when the version has a suffix) with generated notes. Missing secrets fail the job with a clear message; there is no unsigned fallback in a release.
- The signing key is the only copy of the app's identity: the keystore must be **backed up by the owner** outside GitHub, which cannot show a secret again. Said in `docs/releasing.md`.
- `docs/releasing.md`, `AGENTS.md`, `README.md` and a new `docs/android.md` (install, first run, widget, reminders, updating, troubleshooting) are updated with the app, as for every other part of the project.

## Stages

Each stage ends with something the owner can install and use, and with all earlier tests still green.

1. **Foundation, agenda and widget.** Project, theme, sign-in and token creation, the local copy and sync, the Agenda screen (read-only), event details (read-only), the Agenda widget, Settings (server, account, sign out), the release pipeline and a first signed APK `android-v0.1.0`. *Done when:* a fresh install on the Nothing phone signs in to the owner's server, shows the agenda, the widget with three rows updates itself, airplane mode still shows both, and the APK from the GitHub release installs over a previous one.
2. **Editing.** Editor, repeat scopes, reminders field, delete and undo, conflict and offline-save handling. *Done when:* every create/edit/delete/scope case in `web/e2e/event-crud.spec.ts` and `recurring.spec.ts` has an Android equivalent that passes against the real API.
3. **Views.** Day, week, month, view switcher, calendars show/hide, search, drag-free equivalents of the web's quick create (tap on an empty slot).
4. **Reminders and polish.** Alarms, notification and permission status, boot/time-zone handling, the update check, TalkBack and large-font passes.

(Stage 1 includes only the *display* side of reminders; the alarms are stage 4. The owner may reorder stages 3 and 4.)

## Testing and acceptance

- **JVM unit tests** (fast, in CI on every PR) for everything that is logic: the widget's "from now, across days" selection, day grouping and "today" in the account's zone including daylight-saving days, the sync merge (changes feed, deletions, window sliding), version-code monotonicity, error-code mapping, the update-check comparison.
- **Contract tests against the real API (my call):** JVM tests that build the `korecalendar` binary (`go build ./cmd/korecalendar`, so the Android CI job installs Go), run `init` and `serve` on a free port with a temporary data directory, and drive the app's networking and storage layers through sign-in, token creation, sync and each write, so the app's idea of the API cannot drift from the real one. Stage 2's "an Android equivalent that passes against the real API" means exactly these tests, one per case in `event-crud.spec.ts` and `recurring.spec.ts`.
- **Emulator UI tests** for the screens and the widget's rendering, from stage 2 and kept to the key flows (sign-in, open the agenda, create, edit a series, delete and undo): a few that run on every PR rather than a copy of the whole contract suite. CI uses an Android emulator runner on Linux, reaching the server through `10.0.2.2`. The builder sets up the emulator images, since none are installed on the owner's Mac yet (the SDK there has no command-line tools either).
- **On the real phone:** the owner installs the debug or release APK over USB or from the release and runs a short manual list recorded in `docs/android.md` (widget on the home screen, airplane mode, reminder fires, tap-through).
- The existing Go, web and Playwright suites must stay green; the server images workflow must be unaffected by Android tags.

## Left to the builder

- Room vs another local store; dependency injection or none; navigation library; exact versions of everything.
- Exact sync window sizes and the alarm horizon, as long as the behaviour above holds.
- How the widget schedules its "first event ended" refresh within Android's rules.
- Icon: an adaptive icon generated from `assets/icon.svg` by a script, with the monochrome layer for themed icons.
- The wording of `docs/android.md` and of the app's strings.
