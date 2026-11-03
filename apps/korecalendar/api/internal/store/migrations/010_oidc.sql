-- Sign-in with Kore ID: the provider's stable subject for a user (NULL for
-- password-only accounts), the id token kept for RP-initiated logout, and the
-- short-lived server-side state of logins in progress.
ALTER TABLE users ADD COLUMN oidc_sub TEXT;
CREATE UNIQUE INDEX users_oidc_sub ON users(oidc_sub) WHERE oidc_sub IS NOT NULL;

ALTER TABLE sessions ADD COLUMN id_token TEXT NOT NULL DEFAULT '';

CREATE TABLE oidc_flows (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  next TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
