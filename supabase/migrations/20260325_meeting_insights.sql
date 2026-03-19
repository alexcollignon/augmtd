-- Phase 62: Meeting insights — summary, decisions, key moments
ALTER TABLE meeting_transcripts
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS decisions JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS key_moments JSONB DEFAULT '[]';

-- Add 'upload' source for audio file uploads via capture page
ALTER TABLE meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_source_check;
ALTER TABLE meeting_transcripts ADD CONSTRAINT meeting_transcripts_source_check
  CHECK (source IN ('bot', 'recording', 'upload'));
