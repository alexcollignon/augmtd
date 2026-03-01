-- Add artifacts array column to work_threads for multi-artifact support
ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS artifacts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill existing single artifacts into the new array with a generated id
UPDATE work_threads
SET artifacts = jsonb_build_array(
  artifact || jsonb_build_object('id', gen_random_uuid()::text)
)
WHERE artifact IS NOT NULL
  AND (artifacts = '[]'::jsonb OR artifacts IS NULL);

-- Keep old artifact column for safety — drop in a follow-up migration after bake period
