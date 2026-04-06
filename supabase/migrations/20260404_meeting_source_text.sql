-- Phase 94: Add 'text' source type for text-only meeting notes (no recording)
ALTER TABLE meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_source_check;
ALTER TABLE meeting_transcripts ADD CONSTRAINT meeting_transcripts_source_check
  CHECK (source IN ('bot', 'recording', 'upload', 'text'));
