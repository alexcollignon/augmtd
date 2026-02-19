-- Add meeting status and metadata for meeting lifecycle management
-- Separates meeting state from email work_state (conceptually different)

-- Add meeting_status field to calendar_events
ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS meeting_status TEXT DEFAULT 'upcoming' CHECK (
  meeting_status IN ('upcoming', 'starting_soon', 'in_progress', 'completed')
);

-- Add meeting_metadata for follow-up tracking
ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS meeting_metadata JSONB DEFAULT '{
  "follow_up_generated": false,
  "follow_up_item_id": null,
  "completed_at": null,
  "last_status_update": null,
  "auto_hide_after": null
}'::jsonb;

-- Index for querying meetings by status
CREATE INDEX IF NOT EXISTS idx_calendar_events_meeting_status
  ON calendar_events(user_id, meeting_status, start_time);

-- Function to calculate meeting status based on start/end times
CREATE OR REPLACE FUNCTION calculate_meeting_status(
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
) RETURNS TEXT AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_minutes_until_start NUMERIC;
BEGIN
  -- Meeting has ended
  IF v_now >= p_end_time THEN
    RETURN 'completed';
  END IF;

  -- Meeting is happening now
  IF v_now >= p_start_time AND v_now < p_end_time THEN
    RETURN 'in_progress';
  END IF;

  -- Calculate minutes until meeting starts
  v_minutes_until_start := EXTRACT(EPOCH FROM (p_start_time - v_now)) / 60;

  -- Meeting starts within 60 minutes
  IF v_minutes_until_start <= 60 THEN
    RETURN 'starting_soon';
  END IF;

  -- Meeting is in the future
  RETURN 'upcoming';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update meeting statuses (can be called periodically or on-demand)
CREATE OR REPLACE FUNCTION update_meeting_statuses()
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  UPDATE calendar_events
  SET
    meeting_status = calculate_meeting_status(start_time, end_time),
    meeting_metadata = jsonb_set(
      meeting_metadata,
      '{last_status_update}',
      to_jsonb(NOW())
    )
  WHERE
    status = 'confirmed' -- Only update confirmed events
    AND meeting_status != calculate_meeting_status(start_time, end_time); -- Only if status changed

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate meeting_status on insert/update
CREATE OR REPLACE FUNCTION auto_calculate_meeting_status()
RETURNS TRIGGER AS $$
BEGIN
  NEW.meeting_status := calculate_meeting_status(NEW.start_time, NEW.end_time);
  NEW.meeting_metadata := jsonb_set(
    COALESCE(NEW.meeting_metadata, '{}'::jsonb),
    '{last_status_update}',
    to_jsonb(NOW())
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_calculate_meeting_status ON calendar_events;
CREATE TRIGGER trigger_auto_calculate_meeting_status
  BEFORE INSERT OR UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_meeting_status();

-- Mark completed meetings for auto-hide after 24 hours
CREATE OR REPLACE FUNCTION mark_completed_meetings_for_hide()
RETURNS INTEGER AS $$
DECLARE
  v_marked_count INTEGER := 0;
BEGIN
  UPDATE calendar_events
  SET meeting_metadata = jsonb_set(
    meeting_metadata,
    '{auto_hide_after}',
    to_jsonb(NOW() + INTERVAL '24 hours')
  )
  WHERE
    meeting_status = 'completed'
    AND meeting_metadata->>'completed_at' IS NULL;

  -- Also set completed_at timestamp
  UPDATE calendar_events
  SET meeting_metadata = jsonb_set(
    meeting_metadata,
    '{completed_at}',
    to_jsonb(NOW())
  )
  WHERE
    meeting_status = 'completed'
    AND meeting_metadata->>'completed_at' IS NULL;

  GET DIAGNOSTICS v_marked_count = ROW_COUNT;
  RETURN v_marked_count;
END;
$$ LANGUAGE plpgsql;

-- Update all existing calendar events to have meeting_status calculated
DO $$
BEGIN
  PERFORM update_meeting_statuses();
END $$;

-- Comments for documentation
COMMENT ON COLUMN calendar_events.meeting_status IS 'Current status based on time: upcoming, starting_soon, in_progress, completed';
COMMENT ON COLUMN calendar_events.meeting_metadata IS 'Meeting lifecycle data: follow-up generation, completion time, auto-hide timing';
COMMENT ON FUNCTION calculate_meeting_status IS 'Calculates meeting status based on start/end times relative to current time';
COMMENT ON FUNCTION update_meeting_statuses IS 'Updates all meeting statuses - can be called periodically via cron';
COMMENT ON FUNCTION mark_completed_meetings_for_hide IS 'Marks completed meetings to auto-hide after 24 hours';
