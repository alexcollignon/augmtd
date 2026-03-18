-- Phase 60: Persist generating state on work_threads so the UI survives refreshes
ALTER TABLE work_threads ADD COLUMN IF NOT EXISTS is_generating BOOLEAN NOT NULL DEFAULT false;

-- Safety net: clear any stuck state from before this migration
UPDATE work_threads SET is_generating = false WHERE is_generating = true;
