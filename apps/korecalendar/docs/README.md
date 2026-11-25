# Documentation

**For people running it**

- [deploy.md](deploy.md): install on Linux with Docker, HTTPS, updates, backups and restore, troubleshooting.
- [android.md](android.md): the Android app: install the APK, sign in, the Agenda widget, offline behaviour, troubleshooting.
- [web.md](web.md): what the web app does: views, editing recurring events, drag and keyboard, motion, time zones, notifications, known limits.

**For agents, scripts and integrations**

- [api.md](api.md): the REST API by example (tokens, events, recurrence scopes, occurrences, sync, `.ics`, reminders).
- [openapi.yaml](openapi.yaml): the contract (also served at `GET /api/openapi.json`).
- [caldav.md](caldav.md): the same calendars over CalDAV (`/dav/`): connecting, how it maps, what a `PUT` keeps, limits.

**For contributors** (see also [../AGENTS.md](../AGENTS.md) and [../web/README.md](../web/README.md))

- [releasing.md](releasing.md): versioning, image tags, how a release is cut and published (server and Android).
- [superpowers/specs/](superpowers/specs/): the designs, with the decisions and who made them:
  [overall design](superpowers/specs/2026-11-02-korecalendar-design.md), [CalDAV](superpowers/specs/2026-11-02-caldav-design.md),
  [web motion](superpowers/specs/2026-11-02-web-motion-design.md) (with the references behind every number), [Android](superpowers/specs/2026-11-03-android-design.md).
- [superpowers/plans/](superpowers/plans/): the implementation plans that were executed (phase 1 API, phase 2 web, CalDAV, Android stage 1).
