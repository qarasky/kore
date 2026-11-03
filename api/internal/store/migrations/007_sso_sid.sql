-- Kore ID session id ("sid" claim of the id token) of a session created by an
-- SSO login, so a back-channel logout can end exactly the sessions of that
-- Kore ID sign-in. NULL for password sessions and pre-existing SSO sessions.
-- The Kore ID subject is not copied here: it is users.sub of the session's user.
ALTER TABLE sessions ADD COLUMN sid TEXT;
CREATE INDEX sessions_sid ON sessions(sid) WHERE sid IS NOT NULL;
