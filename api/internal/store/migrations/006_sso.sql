-- Kore ID (OIDC) login. users.sub is the provider's stable subject (the same
-- in every Kore app); NULL for accounts that never signed in with it.
ALTER TABLE users ADD COLUMN sub TEXT;
CREATE UNIQUE INDEX users_sub ON users(sub) WHERE sub IS NOT NULL;

-- Sessions created by an SSO login keep the id token (for RP-initiated
-- logout) and the rotating refresh token (to notice a revoked or disabled
-- account). checked_at is when the refresh token was last redeemed.
ALTER TABLE sessions ADD COLUMN id_token TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN refresh_token TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0;

-- In-flight authorization requests (one row per login attempt, single use).
CREATE TABLE oidc_flows (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  next TEXT NOT NULL,
  link_user_id TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL
);
