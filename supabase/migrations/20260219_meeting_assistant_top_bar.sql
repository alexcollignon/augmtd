-- Meeting Assistant: support top bar categories and fix missing inbox_items columns
--
-- Context: The inbox top bar now surfaces meeting-sourced inbox items grouped by
-- category (todo, waiting_for, project). This migration:
--   1. Adds columns that bot-manager.ts already inserts but were missing from schema
--   2. Adds indexes for the top bar query pattern (filter by source='meeting')
--   3. Backfills existing meeting items

-- ─────────────────────────────────────────────────────────────
-- 1. inbox_items: add missing columns
-- ─────────────────────────────────────────────────────────────

-- Links a meeting-sourced inbox item back to its source transcript
ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS source_meeting_transcript_id UUID
    REFERENCES meeting_transcripts(id) ON DELETE SET NULL;

-- Marks items created automatically by the meeting assistant (vs user-created)
ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false;

-- Backfill: all existing meeting-sourced items are auto-generated
UPDATE inbox_items
SET auto_generated = true
WHERE source = 'meeting'
  AND auto_generated = false;

-- ─────────────────────────────────────────────────────────────
-- 2. Indexes for top bar query patterns
-- ─────────────────────────────────────────────────────────────

-- Fast fetch of all pending meeting assistant items for a user (top bar query)
CREATE INDEX IF NOT EXISTS idx_inbox_items_meeting_source
  ON inbox_items(user_id, status)
  WHERE source = 'meeting';

-- Fast grouping by category inside source_data JSONB
CREATE INDEX IF NOT EXISTS idx_inbox_items_meeting_category
  ON inbox_items((source_data->>'category'))
  WHERE source = 'meeting' AND status = 'pending';

-- Fast lookup from transcript → its generated inbox items
CREATE INDEX IF NOT EXISTS idx_inbox_items_transcript_id
  ON inbox_items(source_meeting_transcript_id)
  WHERE source_meeting_transcript_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. meeting_transcripts: index for looking up by calendar event
-- ─────────────────────────────────────────────────────────────

-- Already queried in meeting-detail-panel by calendar_event_id
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_calendar_event
  ON meeting_transcripts(calendar_event_id, user_id)
  WHERE calendar_event_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 4. Comments
-- ─────────────────────────────────────────────────────────────

COMMENT ON COLUMN inbox_items.source_meeting_transcript_id IS
  'References the meeting_transcript that generated this item. NULL for non-meeting sources.';

COMMENT ON COLUMN inbox_items.auto_generated IS
  'True when the item was created automatically by the meeting assistant or email AI, false when user-created.';
