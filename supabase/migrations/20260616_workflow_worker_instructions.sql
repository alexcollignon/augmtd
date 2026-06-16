-- Add task-level worker instructions to workflows
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS worker_instructions TEXT;
