# The web app

The web app is an ordinary client of the [public API](api.md): everything it does, an agent or a script can do with a token.
It is a Next.js app (server-rendered, no third-party scripts, fonts or images) served by Caddy next to the API.

## What it does

- **Four views:** Day, Week, Month and Agenda (the next 30 days, a heading per day that has events). Week shows seven days on a
  desktop and **three days around the selected one on a phone**; Month shows dots on a phone and opens the day when tapped.
- **A left panel** with a mini month and your calendars. The checkbox next to a calendar hides or shows its events.
- **Events** are tinted blocks with a coloured left edge and, when they repeat, a repeat mark. Overlapping events sit side by side.
  An event that spans midnight shows in both days. The now-line is drawn in today's column only.
- **The editor** (click an event, then Edit; or New event, or `c`) has title, all-day, start and end, time zone, repeat,
  reminders, calendar, location and notes. Repeat offers the usual choices and a custom rule (every N days/weeks/months/years,
  chosen weekdays, "2nd Tuesday", end on a date or after N times).
- **Search** (`/`) finds events by title, notes and location, in any time range.
- **Settings:** your time zone, week start and clock format; calendars (add, rename, recolour, delete and undo); access tokens;
  `.ics` import and export; notifications; and, for the administrator, users.
- Everything is in English, with every string in `web/lib/i18n/en.ts`.

## Repeating events: which events?

Editing, moving or deleting one occurrence of a repeating event asks **This event**, **This and following events** or **All events**.

| Choice | Edit | Delete |
| --- | --- | --- |
| This event | changes only that occurrence | skips it |
| This and following | splits the series there; the new series carries the change | ends the series before it |
| All events | changes the whole series | deletes it (Undo restores it) |

Some limits follow from what the rule can express. Dragging a repeating event to another **weekday** offers only the choices the rule can
follow: a weekly rule on Mondays can't be moved to Tuesday for "this and following" if a count would make that ambiguous, for
example. Changing the calendar applies to the whole series or from an occurrence on, never to a single occurrence.

A rule the editor cannot express (for example `BYSETPOS`, or anything imported with an unusual shape) is shown read-only as its raw
text and is **never rewritten**: editing the title keeps the rule exactly as it was.

## Dragging and the keyboard

| Gesture | Result |
| --- | --- |
| Drag on empty space in the week/day grid | the editor opens with that range |
| Drag an event | moves it (to another time or day); the drop snaps to 15 minutes |
| Drag an event's bottom edge | changes its end |
| Drag a chip to another day in the month | moves it to that day, keeping its time |
| `Esc` while dragging | cancels the drag, nothing is saved |
| `Alt` + arrow keys on a focused event | up/down: 15 minutes; left/right: a day |
| `Shift` + `Up`/`Down` on a focused event | changes its length by 15 minutes |

| Key | Action |
| --- | --- |
| `t` | go to today |
| `←` `k` `p` / `→` `j` `n` | previous / next period |
| `d` `w` `m` `a` | Day, Week, Month, Agenda |
| `c` | new event |
| `g` | go to a date |
| `/` | search |
| `?` | list the shortcuts |

Shortcuts never fire while you are typing in a field, and never with Ctrl, Cmd or Alt held.

## Motion

Motion explains change and stays out of the way: the period you step to pushes in from the side time moved, the Day/Week/Month/Agenda highlight and the mini-month's
week band glide, an event you move or edit travels to its new place (across days too), and popovers, dialogs, the drawer and toasts ease in and out. Nothing is longer than 250 ms,
and frequent actions (stepping through weeks, hovering) get the least. It uses [Motion](https://motion.dev) (formerly Framer Motion); the reasoning and numbers are in
[the motion design doc](superpowers/specs/2026-11-02-web-motion-design.md).

Settings → General → **Animations**: *Follow my system* (default), *Reduced* (no movement or scaling, fades stay) or *Full*. With the operating system's "reduce motion" on, the app reduces motion by itself.

## Time zones

Events are stored with their own zone, and the grid shows them in **your** zone (Settings → General). An event made in Berlin
shows at its New York time. Days with a daylight-saving change show every event at its wall-clock time.

## Notifications and HTTPS

Settings → Notifications turns on **browser notifications** (Web Push). Browsers only allow these on a secure context, so the page must
be opened over **HTTPS**: put a Cloudflare Tunnel or Tailscale HTTPS in front of the published port. On plain `http://` (a LAN address)
the settings page says so instead of failing silently; everything else works. The "test" button shows a notification from the browser
itself and does not go through the server. Phone reminders will be set by the Android app and do not need HTTPS.

## Preferences

The view you last used, the week start, the clock format and the hidden calendars are remembered in cookies
(`kc_view`, `kc_weekstart`, `kc_clock`, `kc_hidden`). They are not secrets and not part of your account.

## Known limits

- Dark theme only; English only.
- No password change screen (the API has no endpoint for it yet).
- No offline mode: the app needs its server. When the server can't be reached it says so, keeps what you typed, and a retry
  brings the page back.
- Deleting one occurrence, or "this and following", can't be undone from the toast; deleting a whole event can.
- Invitations, attendees and sharing are not part of the product.
