# KoreCalendar Android, Stage 1 Implementation Plan (foundation, agenda, widget, first signed release)

> **Status:** executed and released as `android-v0.1.0` (2026-11-03). Kept as the record of what was planned; the code and `docs/android.md` are authoritative where they differ.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed Android app `android-v0.1.0` that signs in to the owner's server, keeps a local copy of the next 60 days, shows it as an Agenda screen and as a home-screen Agenda widget (about three rows), works offline for reading, and is built, signed and published by CI from a tag.

**Architecture:** One Gradle module `android/app` (Kotlin, Compose, Glance). Pure logic (URL rules, agenda/widget selection, sync, version codes) has no Android imports and is covered by JVM tests; `LocalStore` and `CalendarApi` are interfaces with a fake for tests and Room/OkHttp for the device. The app talks only to the public REST API; recurrence is never computed on the phone. JVM contract tests build and run the real Go server. Release pipeline mirrors the owner's Zero app: `version.properties`, a tag-triggered workflow, signature and fingerprint checks.

**Tech Stack:** Kotlin, Jetpack Compose, Glance (app widget), Room (KSP), WorkManager, OkHttp 5, kotlinx.serialization, coroutines; AGP 9.5.0, Kotlin 2.4.21, Gradle 9.8.1, JDK 21 (as in `~/.t3/projects/zero/android`); GitHub Actions; Go (for the contract tests).

**Spec:** `docs/superpowers/specs/2026-11-03-android-design.md` (approved 2026-11-03). Overall design: `docs/superpowers/specs/2026-11-02-korecalendar-design.md`. Project rules: `AGENTS.md`. API contract: `docs/openapi.yaml`, `docs/api.md`.

## Global Constraints

- Application id and package `dev.qarasky.korecalendar`; launcher name "Calendar"; `minSdk 33`, `compileSdk 37`, `targetSdk 36`; dark theme only; JDK 21.
- **No Google dependency** (no Play Services, no Firebase). The only hosts the app contacts are the owner's server and (stage 4) GitHub for the update check.
- The app uses only documented public endpoints. No server change in this stage; if one proves necessary, stop and treat it as a plan defect (ledger ruling, then API rules: documented, tested, OpenAPI).
- **Recurrence is never computed on the phone**; occurrences come from `GET /api/occurrences`. Times shown in the **account's time zone** (`GET /api/me` → `timezone`), not the phone's.
- Credentials: the password is used once to sign in and **never stored**; only the app-created access token is kept, encrypted with an Android Keystore key. `http://` servers are allowed and the UI says so plainly.
- Every user-visible string is in `res/values/strings.xml` (pure-logic functions take labels as parameters, never hard-code UI text).
- Palette equals the web tokens (`web/app/globals.css`: `--color-bg #16181d`, `surface #1d2026`, `raised #23262d`, `border #2c3038`, `border-strong #3a3f49`, `text #e6e8ee`, `muted #8a8f9a`, `accent #5b8def`, `danger #f2777a`, `warning #e5a54b`); a test pins parity. Motion: nothing longer than 250 ms, no bounce, system animation scale honoured. Touch targets 48 dp; TalkBack labels on every control.
- Sync window: 14 days back to 60 days ahead, day-aligned in UTC; occurrences fetched in 30-day chunks (the API caps a request at 400 days / 5000 occurrences); background job about every 15 minutes (a floor Android imposes).
- Hidden calendars are a local display choice: hidden from every screen and the widget; reminders (stage 4) are unaffected.
- TDD for behaviour: failing test first, watched failing. Commands: `cd android && ./gradlew --no-daemon testDebugUnitTest` (JVM), `./gradlew lintDebug assembleDebug`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Releases: tag `android-vX.Y.Z[-rc.N]`; signing secrets `KORECAL_KEYSTORE_BASE64`, `KORECAL_KEYSTORE_PASSWORD`, `KORECAL_KEY_ALIAS`, `KORECAL_KEY_PASSWORD` (repository secrets, already set); the signing certificate's SHA-256 is recorded in `android/signing-fingerprint.txt` and a release fails if the APK is signed by anything else.

## Review Focus

Failure modes the tasks' main tests do not cover by themselves; each has a test in the task named in brackets.

1. **Daylight-saving days and a phone zone different from the account zone:** an agenda/widget built on the day clocks change, and an all-day event, are on the right day and in the right order [Task 5].
2. **An event that spans midnight or several days, seen at "now":** listed once, under today when it started earlier, until it ends; a zero-length event does not vanish the instant it starts [Task 5].
3. **A sync that fails half-way** (network drops after the changes feed, a 5xx on a later chunk) leaves the previous copy and cursor untouched, so the next sync still sees the changes [Task 6].
4. **A revoked token (401) mid-sync:** reported as signed-out, the local copy stays readable until sign-in, and a sign-in to a *different* account empties it [Tasks 6, 8].
5. **Hidden calendars:** gone from the agenda, the widget and the "empty" decision [Task 5].
6. **Stale data:** the widget and the screen say how old the copy is once it is older than three hours, and say nothing when fresh [Tasks 5, 10, 11].
7. **Server address typing:** trailing slash, `/api` suffix, bare IP with port, uppercase scheme, whitespace, no scheme, userinfo, `ftp://` [Task 4].

## File structure (what each file is for)

```
android/
  settings.gradle.kts, build.gradle.kts, gradle.properties, gradle/ (wrapper + libs.versions.toml)
  version.properties            versionName / versionCode, written by scripts/release-android.sh
  signing-fingerprint.txt       SHA-256 of the release certificate
  app/build.gradle.kts, proguard (none), src/main/AndroidManifest.xml
  app/src/main/res/             values/strings.xml, colors.xml, themes.xml; xml/agenda_widget_info.xml; mipmap-anydpi-v26/ic_launcher.xml; drawable/ic_launcher_*.xml
  app/src/main/java/dev/qarasky/korecalendar/
    data/Models.kt              @Serializable API types
    data/Api.kt                 CalendarApi, HttpApi, ApiException, NetworkException
    data/ServerUrl.kt           normalizeServerUrl
    data/LocalStore.kt          LocalStore interface, Snapshot
    data/RoomStore.kt           AppDatabase + RoomStore
    data/Account.kt             Account, SecretBox, KeystoreSecretBox, AccountStore, Prefs
    data/SignIn.kt              signIn flow
    sync/SyncEngine.kt          SyncEngine, SyncResult
    sync/SyncWorker.kt          periodic WorkManager job
    agenda/Agenda.kt            pure agenda + widget selection + labels
    ui/theme/…, ui/*.kt         Compose screens, AppViewModel
    widget/AgendaWidget.kt      Glance widget, receiver, tick receiver, WidgetUpdater
  app/src/test/…                JVM tests (+ FakeStore, FakeApi, ServerHarness)
  app/src/androidTest/…         device tests (Task 14)
scripts/release-android.sh, scripts/test-android-version.sh
.github/workflows/android-ci.yml, android-release.yml, android-signing-check.yml
docs/android.md
```

---

### Task 1: Signing check workflow, and the certificate fingerprint

**Files:**
- Create: `.github/workflows/android-signing-check.yml`

**Interfaces:**
- Produces: a manually started workflow that prints the release certificate's SHA-256 and fails if the keystore or the alias is wrong. The fingerprint it prints goes into the ledger (Task 13 writes it to `android/signing-fingerprint.txt`).

This task ships on its own small pull request to `main`, because a `workflow_dispatch` workflow only runs once it is on the default branch.

- [ ] **Step 1:** Write the workflow: `on: workflow_dispatch`, `permissions: contents: read`; steps: decode `KORECAL_KEYSTORE_BASE64` to `$RUNNER_TEMP/release.jks`; run `keytool -list -v -keystore … -alias "$KORECAL_KEY_ALIAS" -storepass …`; fail with a clear message if any of the four secrets is empty or the alias is absent; print the line `SHA256:` of the certificate and set it as a step summary. Passwords go in via `env`, never on the command line of a logged step.
- [ ] **Step 2:** Lint: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest`. Expected: no output.
- [ ] **Step 3:** Branch `ci/android-signing-check`, commit, push, open a PR, merge it (`gh pr merge --rebase --delete-branch`), `git pull` on `main`.
- [ ] **Step 4:** `gh workflow run android-signing-check.yml`, watch it (`gh run watch`), read the fingerprint from its log (`gh run view --log`). Expected: success, one `SHA256:` fingerprint. Record it in the ledger as `Fingerprint: <value>`. If it fails because the alias or a secret is wrong, **stop and tell the owner** (a security-sensitive item).

---

### Task 2: Project skeleton, theme, palette parity

**Files:**
- Create: `android/` Gradle project (copy `gradlew`, `gradlew.bat`, `gradle/wrapper/*` from `~/.t3/projects/zero/android`), `android/settings.gradle.kts` (`rootProject.name = "korecalendar"`), `android/build.gradle.kts` (plugins AGP 9.5.0, Kotlin 2.4.21 compose + serialization, KSP matching Kotlin), `android/gradle.properties`, `android/version.properties` (`versionName=0.1.0`, `versionCode=<Task 3 formula for 0.1.0>`; write the literal `10099` for now and let Task 3's test confirm it), `android/app/build.gradle.kts`, `AndroidManifest.xml`, `res/values/{strings,colors,themes}.xml`, `MainActivity.kt`, `ui/theme/{Palette,Theme}.kt`
- Modify: `.gitignore` (`android/.gradle/`, `android/build/`, `android/app/build/`, `android/local.properties`, `*.jks`, `.worktrees/`)
- Test: `android/app/src/test/java/dev/qarasky/korecalendar/PaletteTest.kt`

**Interfaces:**
- Produces: `object Palette { val bg, surface, raised, border, borderStrong, text, muted, accent, danger, warning: Color }` (Compose `Color`, values as in Global Constraints); `@Composable fun KoreTheme(content)` (dark `MaterialTheme` from the palette); Gradle reads `version.properties` and the signing environment variables `KORECAL_KEYSTORE_FILE`, `KORECAL_KEYSTORE_PASSWORD`, `KORECAL_KEY_ALIAS`, `KORECAL_KEY_PASSWORD` (release is left unsigned when the file variable is unset, as in Zero).

- [ ] **Step 1: Write the failing test** `PaletteTest.matchesWebTokens`: read `../../web/app/globals.css` (working dir is `android/app`), extract every `--color-<name>: #xxxxxx;`, and assert each of the ten Palette colours equals its token (`bg`, `surface`, `raised`, `border`, `border-strong`→`borderStrong`, `text`, `muted`, `accent`, `danger`, `warning`). Also `PaletteTest.cssHasAllTokens` asserts none is missing.
- [ ] **Step 2:** Create the Gradle project so it compiles with the test but no `Palette` yet. Run `cd android && ./gradlew --no-daemon testDebugUnitTest`. Expected: FAIL (`Palette` unresolved / test fails).
- [ ] **Step 3: Implement** `Palette`, `KoreTheme`, a `MainActivity` that shows a themed placeholder text from `strings.xml`, the manifest (`INTERNET` permission, `usesCleartextTraffic="true"`, `allowBackup="false"`, launcher activity `.MainActivity`), `build.gradle.kts` as Zero's with the identifiers above, `minSdk 33`, `compileSdk 37`, `targetSdk 36`, `compose = true`, JVM 17 target, `testOptions.unitTests.isReturnDefaultValues = true`. Add the dependency set (versions: the newest stable compatible ones, checked on Maven; Zero's catalogue as the starting point): Compose BOM + material3, activity-compose, lifecycle-viewmodel/runtime-compose, OkHttp 5 + `mockwebserver` (test), kotlinx-serialization-json, coroutines-android + coroutines-test, junit 4.
- [ ] **Step 4:** `./gradlew --no-daemon testDebugUnitTest assembleDebug lintDebug`. Expected: PASS, a debug APK at `app/build/outputs/apk/debug/`.
- [ ] **Step 5: Commit** `android: Gradle project, dark theme, palette parity test`.

---

### Task 3: Version code, and `scripts/release-android.sh`

**Files:**
- Create: `scripts/release-android.sh`, `scripts/test-android-version.sh`
- Modify: `android/version.properties`

**Interfaces:**
- Produces: `scripts/release-android.sh X.Y.Z[-rc.N]` (like `scripts/release.sh`: main only, clean tree, equals `origin/main`, tag not existing; writes `android/version.properties`, commits `android release: vX.Y.Z`, creates the annotated tag `android-vX.Y.Z`, prints the push command; `--print-code X.Y.Z[-rc.N]` prints just the code). Formula: `major*1000000 + minor*10000 + patch*100 + slot`, `slot = 99` for a final release and `N` (1..98) for `-rc.N`, so `0.1.0` → `10099`, `1.0.0-rc.1` → `1000001`, `1.0.0` → `1000099`.

- [ ] **Step 1: Write the failing test** `scripts/test-android-version.sh` (plain bash, exits non-zero on failure): asserts `--print-code` gives `10099` for `0.1.0`, `1000001` for `1.0.0-rc.1`, `1000099` for `1.0.0`; that for this ordered list every code is strictly greater than the previous: `0.1.0 0.1.1 0.2.0-rc.1 0.2.0-rc.2 0.2.0 0.10.0 1.0.0-rc.1 1.0.0 1.0.1 1.2.3 2.0.0`; and that `abc`, `1.0`, `v1.0.0`, `1.0.0-beta`, `1.0.0-rc.0` and `1.0.0-rc.99` are rejected (exit non-zero, message on stderr).
- [ ] **Step 2:** Run `bash scripts/test-android-version.sh`. Expected: FAIL (script missing).
- [ ] **Step 3: Implement** the script (version regex `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.([1-9][0-9]?))?$`, minor and patch below 100, major below 2000). Release mode refuses a dirty tree, non-`main`, `main` ≠ `origin/main`, existing tag; it writes `versionName`/`versionCode` and commits only when the file changed.
- [ ] **Step 4:** `bash scripts/test-android-version.sh` and `shellcheck` via `docker run --rm -v "$PWD":/repo -w /repo koalaman/shellcheck:stable scripts/release-android.sh scripts/test-android-version.sh`. Expected: PASS, no findings. Also exercise release mode in a throwaway clone with a bare remote (as `scripts/release.sh` was tested): creates one commit and the tag; a second run is refused.
- [ ] **Step 5: Commit** `android: version code scheme and release script`.

---

### Task 4: Server address, API models, API client

**Files:**
- Create: `data/ServerUrl.kt`, `data/Models.kt`, `data/Api.kt`
- Test: `ServerUrlTest.kt`, `ModelsTest.kt`, `HttpApiTest.kt` (OkHttp `MockWebServer`)

**Interfaces:**
- Produces:
  - `data class ServerUrl(val base: String, val cleartext: Boolean)`; `fun normalizeServerUrl(input: String): ServerUrl?`.
  - `@Serializable` (`Json { ignoreUnknownKeys = true; explicitNulls = false }`): `User(id, email, role, timezone)`, `Session(token, user)`, `TokenCreated(id, name, token)`, `Calendar(id, name, color)`, `Reminder(minutesBefore ← "minutes_before")`, `Occurrence(eventId, calendarId, key, title, notes, location, start, end, tz, allDay, isRecurring, isOverride, startUtc, endUtc, reminders)` with snake-case `@SerialName`s, `startUtc`/`endUtc` as `kotlinx.datetime`-free `java.time.Instant` via a serializer, `Event(id, calendarId, version, deletedAt?)` (only what the feed needs), `ChangeSet(cursor: Long, upserted: List<Event>, deleted: List<String>, more: Boolean)`.
  - `interface CalendarApi { suspend fun login(email: String, password: String): Session; suspend fun createToken(name: String): TokenCreated; suspend fun logout(); suspend fun me(): User; suspend fun calendars(): List<Calendar>; suspend fun occurrences(from: Instant, to: Instant): List<Occurrence>; suspend fun changes(since: Long): ChangeSet }`.
  - `class HttpApi(base: ServerUrl, token: String?, client: OkHttpClient = default) : CalendarApi`; `class ApiException(val status: Int, val code: String, message: String) : Exception`; `class NetworkException(message: String, cause: Throwable?) : Exception`.

- [ ] **Step 1: Write failing tests.**
  - `ServerUrlTest`: `"https://cal.example.com/"` → base `https://cal.example.com`, cleartext false; `"HTTP://192.168.1.5:8080"` → `http://192.168.1.5:8080`, cleartext true; `"192.168.1.5:8080"`, `"localhost:8080"`, `"nas.local"`, `"nas"` → `http://…`; `"cal.example.com"` → `https://cal.example.com`; `"  https://cal.example.com/api  "` → `https://cal.example.com`; `"https://u:p@cal.example.com"`, `"ftp://x"`, `""`, `"http://"`, `"https://a b"` → null.
  - `ModelsTest`: decode a real `GET /api/occurrences` element and a `GET /api/changes` body copied from `docs/api.md` (unknown fields ignored, `reminders` optional/default empty).
  - `HttpApiTest`: `login` posts `{"email","password"}` to `/api/login` with no Authorization header and returns the session; authenticated calls send `Authorization: Bearer <token>`; `occurrences` sends `from`/`to` as RFC 3339 UTC; a `401` body `{"error":{"code":"unauthorized","message":"…"}}` throws `ApiException(401,"unauthorized",…)`; a `429` keeps its code; a dropped connection throws `NetworkException`; a non-JSON `502` body throws `ApiException(502,"bad_response",…)` rather than a parse crash.
- [ ] **Step 2:** Run `./gradlew --no-daemon testDebugUnitTest --tests '*ServerUrlTest' --tests '*ModelsTest' --tests '*HttpApiTest'`. Expected: FAIL (unresolved).
- [ ] **Step 3: Implement** the three files. `normalizeServerUrl`: trim; if it has no `://`, choose `http://` for IP literals, `localhost`, single-label names and names ending `.local`/`.lan`, else `https://`; only `http`/`https` (case-insensitive) accepted; reject userinfo, empty host and whitespace; drop a trailing `/` and a trailing `/api`. `HttpApi`: OkHttp blocking calls inside `withContext(Dispatchers.IO)`, 10 s connect and 30 s read timeouts, `User-Agent: KoreCalendar-Android/<versionName>`.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `android: server address rules, API models and client`.

---

### Task 5: Agenda and widget selection (pure)

**Files:**
- Create: `agenda/Agenda.kt`
- Test: `AgendaTest.kt`

**Interfaces:**
- Consumes: `Occurrence`, `Calendar` from Task 4.
- Produces:
  - `data class AgendaItem(val occ: Occurrence, val colorHex: String?, val startLocal: LocalDateTime, val endLocal: LocalDateTime, val endInstant: Instant)` (`endInstant` = `max(end_utc, start_utc + 1 min)`; for all-day events `end_utc`).
  - `data class AgendaDay(val date: LocalDate, val items: List<AgendaItem>)`.
  - `fun buildAgenda(occurrences: List<Occurrence>, calendars: List<Calendar>, hidden: Set<String>, zone: ZoneId, now: Instant, onlyUpcoming: Boolean): List<AgendaDay>` — dates by the item's start in `zone` (all-day: the date in `start`); an item that started before the first day shown (today, or the day of `now`) is listed under that first day; `onlyUpcoming` drops items whose `endInstant <= now`; hidden calendars removed; days without items omitted; within a day all-day first, then by start, end, title.
  - `data class Labels(val today: String, val tomorrow: String)`; `fun dayLabel(date: LocalDate, today: LocalDate, labels: Labels): String` ("Today", "Tomorrow", `Fri 6 Nov`, with the year when it differs from today's, English month/day names independent of the phone locale).
  - `fun timeText(item: AgendaItem, day: LocalDate, clock24: Boolean, allDay: String, until: String): String` ("All day", `14:30–15:30` / `2:30 PM–3:30 PM`, `until 15:30` for an event that started before `day`, the end's date added when it ends on another day).
  - `data class WidgetModel(val days: List<AgendaDay>, val rowCount: Int, val empty: Boolean, val staleHours: Long?, val nextTick: Instant?)`; `fun widgetModel(…same inputs as buildAgenda…, lastSyncAt: Instant?, maxRows: Int): WidgetModel` — `onlyUpcoming = true`, keeps rows in order until `maxRows` items are listed (headings do not count), `empty` when no visible upcoming item exists in the data, `staleHours` set (floor of hours) only when `lastSyncAt` is null or older than 3 h, `nextTick` = `endInstant` of the first listed item.

- [ ] **Step 1: Write failing tests** (account zone `Europe/Berlin` unless noted; `now` fixed):
  - timed events on two days grouped under the right dates, sorted; all-day first within a day.
  - `buildAgenda` in `Pacific/Auckland` while the data is for UTC instants: an event at 23:30 UTC lands on the *next* local day.
  - Review Focus 1: the Sunday clocks change in `Europe/Berlin` (2027-03-28): an event 01:30–03:30 local shows start 01:30 and the day has the correct order; an all-day event that day lists first; `now` after the change gives the right "today".
  - Review Focus 2: an event 22:00–02:00 across midnight at `now` 23:00 and at 01:00 next day is listed once, under today in both cases, until 02:00, then gone (`onlyUpcoming`); a three-day all-day event started yesterday is under today; a zero-length event at 10:00 is still present at 10:00:30 and gone at 10:01.
  - `onlyUpcoming = false` keeps today's ended events.
  - Review Focus 5: hidden calendar removed; if all upcoming items are hidden the widget model is `empty`.
  - `widgetModel`: `maxRows = 3` with 5 upcoming items lists 3 and carries `nextTick` of the first; today empty → starts at the next day with items; `staleHours` null at 2 h 59 m, `3` at 3 h 01 m, non-null when `lastSyncAt` is null.
  - `dayLabel` ("Today", "Tomorrow", `Fri 6 Nov`, `Mon 3 Jan 2028` across a year boundary) and `timeText` cases above (24 h and 12 h).
- [ ] **Step 2:** Run `./gradlew --no-daemon testDebugUnitTest --tests '*AgendaTest'`. Expected: FAIL (unresolved).
- [ ] **Step 3: Implement** `Agenda.kt` (no Android imports; `java.time` only). Parse `start`/`end` strings as local date-times (or dates for all-day) in the event's own `tz`, but **place them by the `start_utc`/`end_utc` instants converted to the account zone** (all-day events: date taken from `start`, not converted). Document that choice in the file header.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `android: agenda and widget selection logic`.

---

### Task 6: Local store interface and the sync engine

**Files:**
- Create: `data/LocalStore.kt`, `sync/SyncEngine.kt`
- Test: `src/test/.../FakeStore.kt` (in-memory `LocalStore`), `FakeApi.kt` (scriptable `CalendarApi`), `SyncEngineTest.kt`

**Interfaces:**
- Consumes: Task 4 types.
- Produces:
  - `data class Snapshot(val calendars: List<Calendar>, val occurrences: List<Occurrence>, val lastSyncAt: Instant?, val accountId: String?)`.
  - `interface LocalStore { suspend fun snapshot(): Snapshot; suspend fun cursor(): Long; suspend fun windowFrom(): Instant?; suspend fun commit(accountId: String, calendars: List<Calendar>, occurrences: List<Occurrence>?, windowFrom: Instant?, cursor: Long, syncedAt: Instant); suspend fun clear() }` — `commit` is **atomic**: calendars, cursor, `syncedAt` and (when non-null) the replaced occurrences and window land together or not at all; `occurrences == null` keeps the stored ones.
  - `sealed interface SyncResult { object Ok(val changed: Boolean); object SignedOut; object Offline; class Failed(val code: String, val message: String) }`.
  - `class SyncEngine(api: CalendarApi, store: LocalStore, accountId: String, now: () -> Instant)` with `suspend fun sync(): SyncResult`. Algorithm: if `store.snapshot().accountId` differs from `accountId` → `store.clear()`; fetch calendars; page `changes(cursor)` until `!more`; compute the day-aligned window `[from, from + 74 days)` with `from = startOfUtcDay(now − 14 d)`; refetch occurrences (30-day chunks, all before any write) when there were changes, or `windowFrom` differs, or the store is empty/never synced; then one `commit`. Mapping: `ApiException` 401 → `SignedOut`; `NetworkException` → `Offline`; other `ApiException` → `Failed`. No partial writes on any failure.

- [ ] **Step 1: Write failing tests** `SyncEngineTest` (fakes, `runTest`):
  - first sync stores calendars, occurrences from every chunk (assert chunk boundaries: 3 requests of ≤30 days covering exactly the window), cursor and `syncedAt`.
  - second sync with no changes and the same window makes **no occurrences request** but updates `syncedAt` and calendars.
  - a change (upserted event) refetches occurrences; a `deleted` id plus the refetch drops its occurrences; `more = true` pages are followed and the last cursor is stored.
  - the window moves at the next UTC day: refetch happens; same day: not.
  - Review Focus 3: the third chunk throws `NetworkException` → result `Offline`, the store's snapshot, cursor and `syncedAt` are byte-for-byte the previous ones, and the *next* successful sync still processes the same changes. Same with a 500 on the changes call (`Failed`) and with a failing `calendars()`.
  - Review Focus 4: 401 on any call → `SignedOut`, store untouched; a different `accountId` empties the store before syncing and a failed sync after that leaves it empty rather than half-filled.
  - an empty server (no events) is stored as empty, not as "never synced".
- [ ] **Step 2:** Run `./gradlew --no-daemon testDebugUnitTest --tests '*SyncEngineTest'`. Expected: FAIL.
- [ ] **Step 3: Implement** `LocalStore.kt` (interfaces and `Snapshot`) and `SyncEngine.kt`. `FakeStore.commit` must itself be all-or-nothing so the tests prove the engine never relies on partial writes.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `android: local store interface and sync engine`.

---

### Task 7: Contract tests against the real Go server

**Files:**
- Create: `src/test/.../contract/ServerHarness.kt`, `src/test/.../contract/ContractTest.kt`

**Interfaces:**
- Produces: `object ServerHarness { fun start(): RunningServer }` — builds the binary once per test JVM (`go build -o <tmp>/korecalendar ./cmd/korecalendar` run in `../../api`), creates a temp data dir, runs `korecalendar init` then `serve` with `KORECAL_DATA_DIR`, `KORECAL_BIND=127.0.0.1`, `KORECAL_PORT=<free port>`, waits for `GET /api/healthz`, creates the first account through `POST /api/setup` (email `owner@korecal.test`, password `owner-password-123`), returns base URL, credentials and a way to create calendars/events through the REST API with a plain HTTP client (test-only helper `createEvent(token, json)`). If `go` is not on `PATH`, tests are **skipped locally** (`Assume`) but **fail when the `CI` environment variable is set**.

- [ ] **Step 1: Write failing tests** `ContractTest`: (a) wrong password → `ApiException(401, …)`; right password → session whose `user.timezone` is a string; (b) the sign-in flow primitives: `createToken("Android, test")` with the session returns a `kcal_…` token, `logout()` ends the session, the token then works for `me()` and `calendars()`; (c) with a weekly recurring event, an exception (`scope=this`), an all-day event and a deleted event created through REST, `SyncEngine.sync()` on a `FakeStore` yields exactly the occurrences `GET /api/occurrences` returns, sync is `Ok`; (d) a second sync after editing one event through REST sees the change and the new title; (e) deleting the event through REST removes it on the next sync; (f) revoking the token through the REST API (session) makes the next sync `SignedOut`; (g) an access token calling `POST /api/tokens` is refused (`403`), documenting why the app discards the session only after creating its token.
- [ ] **Step 2:** `cd android && ./gradlew --no-daemon testDebugUnitTest --tests '*ContractTest'`. Expected: FAIL (harness missing).
- [ ] **Step 3: Implement** the harness and fix any mismatch the tests expose in the models/client (record each as a ledger note; a mismatch with the OpenAPI file is a finding for the owner, not something to patch silently).
- [ ] **Step 4:** Same command. Expected: PASS (and `CI=1` with `go` hidden from `PATH` fails, which is checked once by hand and noted).
- [ ] **Step 5: Commit** `android: contract tests against the real API server`.

---

### Task 8: Account storage, preferences, sign-in flow

**Files:**
- Create: `data/Account.kt`, `data/SignIn.kt`
- Test: `AccountStoreTest.kt`, `SignInTest.kt`

**Interfaces:**
- Consumes: `CalendarApi`, `normalizeServerUrl`, `Session`, `TokenCreated`.
- Produces:
  - `interface KeyValue { fun get(k: String): String?; fun put(k: String, v: String?) }` (SharedPreferences adapter in the app, map in tests); `interface SecretBox { fun seal(plain: ByteArray): ByteArray; fun open(sealed: ByteArray): ByteArray }`; `class KeystoreSecretBox : SecretBox` (AES/GCM, key alias `korecal-token` in Android Keystore, random 12-byte IV prepended) — device-only, verified in Task 14.
  - `data class Account(val serverUrl: String, val userId: String, val email: String, val timezone: String, val token: String)`; `class AccountStore(kv: KeyValue, box: SecretBox) { fun load(): Account?; fun save(a: Account); fun clear() }` — only the token goes through `box`; nothing else secret is stored; `load()` returns null (and clears) if the sealed blob cannot be opened.
  - `class Prefs(kv: KeyValue) { var clock24: Boolean; var hiddenCalendars: Set<String> }`.
  - `sealed interface SignInResult { class Ok(val account: Account, val cleartext: Boolean); object BadUrl; object BadCredentials; class RateLimited(val message: String); object Offline; class Failed(val message: String) }`; `class SignIn(apiFor: (ServerUrl, String?) -> CalendarApi, accounts: AccountStore, deviceName: String)` with `suspend fun signIn(rawUrl: String, email: String, password: String): SignInResult`: normalize → `login` → `createToken("Android, $deviceName")` using the session token → `logout()` of the session (best effort) → save the account with the **new token** (never the password, never the session token).

- [ ] **Step 1: Write failing tests.** `AccountStoreTest`: round-trip; the stored values contain neither the token nor the email in clear text when `box` is a reversing fake (assert the token string is absent from every `KeyValue` value); an unreadable blob → `load()` null and the entry is cleared. `SignInTest` (FakeApi): success calls login, createToken with the *session* token, logout, and saves the created token; the saved account's token is not the session token and the password appears nowhere in the saved state; 401 → `BadCredentials` and nothing saved; 429 → `RateLimited`; `NetworkException` → `Offline`; invalid address → `BadUrl` without any request; `createToken` failing after a good login → `Failed`, nothing saved, and the session is logged out; an `http://` address → `Ok(cleartext = true)`.
- [ ] **Step 2:** Run the two test classes. Expected: FAIL.
- [ ] **Step 3: Implement** the files.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `android: account storage and sign-in flow`.

---

### Task 9: Room store

**Files:**
- Create: `data/RoomStore.kt` (entities `CalendarRow`, `OccurrenceRow`, `MetaRow`; `AppDatabase`; `class RoomStore(db) : LocalStore`), plus a `Repository` in `data/Repository.kt`
- Modify: `app/build.gradle.kts` (Room + KSP)

**Interfaces:**
- Consumes: `LocalStore`, `Snapshot`.
- Produces: `class RoomStore(context: Context) : LocalStore` with the same atomic `commit` (one Room transaction); `class Repository(store: LocalStore, scope: CoroutineScope) { val snapshot: StateFlow<Snapshot?>; suspend fun refreshFromStore() }` which the UI and the widget read.

- [ ] **Step 1:** Add Room (`androidx.room:room-runtime`, `room-ktx`, KSP compiler) and confirm the build with KSP works under AGP 9.5.0. If KSP cannot be made to work, record a `Ruling:` and implement `RoomStore` as an atomic file store behind the same interface (write to a temp file, `fsync`, rename) instead; the rest of the plan is unchanged.
- [ ] **Step 2: Write the failing test** for the one part that is testable on the JVM: `RepositoryTest` with `FakeStore` — `snapshot` is null before the first `refreshFromStore`, reflects the store afterwards, and a second `refreshFromStore` after a commit emits the new snapshot (turbine-free: collect with `first()`).
- [ ] **Step 3:** Run it. Expected: FAIL. Implement `Repository`, `RoomStore` (and `AppDatabase`, `exportSchema = false`). Run `./gradlew --no-daemon testDebugUnitTest assembleDebug`. Expected: PASS and the app compiles with Room. (`RoomStore`'s own behaviour — atomic commit, clear, reads — is exercised by the device tests in Task 14; the plan does not claim JVM coverage for it.)
- [ ] **Step 4: Commit** `android: Room store and repository`.

---

### Task 10: Screens (sign-in, agenda, details, settings)

**Files:**
- Create: `ui/AppViewModel.kt`, `ui/SignInScreen.kt`, `ui/AgendaScreen.kt`, `ui/EventDetailsScreen.kt`, `ui/SettingsScreen.kt`, `ui/Chrome.kt` (shared components), `ui/UiModels.kt` (pure state + reducers)
- Modify: `MainActivity.kt`, `res/values/strings.xml`
- Test: `UiModelsTest.kt`, `AppViewModelTest.kt`

**Interfaces:**
- Consumes: Tasks 4–9.
- Produces (pure, testable): `data class AgendaUi(val days: List<AgendaDay>, val labels: Labels, val offlineNote: String?, val staleHours: Long?, val empty: EmptyKind?)` and `fun agendaUi(snapshot: Snapshot?, prefs: Prefs, zone: ZoneId, now: Instant, syncState: SyncState): AgendaUi`; `sealed interface SyncState { Idle, Syncing, Offline, SignedOut, Failed(message) }`; `AppViewModel` holding `StateFlow<AppState>` (`Loading`, `SignedOut`, `Ready(agendaUi, …)`), actions `signIn(url, email, password)`, `refresh()`, `signOut()`, `setClock24`, `toggleCalendar(id)`. Navigation is a simple state (`Screen.Agenda | Details(eventId, key) | Settings`), `BackHandler` for back, no navigation library.

Screens, per the spec:
  - **Sign-in:** server address, email, password; shows the cleartext warning as soon as the address is `http://`; error messages from `strings.xml` per `SignInResult`; the password field never survives a configuration change in a saved state.
  - **Agenda (home):** `LazyColumn` of day headings and rows (time text, title, colour dot with the calendar's colour); a "Today" action that scrolls to today; pull-to-refresh; a quiet line "Updated 5 h ago" when stale and "Offline" when the last sync was offline; an empty state "Nothing in the next 60 days" when the visible copy has no upcoming item; ended events of today shown dimmed; opens on today.
  - **Event details (read-only):** title, calendar (name and colour), time text with the date, location, notes, repeat text from `is_recurring`.
  - **Settings:** server address and account email, clock 12/24 h, calendars list with show/hide switches, "Sign out" (clears token and the local copy after a confirmation), version name from `BuildConfig`.

- [ ] **Step 1: Write failing tests.** `UiModelsTest`: `agendaUi` with a fresh snapshot has `staleHours == null`; with `lastSyncAt` 5 h ago gives 5; with `SyncState.Offline` gives the offline note; hidden calendars removed; null snapshot gives `Loading` state input; `empty` set when all upcoming are hidden or none exist; ended events of today are kept (`onlyUpcoming = false`) but flagged `ended = true` on the item. `AppViewModelTest` (coroutines-test, fakes): with no account the state is `SignedOut`; a successful `signIn` runs a first sync and ends `Ready`; a `SignedOut` sync result clears the account but **keeps** the local copy readable until the next sign-in; signing in as another account clears it; `refresh()` while offline keeps the old agenda and sets the offline note; toggling a calendar updates `Prefs` and the agenda immediately.
- [ ] **Step 2:** Run both classes. Expected: FAIL.
- [ ] **Step 3: Implement** the pure models and view model first (tests green), then the Compose screens. Compose code is not unit-tested here; it must compile, pass lint, and be exercised on a device in Task 14.
- [ ] **Step 4:** `./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug`. Expected: PASS.
- [ ] **Step 5: Commit** `android: sign-in, agenda, details and settings screens`.

---

### Task 11: Background sync and the Agenda widget

**Files:**
- Create: `sync/SyncWorker.kt`, `widget/AgendaWidget.kt` (Glance widget, `AgendaWidgetReceiver`, `WidgetTickReceiver`, `WidgetUpdater`), `res/xml/agenda_widget_info.xml`
- Modify: `AndroidManifest.xml` (receivers, `RECEIVE_BOOT_COMPLETED` not yet), `strings.xml`, `app/build.gradle.kts` (WorkManager, Glance)
- Test: `WidgetPlanTest.kt`

**Interfaces:**
- Consumes: `widgetModel` (Task 5), `RoomStore`, `SyncEngine`, `AccountStore`, `Prefs`.
- Produces: `fun rowsFor(heightDp: Float): Int` (pure: 3 rows at the default height `110 dp`, one more per `~36 dp`, minimum 1); `class SyncWorker : CoroutineWorker` (loads the account, runs `SyncEngine.sync()`, then `WidgetUpdater.updateAll`; `Result.success()` for Ok/Offline, `Result.failure()` is never returned so the periodic schedule keeps running; `SignedOut` marks the account signed-out); `object WidgetUpdater { suspend fun updateAll(context); fun scheduleTick(context, at: Instant?) }` where the tick is a single inexact `AlarmManager.set` broadcast to `WidgetTickReceiver` at the first listed event's end; periodic work `unique("korecal-sync", KEEP, 15 min, NetworkType.CONNECTED)` enqueued when the account exists and after sign-in; a one-time sync is enqueued when the app comes to the foreground.
- Widget layout: dark `surface` background, rounded; heading text for each day; rows with the colour dot, time and title (one line, ellipsised); a footer line "Updated 5 h ago" only when `staleHours != null`; the empty state text; row tap → `MainActivity` with the event's ids; heading/background tap → the agenda. Provider info: `minWidth 250dp`, `minHeight 110dp`, `targetCellWidth 4`, `targetCellHeight 2`, `resizeMode horizontal|vertical`, `updatePeriodMillis 0` (the worker drives updates), description string.

- [ ] **Step 1: Write the failing test** `WidgetPlanTest.rowsFor`: 110 → 3, 70 → 1, 146 → 4, 40 → 1, 400 → at most 10 (cap), 0 → 1.
- [ ] **Step 2:** Run it. Expected: FAIL. Implement `rowsFor`; run again. Expected: PASS.
- [ ] **Step 3: Implement** the worker, widget, receivers, manifest entries and provider XML. The widget composable only maps `WidgetModel` to Glance nodes (no logic of its own).
- [ ] **Step 4:** `./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug`. Expected: PASS (lint clean, or each warning explained in a `lint.xml` baseline entry with a comment).
- [ ] **Step 5: Commit** `android: background sync and the Agenda widget`.

---

### Task 12: Launcher icon and app name

**Files:**
- Create: `res/drawable/ic_launcher_foreground.xml`, `res/drawable/ic_launcher_monochrome.xml`, `res/mipmap-anydpi-v26/ic_launcher.xml`, `res/values/ic_launcher_background.xml`

- [ ] **Step 1:** Convert the web brand mark (`web/app/icon.svg`: nine rounded squares on `#16181d`, accent `#5b8def` at opacities 0.3/0.6/1) into an adaptive-icon vector foreground scaled to the 72 dp safe zone, a background colour `#16181d`, and a single-colour monochrome layer for themed icons. Launcher label: "Calendar".
- [ ] **Step 2:** `./gradlew --no-daemon lintDebug assembleDebug`. Expected: PASS. Verify visually once on a device in Task 14 (record it there).
- [ ] **Step 3: Commit** `android: launcher icon from the brand mark`.

---

### Task 13: CI, the release workflow, docs

**Files:**
- Create: `.github/workflows/android-ci.yml`, `.github/workflows/android-release.yml`, `android/signing-fingerprint.txt`, `docs/android.md`
- Modify: `docs/releasing.md`, `AGENTS.md`, `README.md`, `docs/README.md`, `docs/superpowers/specs/2026-11-03-android-design.md` (status), `.github/workflows/ci.yml` (nothing; Android has its own)

- [ ] **Step 1:** `android/signing-fingerprint.txt` = the ledger's `Fingerprint:` value from Task 1 (uppercase hex without colons or with, one consistent form documented in the workflow).
- [ ] **Step 2: `android-ci.yml`:** on `pull_request` with `paths: android/**, web/app/globals.css, scripts/*android*, .github/workflows/android-*.yml`; also `workflow_call`. Jobs: checkout, `actions/setup-java` (temurin 21), `actions/setup-go` (go-version-file `api/go.mod`), `android-actions/setup-android`, `gradle/actions/setup-gradle`, `bash scripts/test-android-version.sh`, `./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug` with `CI=true` so the contract tests cannot be skipped. Upload the lint report on failure. Concurrency per ref, `cancel-in-progress` on PRs.
- [ ] **Step 3: `android-release.yml`:** on push tags `android-v[0-9]+.[0-9]+.[0-9]+` and `android-v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`. Jobs, each failing fast with a clear message: `verify` (tag version equals `android/version.properties` `versionName` and its code equals `scripts/release-android.sh --print-code`; the tag commit is an ancestor of `origin/main`; `signing-fingerprint.txt` is non-empty) → `build` (`uses: ./.github/workflows/android-ci.yml`'s steps repeated or called; then check the four secrets are present; decode the keystore to `$RUNNER_TEMP`; `./gradlew assembleRelease` with the signing env; `apksigner verify --print-certs` must succeed and its `SHA-256 digest` must equal `signing-fingerprint.txt` (case/colon-insensitive); rename to `korecalendar-<version>.apk`; write `korecalendar-<version>.apk.sha256`; upload as artifact) → `release` (`contents: write`; previous `android-v*` tag found with `git tag --list 'android-v*' --sort=-v:refname`; `gh api …/generate-notes` with `previous_tag_name`; notes start with install instructions and the SHA-256; `gh release create … --verify-tag --prerelease` when the version has `-rc.`; attach the APK and checksum). No unsigned fallback.
- [ ] **Step 4:** Lint: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest`. Expected: no output. Check by reading the filters that `images.yml` (tags `v[0-9]+…`) does not match `android-v…` and the reverse.
- [ ] **Step 5: Docs.** `docs/android.md` (what the app is, install from a release with checksum verification, first run, the widget and how to add it on the Nothing phone, offline behaviour, hidden calendars, what stage 1 does not do, troubleshooting, the manual device checklist from Task 14); `docs/releasing.md` (Android section becomes real: tags, `scripts/release-android.sh`, the fingerprint, the keystore backup warning, the signing-check workflow); `AGENTS.md` (Android rules: recurrence never on the phone, public API only, strings in `strings.xml`, palette parity, `android/` commands, release rule); `README.md` and `docs/README.md` links; spec status line "stage 1 implemented". Links must resolve (reuse the link checker used for earlier docs passes).
- [ ] **Step 6: Commit** `android: CI, release workflow and docs`.

---

### Task 14: Run it for real (emulator or phone) and device tests

**Files:**
- Create: `app/src/androidTest/java/dev/qarasky/korecalendar/RoomStoreTest.kt`, `SecretBoxTest.kt`, `WidgetSmokeTest.kt`; `docs/android.md` checklist already present from Task 13

**Interfaces:**
- Consumes: `RoomStore`, `KeystoreSecretBox`, `AgendaWidget`.

- [ ] **Step 1: Get a device.** Install the Android command-line tools into `~/Library/Android/sdk/cmdline-tools/latest` (download from Google's official `commandlinetools-mac` archive into a fresh empty directory, verify its SHA-256 against the value on the Android Studio download page, extract), accept licences, install `system-images;android-36;google_apis;arm64-v8a` (the Mac is arm64) and create an AVD; boot it headless. If a physical phone is visible to `adb devices`, use that instead. If neither is possible, record a `Ruling:` that device verification moves to the owner's phone and skip to Step 4, listing in the final message exactly which behaviours are unverified.
- [ ] **Step 2: Write failing device tests** (`./gradlew connectedDebugAndroidTest`): `RoomStoreTest` — `commit` then `snapshot` round-trips; a commit that throws half-way (inject a failing occurrence) leaves the previous state intact; `clear` empties it; `cursor()`/`windowFrom()` persist across a re-opened database. `SecretBoxTest` — `seal`/`open` round-trip, two seals of the same plaintext differ, a flipped byte makes `open` throw. `WidgetSmokeTest` — after committing a snapshot with five upcoming events, `WidgetUpdater.updateAll` completes and the Glance state reports three rows at the default size.
- [ ] **Step 3:** Run them. Expected: FAIL first where the behaviour is not yet right (if a test passes immediately, say why in the ledger); fix the code; run again. Expected: PASS.
- [ ] **Step 4: End-to-end by hand on the device** (record results in the ledger): start the real server (`api` binary or the Docker dev stack) reachable from the device (`10.0.2.2` on the emulator), seed a few events (a weekly series, an all-day event, one ending in ten minutes); install the debug APK; sign in (including the cleartext warning); see the agenda; add the widget to the home screen and check three rows and the "from now" behaviour; toggle airplane mode and check both still show; hide a calendar and check both; revoke the token in the web app and check the app returns to sign-in; sign in as a second account and check the old copy is gone. Fix what is wrong with a test first where a test can express it.
- [ ] **Step 5: Commit** `android: device tests`.

---

### Task 15: Merge, tag `android-v0.1.0`, verify the release

- [ ] **Step 1:** Run the full verification once more on the branch: `cd android && ./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug`, `bash scripts/test-android-version.sh`, `cd api && go vet ./... && go test -race -count=1 ./...`, `cd web && npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 2:** The whole-branch review and the fix pass happen in the execution workflow (not a plan step), then the branch is merged to `main` through a pull request so `android-ci.yml` runs on GitHub; wait for green.
- [ ] **Step 3:** `scripts/release-android.sh 0.1.0`, `git push origin main android-v0.1.0`, `gh run watch`. Expected: `verify`, `build`, `release` all pass; a GitHub release `android-v0.1.0` with `korecalendar-0.1.0.apk` and its `.sha256`.
- [ ] **Step 4:** Download the APK from the release into a fresh empty directory; `sha256sum -c`; `apksigner verify --print-certs` from the local build-tools; the certificate digest equals `android/signing-fingerprint.txt`. Install it on the emulator/phone over the debug build's data (it will refuse: different key, expected) and then fresh; run the Task 14 checklist's first three items against the release APK. Record everything in the ledger and the final message. Expected: installs, signs in, shows the agenda and the widget.
