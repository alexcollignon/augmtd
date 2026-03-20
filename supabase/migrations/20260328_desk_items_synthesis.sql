-- Phase 65: On Your Desk — Work Synthesis
-- Adds thread collapsing (one card per email thread), synthesis text, and metadata.

-- New columns
ALTER TABLE desk_items
  ADD COLUMN IF NOT EXISTS thread_key    TEXT,
  ADD COLUMN IF NOT EXISTS source_refs   JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS synthesis     TEXT,
  ADD COLUMN IF NOT EXISTS synthesis_at  TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS email_count   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS has_prepared  BOOLEAN NOT NULL DEFAULT false;

-- Drop old single unique constraint
ALTER TABLE desk_items
  DROP CONSTRAINT IF EXISTS desk_items_user_id_source_type_source_id_key;

-- Partial unique index for email thread cards (keyed on thread_key)
CREATE UNIQUE INDEX IF NOT EXISTS desk_items_thread_unique
  ON desk_items(user_id, thread_key)
  WHERE thread_key IS NOT NULL;

-- Partial unique index for non-thread items (meeting_action, process_step, manual)
CREATE UNIQUE INDEX IF NOT EXISTS desk_items_source_unique
  ON desk_items(user_id, source_type, source_id)
  WHERE thread_key IS NULL;

-- Index for synthesis polling
CREATE INDEX IF NOT EXISTS idx_desk_items_synthesis
  ON desk_items(user_id, synthesis_at)
  WHERE synthesis IS NULL;

-- Index for thread_key lookups
CREATE INDEX IF NOT EXISTS idx_desk_items_thread_key
  ON desk_items(user_id, thread_key)
  WHERE thread_key IS NOT NULL;
