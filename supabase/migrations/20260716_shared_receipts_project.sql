-- Meetings→Projects unification: a SHARED meeting is filed per-recipient (projects are per-user), so the
-- recipient's project membership for a shared note needs its own column — the direct analogue of the
-- per-recipient `folder_id` it replaces. ON DELETE SET NULL: un-grouping the recipient's project just
-- un-files the shared note, never touches access.
ALTER TABLE shared_note_receipts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS shared_note_receipts_project_idx ON shared_note_receipts (project_id) WHERE project_id IS NOT NULL;
