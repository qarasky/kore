CREATE INDEX nodes_trash_root ON nodes(trash_root) WHERE trash_root IS NOT NULL;
CREATE INDEX nodes_trashed_at ON nodes(trashed_at) WHERE trashed_at IS NOT NULL;
