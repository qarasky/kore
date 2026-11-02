-- One changed occurrence of a series, keyed by the occurrence's original
-- (nominal) wall-time start. NULL columns inherit from the series.
CREATE TABLE event_overrides (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  title TEXT NULL,
  notes TEXT NULL,
  location TEXT NULL,
  start_local TEXT NULL,
  end_local TEXT NULL,
  all_day INTEGER NULL,
  reminders_set INTEGER NOT NULL DEFAULT 0, -- 1: the rows in event_reminders with this key replace the series' reminders
  PRIMARY KEY (event_id, key)
);
