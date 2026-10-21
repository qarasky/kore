-- Last activity on an upload session (creation or last persisted chunk);
-- the janitor sweeps sessions idle for longer than its threshold.
ALTER TABLE uploads ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE uploads SET updated_at = created_at;
CREATE INDEX uploads_updated_at ON uploads(updated_at);
