-- Add is_temporary flag to work_threads.
-- Temporary threads are deleted on navigation away or page load cleanup.

ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN NOT NULL DEFAULT FALSE;
