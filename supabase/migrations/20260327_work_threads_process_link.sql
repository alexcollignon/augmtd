-- Phase 82: Link work_threads to processes for inline Studio panel
ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES processes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS process_step_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_work_threads_process_id
  ON work_threads(process_id) WHERE process_id IS NOT NULL;
