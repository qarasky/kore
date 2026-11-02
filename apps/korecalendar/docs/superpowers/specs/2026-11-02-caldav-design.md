# KoreCalendar: CalDAV

A CalDAV (RFC 4791) endpoint on the existing API, so any app or library that speaks CalDAV can read and write the same calendars as the web app and the REST API. The owner mainly wants it for **custom integrations with their other apps**, and chose the default options below.

Calls marked **(my call)** were made by the designer, not the owner. The owner's decisions: CalDAV is wanted (reversing the original non-goal, which is now removed from the main design); the focus is integrations, not a specific consumer app; "just the default options".

## Why, and where it fits

- The REST API is the product and stays the primary interface: JSON, idempotent, complete. **CalDAV is a standards layer for software that already speaks it** (CalDAV libraries such as python `caldav`, `tsdav`, `vdirsyncer`, `khal`; and Apple Calendar, Thunderbird, DAVx5 if the owner ever wants them). It must not become a second implementation: every CalDAV operation goes through the same `events`, `calendars` and `ics` packages as the REST API, so recurrence, soft delete, versions and "who changed it" behave identically.
- **iCalendar (`.ics`, RFC 5545)** is the data format on the wire; the project already imports and exports it. CalDAV is the protocol around it (discovery, listing, ETags, PUT/DELETE of single resources).

## Scope

In:

- **Discovery:** `/.well-known/caldav` redirects to `/dav/`; the current-user principal; the calendar-home-set; each of the user's live calendars as a calendar collection (name, colour as `calendar-color`, `supported-calendar-component-set` = `VEVENT` only).
- **Resources:** one `.ics` resource per event series: the master `VEVENT` plus its `EXDATE`s, `RDATE`s and `RECURRENCE-ID` overrides, exactly what `GET /api/export` already writes. `GET`, `PUT`, `DELETE`, `HEAD`.
- **Queries:** `PROPFIND` (Depth 0 and 1), `REPORT calendar-query` (including a `time-range` filter) and `calendar-multiget`. Whatever the chosen library does not serve itself is written by us.
- **Concurrency:** strong `ETag` per resource; `If-Match` and `If-None-Match: *` honoured on `PUT` and `DELETE`; 412 on a lost race.
- **Auth:** HTTP Basic. The user name is the account's email; the password is an **access token** (`kcal_…`), created under Settings → Access tokens. The account password is **not** accepted on `/dav`, so no client ever stores it and each client is revocable on its own **(my call)**. Session cookies are not accepted on `/dav`. Failed attempts count against the same per-address limiter as logins.
- **Read-write** by default (the owner's integrations will want to write).
- The recorded "last changed by" is the token's name, as for the REST API.

Out (anti-goals for this phase):

- `sync-collection` (RFC 6578) and `getctag`: the chosen library does not provide them. Clients fall back to listing resources with their ETags, which is cheap at personal scale. Adding them later needs a per-calendar change log and is a separate piece of work **(my call)**.
- Scheduling and invitations (RFC 6638: attendees, `schedule-inbox`), free/busy, ACLs, sharing: not products here, as in the main design.
- `VTODO`, `VJOURNAL`: collections advertise `VEVENT` only; a `PUT` of anything else is refused with the `supported-calendar-component` precondition.
- `MKCALENDAR`, `PROPPATCH`, deleting or renaming a calendar through CalDAV: calendars are managed in the web app or the REST API. These answer 403 with a message that says so **(my call)**.
- CardDAV, Apple push, per-token read-only scope, VTIMEZONE generation (see Known limits).

## How it maps onto the data

| CalDAV | KoreCalendar |
| --- | --- |
| principal `/dav/principals/{user_id}/` | the authenticated user (another user's id: **404**, never 403) |
| calendar-home-set `/dav/calendars/` | the user's live calendars |
| calendar collection `/dav/calendars/{calendar_id}/` | a calendar (soft-deleted ones are absent) |
| resource `/dav/calendars/{calendar_id}/{uid}.ics` | one event series: master + exclusions + overrides |
| `UID` | `events.ics_uid` when the event came from a CalDAV client or an import; otherwise the event's own id (exports already use it) |
| `ETag` | the event's `version` (and its id), quoted: it changes on every edit, including a single-occurrence edit |
| `PUT` | `events.Import`: same UID updates in place, keeping its calendar and replacing overrides; unknown UID creates. `If-Match` is checked against `version` **inside the same transaction** (a new optional field on `Imported`) |
| `PUT` to a UID that already lives in another calendar of the user | refused: `no-uid-conflict` (a client moving an event deletes and re-creates it) |
| `PUT` whose file name is not `{UID}.ics` | refused: `valid-calendar-object-resource`. Every client in the field names resources after the UID; keeping name and UID the same avoids a second identity per event **(my call)** |
| `PUT` of a rule outside the supported set (hourly, `BYWEEKNO`, …) | refused: `valid-calendar-object-resource`, with the same per-event reason the `.ics` import reports; nothing is approximated |
| `DELETE` | the event's soft delete (restorable for 30 days from the web app or `POST /api/events/{id}/restore`) |
| `calendar-query` with `time-range` | the series that have at least one occurrence in the range, found with the same expansion the REST `occurrences` endpoint uses (so DST and exclusions are right) |

Times stay as the model has them: wall-clock in the event's IANA zone. On the way out an event is written with `TZID=<IANA name>`; on the way in a `TZID` that is not an IANA name is mapped as the importer already does, or refused with the reason.

## Interfaces and placement

- A new package `api/internal/dav` holds the CalDAV `Backend` over `events`, `calendars` and `ics`, plus Basic-token authentication. `httpapi` mounts it under `/dav/` and `/.well-known/caldav`; it is **not** part of `routes()` (those are `/api` routes with an OpenAPI contract), and the OpenAPI file and `docs/caldav.md` say where CalDAV lives and that it is outside that contract.
- Library: `github.com/emersion/go-webdav` (CalDAV server and client; MIT; the author of `go-ical`, which the project already uses). Pinned to a released version. If a needed behaviour is missing or wrong, the code in `internal/dav` fills it rather than forking the library.
- Caddy: `/dav/*` and `/.well-known/caldav` are proxied to the api like `/api/*` (all methods, including `PROPFIND`, `REPORT`, `OPTIONS`; no compression; no web CSP headers). The web app does not link to it except from Settings (see below).
- Web: one small Settings addition under Access tokens: the CalDAV address to paste into a client (`https://<host>/dav/`), the user name to use, and a sentence that the password is an access token. No other UI **(my call)**.
- Security posture is unchanged: no trusting forwarded headers except from the trusted proxy; nothing external is loaded; another person's data is a 404.

## Testing and acceptance

- **Go tests** drive the handler with the library's own **CalDAV client** over `httptest`: discovery (principal, home-set, calendars), listing with ETags, `GET`, create by `PUT`, update with `If-Match`, the 412 on a stale ETag, `If-None-Match: *`, delete, `calendar-query` with a `time-range` that crosses a DST change and an exclusion, `calendar-multiget`, and each refusal above with its precondition. Recurrence round-trips: a series with an exclusion and a changed occurrence created through the REST API reads back through CalDAV with the same `EXDATE` and `RECURRENCE-ID`, and the reverse.
- **Privacy tests:** another user's principal, calendar and resource are 404; a token revoked mid-session stops working; the account password and a session token are refused; a wrong password is rate limited like logins.
- **A real third-party client:** run python's `caldav` library from a throwaway container against the running stack (list calendars, save a recurring event, search a date range, edit, delete) and confirm the result in the web app. The command and its output are recorded in the plan's last task.
- The existing suites (Go, web unit, Playwright) must stay green.

## Known limits (said plainly in `docs/caldav.md`)

- No `sync-collection`/`getctag`: clients re-list; fine for a personal calendar, slower for a very large one.
- No `VTIMEZONE` blocks (IANA `TZID`s only), as in `.ics` export. Apple Calendar tends to accept this for standard zones; strict clients may not. Libraries do.
- One calendar per collection and no moving events between calendars through CalDAV.
- Resource names must equal `{UID}.ics`.
- Access tokens give full access (there are no read-only tokens yet), so a CalDAV token can do everything the REST API can except manage tokens.

## Left to the builder

- Whether the library's REPORT handling covers `calendar-multiget` as needed, or `internal/dav` serves it.
- The exact ETag format and the Basic-auth plumbing, as long as the behaviour above holds.
- How `If-Match` is carried into `Import` (a field on `Imported`, a separate function): inside one transaction, per AGENTS.md.
- The wording of `docs/caldav.md` and the Settings text.
