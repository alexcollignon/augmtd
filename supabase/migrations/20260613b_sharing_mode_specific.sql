-- Extend sharing_mode to support per-person sharing
ALTER TABLE meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_sharing_mode_check;
ALTER TABLE meeting_transcripts ADD CONSTRAINT meeting_transcripts_sharing_mode_check
  CHECK (sharing_mode IN ('live', 'specific'));
