-- Quota sums and the user-delete checks filter nodes by uploader; the
-- orphan-blob sweep looks nodes up by blob_id.
CREATE INDEX IF NOT EXISTS nodes_uploader ON nodes(uploader);
CREATE INDEX IF NOT EXISTS nodes_blob ON nodes(blob_id) WHERE blob_id IS NOT NULL;
