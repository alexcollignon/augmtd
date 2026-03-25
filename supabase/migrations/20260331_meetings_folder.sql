ALTER TABLE calendar_events
  ADD COLUMN folder_id UUID REFERENCES drive_folders(id) ON DELETE SET NULL;

ALTER TABLE meeting_transcripts
  ADD COLUMN folder_id UUID REFERENCES drive_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_calendar_events_folder_id ON calendar_events(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX idx_meeting_transcripts_folder_id ON meeting_transcripts(folder_id) WHERE folder_id IS NOT NULL;
