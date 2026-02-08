-- Migration: Update work_state constraint to support cognitive cost levels
-- Adds 'noted' and 'noise' states, keeps backward compatibility with 'no_work'

-- Drop the old constraint
ALTER TABLE inbox_items
DROP CONSTRAINT IF EXISTS inbox_items_work_state_check;

-- Add new constraint with all valid states
ALTER TABLE inbox_items
ADD CONSTRAINT inbox_items_work_state_check
CHECK (work_state IN (
  'work_prepared',     -- Judgment now (email domain)
  'action_required',   -- Execution to prevent downside (external + high stakes)
  'decision_required', -- Choice under uncertainty (multiple options)
  'waiting',           -- Blocked on external input
  'noted',             -- Awareness only (low stakes)
  'noise',             -- Hidden completely
  'no_work'            -- Legacy: Kept for backward compatibility
));

-- Optional: Migrate existing 'no_work' items to 'noted'
-- Uncomment if you want to migrate old data:
-- UPDATE inbox_items SET work_state = 'noted' WHERE work_state = 'no_work';

-- Create index for filtering by cognitive cost level
CREATE INDEX IF NOT EXISTS idx_inbox_cognitive_level
ON inbox_items(user_id, work_state)
WHERE work_state IN ('work_prepared', 'decision_required', 'noted');

COMMENT ON COLUMN inbox_items.work_state IS
'Work states: work_prepared (judgment via email), action_required (execution to prevent downside), decision_required (choice under uncertainty), waiting (blocked), noted (awareness only), noise (hidden)';
