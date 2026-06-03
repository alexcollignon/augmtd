-- Dedicated meeting_folders table — separate from drive_folders
CREATE TABLE IF NOT EXISTS meeting_folders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE meeting_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their meeting folders"
  ON meeting_folders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Migrate existing meeting folders from drive_folders (preserve IDs so folder_id FKs stay valid)
INSERT INTO meeting_folders (id, user_id, name, created_at)
SELECT id, user_id, name, created_at
FROM drive_folders
WHERE system_key = 'meetings'
ON CONFLICT (id) DO NOTHING;

-- Re-point meeting_transcripts.folder_id from drive_folders → meeting_folders
ALTER TABLE meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_folder_id_fkey;
ALTER TABLE meeting_transcripts
  ADD CONSTRAINT meeting_transcripts_folder_id_fkey
  FOREIGN KEY (folder_id) REFERENCES meeting_folders(id) ON DELETE SET NULL;

-- Re-point calendar_events.folder_id from drive_folders → meeting_folders
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_folder_id_fkey;
ALTER TABLE calendar_events
  ADD CONSTRAINT calendar_events_folder_id_fkey
  FOREIGN KEY (folder_id) REFERENCES meeting_folders(id) ON DELETE SET NULL;

-- Remove migrated rows from drive_folders
DELETE FROM drive_folders WHERE system_key = 'meetings';
