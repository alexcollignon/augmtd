ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workflows_pinned
  ON workflows (user_id, pinned) WHERE pinned = true;
