-- Phase 61: Meeting recordings support
-- Distinguish bot-captured vs in-app recorded transcripts

ALTER TABLE meeting_transcripts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'bot'
    CHECK (source IN ('bot', 'recording')),
  ADD COLUMN IF NOT EXISTS recording_storage_path TEXT;

-- Bucket: meeting-recordings is created by the presign route on first use
-- (same pattern as drive-uploads)
