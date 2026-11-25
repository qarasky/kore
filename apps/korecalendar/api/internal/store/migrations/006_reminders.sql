-- One row per (reminder, channel). 'pending' = claimed but not yet delivered
-- (retried until it succeeds or attempts run out); 'sent' = done or given up.
CREATE TABLE reminder_deliveries (
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  key TEXT NOT NULL,
  minutes_before INTEGER NOT NULL,
  channel TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  fire_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (event_id, key, minutes_before, channel)
);
CREATE INDEX reminder_deliveries_state ON reminder_deliveries(state, fire_at);
