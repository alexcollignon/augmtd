-- Link executable inbox items to their work thread
-- When a user opens an executable item in Workflows, we create a work thread
-- and store the reference here to avoid creating duplicate threads.

ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS work_thread_id UUID REFERENCES work_threads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_items_work_thread
  ON inbox_items(work_thread_id)
  WHERE work_thread_id IS NOT NULL;

COMMENT ON COLUMN inbox_items.work_thread_id IS 'Work thread created when user opens this executable item in Workflows. Used to avoid duplicate thread creation.';
