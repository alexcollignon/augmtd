-- Change knowledge_files unique constraint from (source_id, provider_file_id)
-- to (user_id, provider_file_id) so the same Drive/OneDrive file indexed from
-- multiple folder sources only produces one row per user.

-- Step 1: remove duplicate rows — keep the most recently indexed row per (user_id, provider_file_id)
DELETE FROM knowledge_files
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, provider_file_id) id
  FROM knowledge_files
  ORDER BY user_id, provider_file_id, indexed_at DESC
);

-- Step 2: drop old constraint (auto-named by Postgres)
ALTER TABLE knowledge_files
  DROP CONSTRAINT IF EXISTS knowledge_files_source_id_provider_file_id_key;

-- Step 3: add new constraint
ALTER TABLE knowledge_files
  ADD CONSTRAINT knowledge_files_user_id_provider_file_id_key
  UNIQUE (user_id, provider_file_id);
