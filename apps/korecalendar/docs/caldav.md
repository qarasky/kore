# CalDAV

The calendars you see in the web app are also served over **CalDAV** ([RFC 4791](https://www.rfc-editor.org/rfc/rfc4791)), so any app or library that speaks it can read and
write them. The data format on the wire is **iCalendar** (`.ics`, [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)), the same format
`GET /api/export` and `POST /api/import` use.

**The REST API stays the primary interface** ([api.md](api.md)): JSON, idempotent retries, stable error codes, everything the app can do. CalDAV is for software that already
speaks CalDAV (python `caldav`, `tsdav`, `vdirsyncer`, `khal`, Thunderbird, DAVx5, Apple Calendar) and it goes through exactly the same code, so recurrence,
soft delete, versions and "who changed it" behave identically.

## Connect

| | |
| --- | --- |
| Address | `https://<your host>/dav/` (discovery also works from `/.well-known/caldav`) |
| User name | your account's email |
| Password | an **access token** (Settings → Access tokens). Your account password, session tokens and cookies are **not** accepted. |

Create one token per integration: each is revocable on its own and shows up in "last changed by". Behind a tunnel or Tailscale HTTPS use `https`; on a LAN `http` works too,
but Basic credentials are then sent in clear text, so prefer HTTPS anywhere untrusted.

Development note: the Next.js dev server cannot proxy CalDAV (`PROPFIND`, `REPORT`); CalDAV is served by the API itself, so in development use the API's own port, and in
production Caddy routes `/dav/*` to it.

```bash
B=https://calendar.example.com TOK=kcal_…
# discovery (what every client does first)
curl -s -u me@example.com:$TOK -X PROPFIND -H 'Depth: 0' -H 'Content-Type: application/xml' $B/dav/ \
  -d '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'
# one calendar's events
curl -s -u me@example.com:$TOK -X REPORT -H 'Depth: 1' -H 'Content-Type: application/xml' $B/dav/<user_id>/calendars/<calendar_id>/ \
  -d '<?xml version="1.0"?><c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>'
```

With python's [`caldav`](https://pypi.org/project/caldav/) library:

```python
import caldav
client = caldav.DAVClient(url="https://calendar.example.com/dav/", username="me@example.com", password=TOKEN)
calendar = client.principal().calendars()[0]
calendar.save_event(ical_text)            # UID must be the file name: <UID>.ics (the library does this)
for ev in calendar.search(start=a, end=b, event=True): print(ev.data)
```

## How it maps

| CalDAV | KoreCalendar |
| --- | --- |
| principal `/dav/{user_id}/` | you. Another user's id is a **404**, never a 403 |
| home set `/dav/{user_id}/calendars/` | your live calendars |
| collection `/dav/{user_id}/calendars/{calendar_id}/` | one calendar (a deleted one is gone) |
| resource `…/{uid}.ics` | one event series: the master, its `EXDATE`s/`RDATE`s and `RECURRENCE-ID` overrides (the file `GET /api/export` writes) |
| `UID` | the UID the event was imported or created with by a CalDAV client, otherwise its id |
| `ETag` | changes on every edit, including a single-occurrence edit |
| `PUT` | creates, or replaces the series with that UID **in the same calendar** |
| `DELETE` | the same soft delete as the app (restorable for 30 days: `POST /api/events/{id}/restore`) |
| `calendar-query` with `time-range` | series with at least one occurrence in the range, expanded in the event's own zone (DST and exclusions are right) |
| `If-Match`, `If-None-Match: *` | honoured on `PUT`; `If-Match` on `DELETE`. A lost race is `412` |

Calendars are created, renamed and deleted in the web app or the REST API: `MKCOL` answers 403 and `PROPPATCH` 501.

## What a `PUT` keeps and drops

A `PUT` replaces the resource, and what is stored is what the model can hold: title, notes, location, start and end (with zone), all-day, `RRULE`/`RDATE`/`EXDATE`, changed
occurrences, and `VALARM`s that fire before the start. These are **not stored**: `ATTENDEE`, `ORGANIZER`, `CATEGORIES`, `URL`, `STATUS`/`TRANSP`/`CLASS`, `X-` properties, other alarms. A floating or
unknown-`TZID` time is mapped to your zone; exclusions and changed occurrences that match no occurrence are dropped; a `STATUS:CANCELLED` event is skipped. So:

- A `PUT` never returns an `ETag`: re-read the resource to see what was stored.
- A `PUT` **without `VALARM`s clears the reminders** set in the web app; the resource you sent is the resource.
- An integration that keeps its own ids in `X-` properties should keep them in its own store (or use the REST API, which has stable ids and `Idempotency-Key`).

Refused with a CalDAV precondition (HTTP 409 with the element in the body), changing nothing: a `VTODO` or other non-event (`supported-calendar-component`);
a file name that is not `{UID}.ics`, a rule outside the supported set (hourly, `BYWEEKNO`, …), or no `DTSTART` (`valid-calendar-object-resource`); a UID that already lives in
another of your calendars (`no-uid-conflict`). A body over 5 MB is 413.

**Moving an event** between calendars: `DELETE` it from the old one, then `PUT` it into the new one. The UID of a deleted event counts as free, so this works at once; the deleted
event stays restorable (without the UID).

## Known limits

- **No `sync-collection` (RFC 6578) and no `getctag`:** the CalDAV library in use does not provide them, so clients re-list a calendar with its ETags. Fine for a personal calendar.
- **No `VTIMEZONE` blocks**, only IANA `TZID`s, as in the `.ics` export. Libraries cope; strict clients may not.
- Resource names must equal `{UID}.ics`; a `PUT` always answers 201 (also for an update) and has no `ETag`.
- No scheduling or invitations (RFC 6638), free/busy, ACLs, sharing, `VTODO`, or calendar colours.
- Access tokens give full access (there are no read-only tokens yet): a CalDAV token can do everything the REST API can, except manage tokens.
- A `calendar-multiget` that names a resource that does not exist (or is not yours) answers 404 for the whole request.
- A time range wider than ~66 years, or with very many occurrences, answers with every event of the calendar (a superset).

## Verified with

(filled in once the real-client run is done)
