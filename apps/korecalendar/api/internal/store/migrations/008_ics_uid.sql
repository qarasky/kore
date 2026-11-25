-- The UID of the .ics event an event was imported from, so importing the same
-- file again updates events instead of duplicating them.
ALTER TABLE events ADD COLUMN ics_uid TEXT NULL;
CREATE UNIQUE INDEX events_ics_uid ON events(user_id, ics_uid) WHERE ics_uid IS NOT NULL;
