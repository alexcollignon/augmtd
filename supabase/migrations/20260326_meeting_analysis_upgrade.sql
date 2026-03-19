-- Phase 62: Meeting Analysis Upgrade
-- Adds risks and suggested_next_step to meeting_transcripts

ALTER TABLE meeting_transcripts
  ADD COLUMN IF NOT EXISTS risks JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS suggested_next_step TEXT;
