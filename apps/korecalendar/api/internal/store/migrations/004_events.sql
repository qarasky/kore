CREATE TABLE events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_local TEXT NOT NULL,
  end_local TEXT NOT NULL,
  tz TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  rrule TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NULL
);
CREATE INDEX events_user_live ON events(user_id, deleted_at);
CREATE INDEX events_calendar ON events(calendar_id);

CREATE TABLE event_exdates (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  PRIMARY KEY (event_id, key)
);

CREATE TABLE event_rdates (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  start_local TEXT NOT NULL,
  PRIMARY KEY (event_id, start_local)
);

-- override_key '' holds the series' own reminders; otherwise the occurrence key
-- of an override that sets its own.
CREATE TABLE event_reminders (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  override_key TEXT NOT NULL DEFAULT '',
  minutes_before INTEGER NOT NULL,
  PRIMARY KEY (event_id, override_key, minutes_before)
);

CREATE TABLE idempotency_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  body_sha TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  response TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Sync feed: one row per mutation, read by GET /api/changes.
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('upsert','delete')),
  at INTEGER NOT NULL
);
CREATE INDEX changes_user_seq ON changes(user_id, seq);
