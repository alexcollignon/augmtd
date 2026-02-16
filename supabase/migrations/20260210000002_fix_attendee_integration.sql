-- Fix Attendee integration to use API key approach (not OAuth)

-- Remove OAuth-related fields from profiles
ALTER TABLE profiles
  DROP COLUMN IF EXISTS attendee_token,
  DROP COLUMN IF EXISTS attendee_refresh_token,
  DROP COLUMN IF EXISTS attendee_user_id,
  DROP COLUMN IF EXISTS attendee_workspace_id,
  DROP COLUMN IF EXISTS attendee_connected_at;

-- Keep only the enabled flag
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS attendee_enabled BOOLEAN DEFAULT false;

-- Add bot_id to calendar_events to track Attendee bots
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS attendee_bot_id TEXT,
  ADD COLUMN IF NOT EXISTS attendee_bot_state TEXT,
  ADD COLUMN IF NOT EXISTS attendee_bot_created_at TIMESTAMPTZ;

-- Update meeting_transcripts table for simpler structure
ALTER TABLE meeting_transcripts
  DROP COLUMN IF EXISTS attendee_meeting_id;

ALTER TABLE meeting_transcripts
  ADD COLUMN IF NOT EXISTS attendee_bot_id TEXT,
  ADD COLUMN IF NOT EXISTS bot_state TEXT,
  ADD COLUMN IF NOT EXISTS transcript_segments JSONB;

-- Add index for bot polling
CREATE INDEX IF NOT EXISTS idx_calendar_events_attendee_bot_state
  ON calendar_events(attendee_bot_state, start_time)
  WHERE attendee_bot_id IS NOT NULL;

-- Add index for transcript processing
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_processed
  ON meeting_transcripts(processed, created_at)
  WHERE processed = false;
