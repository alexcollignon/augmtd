ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS content_hash CHAR(64);

-- Partial unique index: NULL allowed for existing rows and Drive-synced files
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_files_user_content_hash_idx
  ON knowledge_files(user_id, content_hash)
  WHERE content_hash IS NOT NULL;
