-- Add auto_generated flag to work_threads
-- true  = created by background prepare-from-email pipeline (inbox-driven, hidden from Workflows sidebar)
-- false = created manually by the user in the Workflows page

ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_work_threads_auto_generated
  ON work_threads(user_id, auto_generated);
