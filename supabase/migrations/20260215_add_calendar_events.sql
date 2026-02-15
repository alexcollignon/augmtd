-- Add calendar_events table for storing calendar events from Gmail and Outlook
-- This table stores events synced from the same connections as emails

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,

  -- Event identifiers
  event_id TEXT NOT NULL,              -- Provider's event ID (Gmail/Outlook)
  calendar_id TEXT,                    -- Which calendar (usually 'primary')
  icaluid TEXT,                        -- iCalendar UID for recurring events

  -- Event details
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  meeting_link TEXT,                   -- Extracted Zoom/Meet/Teams links

  -- Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  timezone TEXT,
  is_all_day BOOLEAN DEFAULT FALSE,

  -- Participants
  organizer TEXT,                      -- Email of organizer
  attendees JSONB DEFAULT '[]',        -- [{email, name, status: 'accepted'|'declined'|'tentative'}]

  -- Status
  status TEXT DEFAULT 'confirmed',     -- 'confirmed' | 'cancelled' | 'tentative'
  recurring_event_id TEXT,             -- Link to recurring event series

  -- Provider info
  provider TEXT NOT NULL,              -- 'gmail' | 'outlook'
  metadata JSONB DEFAULT '{}',         -- Full event data from provider

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicates
  UNIQUE(user_id, event_id, provider)
);

-- Indexes for common queries
CREATE INDEX idx_calendar_events_user ON calendar_events(user_id);
CREATE INDEX idx_calendar_events_user_time ON calendar_events(user_id, start_time);
CREATE INDEX idx_calendar_events_upcoming ON calendar_events(user_id, start_time)
  WHERE start_time > NOW() AND status != 'cancelled';
CREATE INDEX idx_calendar_events_provider ON calendar_events(user_id, provider);
CREATE INDEX idx_calendar_events_connection ON calendar_events(connection_id);

-- RLS policies
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own calendar events"
  ON calendar_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own calendar events"
  ON calendar_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own calendar events"
  ON calendar_events FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own calendar events"
  ON calendar_events FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_calendar_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_calendar_events_timestamp
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_events_updated_at();

-- Add meeting_behavior profile type to context_profiles constraint
ALTER TABLE context_profiles DROP CONSTRAINT IF EXISTS valid_profile_type;
ALTER TABLE context_profiles ADD CONSTRAINT valid_profile_type CHECK (profile_type IN (
  'identity',
  'email_communication',
  'domain_knowledge',
  'slack_communication',
  'meeting_behavior',
  'work_patterns',
  'relationships'
));
