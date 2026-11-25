# KoreCalendar API guide

The API is the product: the web app and the Android app use exactly these endpoints, and so can an AI agent or a script.
The full contract is [`openapi.yaml`](openapi.yaml), also served at `GET /api/openapi.json` with no login. This guide shows
the common jobs with real requests and responses.

Examples use `$B` for the server address, `$AUTH` for a signed-in credential (a Kore ID access token, or the session cookie's token) and `$TOK` for an access token.

## Get a token

Sign-in is **Kore ID only**: open `$B` in a browser and continue with Kore ID. There is no email + password login and no first-run
form. On a fresh install, the first sign-in whose verified email is the server's `KORECAL_OIDC_OWNER_EMAIL` becomes the administrator;
everyone else is provisioned as a normal user on first sign-in. `GET /api/auth/config` says which provider (if any) the server offers:

```bash
curl -s $B/api/auth/config
```

```json
{"first_user_sso":true,"oidc":{"name":"Kore ID","issuer":"https://id.kore.example","login_url":"/api/auth/oidc/login","client_id":"korecalendar","account_url":"https://id.kore.example/account","apps":{"korecalendar":"https://calendar.example.com/"}}}
```

`oidc` is `null` when the operator has not configured a provider, and then nobody can sign in. The browser flow sets a session cookie.
A script that can obtain a Kore ID **access token** (header `typ: at+jwt`, audience `korecalendar`) can send it as the bearer instead:
it counts as a session. Kore ID id tokens are refused.

That session is short-lived. For an agent, create a long-lived, revocable access token with it (an access token cannot create or
revoke tokens, so a leaked one cannot mint more). The secret is shown once:

```bash
curl -s $B/api/tokens -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' -d '{"name":"claude"}'
```

```json
{"id":"7c2c450703d876b457b3ad372fdf4a45","name":"claude","token":"kcal_HL6C4M9C…"}
```

From now on send `Authorization: Bearer $TOK`. Every event records who last changed it: `"user"` for a session, or the token's
name (here `claude`).

Prefer a standard protocol? The same calendars are served over CalDAV: see [caldav.md](caldav.md).

## Things to know first

- **Times are wall-clock strings in the event's own zone.** `"2026-11-04T16:00:00"` with `"tz":"Europe/Berlin"` means 16:00 in Berlin,
  winter or summer. All-day events use dates (`"2026-12-24"`), and their `end` is exclusive. Set your default zone with
  `PATCH /api/me {"timezone":"Europe/Berlin"}`; events without a `tz` use it.
- **You never expand recurrence yourself.** Ask `GET /api/occurrences` for a time range and you get concrete instances, with
  exclusions and one-off changes applied.
- **An occurrence's key is its original start.** To touch one occurrence of a series, pass it as `?occurrence=`. The key does not
  change when that occurrence is moved to another time.
- **Errors are always** `{"error":{"code":"…","message":"…"}}`. The `code` is stable; branch on it. They are listed in
  `x-error-codes` in the OpenAPI file.
- **All-day events are dates.** Their `start`/`end` are dates in the event's `tz`, and their `start_utc`/`end_utc` are local midnight in that
  zone, so a request for one local day returns only that day's all-day events.
- **Another person's data is a 404**, never a 403.

## Create a recurring event

`calendar_id` defaults to your first calendar and `end` to one hour after `start`. Add an `Idempotency-Key` so a retry
cannot create a second copy:

```bash
curl -s $B/api/events -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H 'Idempotency-Key: 7d2f' -d '{
  "title": "Gym", "start": "2026-11-04T16:00:00", "end": "2026-11-04T17:00:00", "tz": "Europe/Berlin",
  "rrule": "FREQ=WEEKLY;BYDAY=WE,FR", "reminders": [{"minutes_before": 30}]
}'
```

```json
{"id":"7be76c26e03ea81b5e7f0b740ad6a80d","calendar_id":"2773b36b1461fde4e1e2a166e01557f0","title":"Gym","notes":"","location":"","start":"2026-11-04T16:00:00","end":"2026-11-04T17:00:00","tz":"Europe/Berlin","all_day":false,"rrule":"FREQ=WEEKLY;BYDAY=WE,FR","rdates":[],"exdates":[],"reminders":[{"minutes_before":30}],"version":1,"created_by":"claude","updated_by":"claude","created_at":1793614940,"updated_at":1793614940}
```

Sending the same request again with the same key returns this same response (header `Idempotent-Replayed: true`) and creates nothing.
The same key with a different body is `409 idempotency_conflict`.

Supported rules: daily, weekly, monthly and yearly repeats with `INTERVAL`, `COUNT` or `UNTIL`, `BYDAY` (including `2TU`, `-1FR` on
monthly and yearly repeats), `BYMONTHDAY`, `BYMONTH`, `BYSETPOS`, `WKST`, plus `rdates` for extra dates. Anything else (hourly,
`BYWEEKNO`, …) and anything that would otherwise be read differently than written (`COUNT=0`, `INTERVAL=0`, `FREQ=WEEKLY;BYDAY=2TU`)
is `422 unsupported_rrule`; nothing is silently approximated.

## Skip one occurrence

`DELETE` with `scope=this` adds an exclusion and leaves the rest of the series alone:

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOK" "$B/api/events/$ID?scope=this&occurrence=2026-11-06T16:00:00"
```

```json
{"id":"7be76c26e03ea81b5e7f0b740ad6a80d","calendar_id":"2773b36b1461fde4e1e2a166e01557f0","title":"Gym","notes":"","location":"","start":"2026-11-04T16:00:00","end":"2026-11-04T17:00:00","tz":"Europe/Berlin","all_day":false,"rrule":"FREQ=WEEKLY;BYDAY=WE,FR","rdates":[],"exdates":["2026-11-06T16:00:00"],"reminders":[{"minutes_before":30}],"version":2,"created_by":"claude","updated_by":"claude","created_at":1793614940,"updated_at":1793614940}
```

## Change one occurrence

`PATCH` with `scope=this` stores a change for just that occurrence. Changing `start` without `end` keeps the duration.
Here the 11 November session moves two hours later and gets a new title. `If-Match` makes the edit safe against a concurrent change:

```bash
curl -s -X PATCH -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H 'If-Match: "2"' \
  -d '{"start":"2026-11-11T18:00:00","title":"Gym (late)"}' "$B/api/events/$ID?scope=this&occurrence=2026-11-11T16:00:00"
```

The response is the series again, with `"version":3`. A stale `If-Match` is rejected and changes nothing:

```json
{"error":{"code":"version_conflict","message":"the event was changed since you read it; fetch it again"}}
```

## Change this and all later occurrences

`scope=following` ends the old series just before the occurrence and starts a new one from it, carrying the edit. The new series is
returned as `created`; exclusions and one-off changes from that date on move to it.

```bash
curl -s -X PATCH -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"location":"Park"}' "$B/api/events/$ID?scope=following&occurrence=2026-11-18T16:00:00"
```

```json
{"id":"7be76c26e03ea81b5e7f0b740ad6a80d","title":"Gym","start":"2026-11-04T16:00:00","rrule":"FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261118T145959Z","exdates":["2026-11-06T16:00:00"],"version":4,"created":{"id":"4abef505a18fa4bb388a579c7918c1c5","title":"Gym","location":"Park","start":"2026-11-18T16:00:00","end":"2026-11-18T17:00:00","rrule":"FREQ=WEEKLY;BYDAY=WE,FR","exdates":[],"version":1}}
```

(Abbreviated: the real response has every event field.) On the first occurrence, `following` is the same as `all`.
To move an event to another calendar, `PATCH` it with `calendar_id` (for the whole series, or `following`; a single occurrence stays in its calendar).
`DELETE` takes the same scopes. A full `DELETE` is a soft delete that you can undo for 30 days with `POST /api/events/{id}/restore`. Deleting a calendar
(`DELETE /api/calendars/{id}?force=1`, required when it still has events) is undoable the same way with `POST /api/calendars/{id}/restore`,
which brings back the events deleted with it.

If you change the schedule of a whole series (start, zone, rule), changes to individual occurrences that no longer match are dropped,
and listed in `dropped_overrides`.

## List what is happening

```bash
curl -s -H "Authorization: Bearer $TOK" "$B/api/occurrences?from=2026-11-02T00:00:00Z&to=2026-11-14T00:00:00Z"
```

```json
[{"event_id":"7be76c26e03ea81b5e7f0b740ad6a80d","key":"2026-11-04T16:00:00","title":"Gym","start":"2026-11-04T16:00:00","end":"2026-11-04T17:00:00","tz":"Europe/Berlin","is_recurring":true,"is_override":false,"start_utc":"2026-11-04T15:00:00Z","end_utc":"2026-11-04T16:00:00Z","reminders":[{"minutes_before":30}]},
 {"event_id":"7be76c26e03ea81b5e7f0b740ad6a80d","key":"2026-11-11T16:00:00","title":"Gym (late)","start":"2026-11-11T18:00:00","end":"2026-11-11T19:00:00","tz":"Europe/Berlin","is_recurring":true,"is_override":true,"start_utc":"2026-11-11T17:00:00Z","end_utc":"2026-11-11T18:00:00Z","reminders":[{"minutes_before":30}]},
 {"event_id":"7be76c26e03ea81b5e7f0b740ad6a80d","key":"2026-11-13T16:00:00","title":"Gym","start":"2026-11-13T16:00:00","end":"2026-11-13T17:00:00","tz":"Europe/Berlin","is_recurring":true,"is_override":false,"start_utc":"2026-11-13T15:00:00Z","end_utc":"2026-11-13T16:00:00Z","reminders":[{"minutes_before":30}]}]
```

The 6 November session is gone (excluded), the 11th shows its change, and the rest of the series is untouched. (Fields trimmed:
the real response also has `calendar_id`, `notes`, `location` and `all_day`.) Add `q=` to search text and `calendar_id=` to filter. A
request may span at most 400 days and 5000 occurrences (`range_too_large`).

## Keep a client in sync

```bash
curl -s -H "Authorization: Bearer $TOK" "$B/api/changes?since=0"
```

```json
{"cursor":5,"upserted":[{"id":"7be76c26e03ea81b5e7f0b740ad6a80d","title":"Gym","version":4},{"id":"4abef505a18fa4bb388a579c7918c1c5","title":"Gym","version":1}],"deleted":[],"more":false}
```

(Events abbreviated.) Each event appears once in its latest state. Keep the final `cursor` and send it as `since` next time; while
`more` is true, ask again with the new cursor. `deleted` holds ids to drop locally.

## Import and export `.ics`

```bash
curl -s -H "Authorization: Bearer $TOK" -H 'Content-Type: text/calendar' --data-binary @calendar.ics "$B/api/import"
curl -s -H "Authorization: Bearer $TOK" "$B/api/export" > calendar.ics
```

An event that cannot be imported is reported while the others still go in. Importing a file again updates events with the same UID instead of duplicating them:

```json
{"created":1,"errors":[{"index":0,"uid":"hourly@example.com","reason":"only daily, weekly, monthly and yearly repeats are supported"},{"index":2,"uid":"nostart@example.com","reason":"the event has no DTSTART"},{"index":3,"uid":"byweek@example.com","reason":"BYWEEKNO, BYYEARDAY and BYEASTER are not supported"}],"imported":1,"updated":0,"warnings":[]}
```

Export writes IANA `TZID`s without `VTIMEZONE` blocks; Google Calendar and Apple Calendar accept that.

## Reminders

Give an event `reminders` (minutes before the start; `0` is at the start, up to 28 days). The server sends them, de-duplicated, even
across restarts:

- **Browsers:** register with `GET /api/push/key` and `POST /api/push/subscriptions`. Browsers only allow push on HTTPS, so
  put the server behind a tunnel or Tailscale HTTPS.
- **The Android app** schedules its own alarms from `/api/occurrences` and `/api/changes`, so it needs no push service. An event added
  just before it starts may reach the phone late.

For an all-day event, reminders count back from midnight at the start of its first day in the event's zone.

## Limits

400 days or 5000 occurrences per `/api/occurrences` call, 20 reminders per event, 5 MB per `.ics` import, 24 hours for an `Idempotency-Key`,
30 days to restore a deleted event. Logging in is limited to 5 wrong attempts per email and address (30 per address) in 15 minutes.
