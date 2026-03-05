-- Add file_ids column to knowledge_sources
-- NULL = index entire folder recursively
-- Set = index only those specific provider file IDs
ALTER TABLE knowledge_sources ADD COLUMN file_ids TEXT[];
