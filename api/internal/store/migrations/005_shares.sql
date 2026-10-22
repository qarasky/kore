-- Public share links. The token is stored raw (not hashed) so an owner can
-- copy their link again later; anyone able to read this table can already
-- read every blob on the volume, so hashing it would protect nothing.
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NULL,
  password_hash TEXT NULL,
  revoked_at INTEGER NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER NULL
);
CREATE INDEX shares_node ON shares(node_id);
CREATE INDEX shares_created_by ON shares(created_by);
