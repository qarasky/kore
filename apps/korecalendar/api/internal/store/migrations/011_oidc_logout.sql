-- Kore ID back-channel logout: the Kore ID session id (sid) a local session
-- came from, the logout tokens already used (replay protection until they
-- expire), and Kore ID sessions that ended, so their still-valid access tokens
-- are refused as bearer tokens too.
ALTER TABLE sessions ADD COLUMN oidc_sid TEXT NOT NULL DEFAULT '';
CREATE INDEX sessions_oidc_sid ON sessions(oidc_sid) WHERE oidc_sid <> '';

CREATE TABLE oidc_logout_jti (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE oidc_ended_sids (
  sid TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
