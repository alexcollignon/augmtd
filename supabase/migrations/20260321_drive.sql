-- Drive feature: folders + upload support for knowledge_files

CREATE TABLE drive_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES drive_folders(id) ON DELETE CASCADE,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  system_key  TEXT,   -- 'workflows' | 'processes'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drive_folders_user_id ON drive_folders(user_id);

ALTER TABLE drive_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_folders" ON drive_folders FOR ALL USING (user_id = auth.uid());

ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS folder_id    UUID REFERENCES drive_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

CREATE INDEX idx_knowledge_files_folder_id ON knowledge_files(folder_id);
