-- Deleted calendars are hidden, not removed, for 30 days (like events), so one
-- mistaken call cannot destroy a whole calendar for good.
ALTER TABLE calendars ADD COLUMN deleted_at INTEGER NULL;
-- 1 on events that were deleted together with their calendar, so restoring the
-- calendar brings back exactly those and not events deleted earlier.
ALTER TABLE events ADD COLUMN deleted_with_calendar INTEGER NOT NULL DEFAULT 0;
