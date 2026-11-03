# KoreCalendar for Android

A native Android app (Kotlin, Jetpack Compose, dark) for **glancing at your calendar**: an Agenda widget for the home screen, and an Agenda screen that opens instantly and works offline.
Design: [specs/2026-11-03-android-design.md](superpowers/specs/2026-11-03-android-design.md). Release process: [releasing.md](releasing.md#android).

> **Status: stage 2 of 4.** You can sign in, see the agenda, add the widget, hide calendars, sign out, and **create, edit and delete events**. Day, week and month views (stage 3) and
> reminders as phone alarms (stage 4) are not in the app yet: use the web app for those.

## Install

1. Open the [Releases page](https://github.com/qarasky/korecalendar/releases) and pick the newest release whose tag starts with `android-v`.
2. Download `korecalendar-<version>.apk` and its `.sha256` file. Optional but sensible: `sha256sum -c korecalendar-<version>.apk.sha256` in the same folder.
3. Open the APK on the phone. Android asks once to allow installing from your browser or file manager. Needs **Android 13 or newer**.
4. Updating is the same: install the newer APK over the old one. It replaces the app and keeps your sign-in, because every release is signed with the same key.
   (If Android says the app conflicts with an existing package, the old one was a debug build: uninstall it first.)

## First run

Enter the **server address** (the same one you use in the browser, for example `calendar.example.com` or `192.168.1.5:8080`), your **email** and **password**.

- A bare local address (an IP, `localhost`, a name ending in `.local` or `.lan`) is tried with `http://`, anything else with `https://`. If the address is plain `http://`, the app says so:
  your sign-in and your calendar then travel unencrypted. That is fine at home or over Tailscale, not on public Wi-Fi.
- The password is used **once**. The app signs in, asks the server for its own access token named `Android, <your phone>`, ends that session, and keeps only the token, encrypted with a key
  held by the phone's hardware-backed keystore. To cut the phone off, delete that token in the web app (Settings, Access tokens): the app then asks you to sign in again.
- Times are shown in the time zone of your **account** (Settings on the web), not the phone's current zone.

## The agenda

Opens on today. Each day has a heading ("Today", "Tomorrow", "Fri 6 Nov") and rows with time, title and the calendar's colour; all-day events come first; events that already ended today are dimmed.
Tap a row for the details. Pull down to refresh. **Today** jumps back to the top. When the copy is more than three hours old, or the phone is offline, a quiet line says so.

**Settings** has the server and account, a 12/24-hour clock, **show/hide for each calendar** (hidden calendars disappear from the agenda and the widget, their events stay on the server) and
**Sign out** (which also deletes the copy on the phone).

## Editing events

**New event** (the button on the agenda) opens the editor; tap an event, then **Edit** or **Delete**. The editor has every field the web editor has: title, calendar, all-day, start and end (date and time), time zone,
**repeat** (the same choices as the web, or **Custom…**), up to 20 **reminders**, location and notes. Events are edited in their **own** time zone (shown in the editor); the agenda shows them in your account's zone.

- **Repeating events** ask **This event / This and following events / All events**, with the same rules as the web: changing the time zone, the repeat rule or the calendar is not offered for "this event only", and a repeat rule the app cannot show
  as a choice (for example "last weekday of the month") is shown as it is and **kept untouched** unless you replace it. When a change to the schedule resets changed occurrences, the message says how many.
- **Delete** asks first (repeating events ask which ones) and then offers **Undo** for a few seconds, and the web app can bring it back for 30 days.
- **Needs the server.** Editing is online only. If the server cannot be reached the editor **stays open with everything you typed** and says why; tap Save again to retry (a retry never creates twice).
  If someone changed the event somewhere else in the meantime, Save is refused with "This event was changed somewhere else": **Reload** shows the latest version (and discards your changes), nothing is overwritten silently.
- After a save the app updates its copy, so the agenda and the widget agree at once.

## The widget

Long-press the home screen, **Widgets**, **Calendar**, and drag the Agenda widget out. It is about three rows tall by default and shows more rows when you make it taller.

- It lists **all your calendars' events from now on**, with day headings, and moves on to tomorrow (or whenever the next event is) when nothing is left today. An event leaves the list when it ends.
- It draws only from the copy on the phone, so it appears instantly and works offline. It says "Updated N h ago" when the copy is more than three hours old, even when it has nothing to list, and it redraws by itself
  (also offline) when the first event ends, when the copy turns three hours old (then every hour) and at midnight, so "Tomorrow" becomes "Today". With a larger system font it lists fewer rows rather than clipping them.
- Tap a row to open that event in the app; tap anywhere else to open the agenda.

## How it stays up to date

The app keeps a copy of **14 days back to 60 days ahead**, with repeating events already expanded by the server (the phone never works out repeats itself). It refreshes when you open the app,
after anything you do in it, and in the background about **every 15 minutes** (Android decides the exact moment, and may delay it when the phone is idle or on battery saver). If the phone cannot reach
your server, it keeps showing the last copy. Nothing is sent anywhere except to your server.

## Troubleshooting

| What you see | What it means |
| --- | --- |
| "Cannot reach the server" at sign-in | wrong address or no connection. Try the address in the phone's browser first. A server on your home network needs Wi-Fi or Tailscale |
| "Your sign-in ended" | the token was revoked (or the account removed). Sign in again; your copy is replaced |
| The widget says "Updated 9 h ago" | the phone has not reached the server for a while. Open the app on a network that can |
| The widget does not change when you hide a calendar | it redraws within moments; if not, open the app once |
| "App not installed" | the phone has a debug build of the app signed with a different key: uninstall it, then install the release |

## Checking it on a phone (manual list)

Run this after installing a new release; it is what the automated tests cannot see.

1. Sign in; the agenda shows your events. Add the widget: three rows, your next events.
2. Airplane mode on: the app and the widget both still show the events; the app says "Offline".
3. Hide a calendar in Settings: its events leave the agenda and the widget.
4. Revoke the token in the web app, then open the app: it asks you to sign in again.
5. Tap a widget row: the app opens on that event.
6. Rotate the phone and change the font size: nothing is clipped.
7. Create an event with a reminder and a repeat; it shows on the agenda and in the widget. Edit one occurrence ("This event"), then delete the series and Undo.
8. Start an edit, switch on airplane mode and press Save: the editor stays open with your text and says it cannot reach the server; switch it off and Save again.

## Building it yourself

```sh
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug     # needs JDK 21 and the Android SDK; the contract tests also need Go
```

The **device tests** (Room, the keystore, the widget's data, and the UI flows: sign in, create, edit one occurrence of a series, delete and undo) run on an emulator or a phone with
`bash scripts/android-ui-test.sh`, which starts a real server on the computer and gives the app its address (`10.0.2.2` from an emulator). CI runs them on every pull request.

The unit tests include contract tests that build and start the real server from `api/` and drive the app's networking and sync against it. Without Go they are skipped locally and fail under `CI`.
