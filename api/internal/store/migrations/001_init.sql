CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  quota_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  space_owner TEXT NULL REFERENCES users(id),
  uploader TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT NULL,
  name TEXT NOT NULL,
  is_dir INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  blob_id TEXT NULL,
  mime TEXT NOT NULL DEFAULT '',
  trashed_at INTEGER NULL,
  trash_root TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- NULLs are distinct in SQLite unique indexes, so coalesce them.
CREATE UNIQUE INDEX nodes_unique_live_name
  ON nodes(COALESCE(space_owner,''), COALESCE(parent_id,''), name)
  WHERE trashed_at IS NULL;

CREATE INDEX nodes_parent ON nodes(parent_id);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_owner TEXT NULL,
  parent_id TEXT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  received_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
