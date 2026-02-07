-- ==========================================
-- AUGMTD Work State Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- ==========================================

-- Add work-state columns to inbox_items
ALTER TABLE inbox_items
ADD COLUMN IF NOT EXISTS work_state TEXT CHECK (work_state IN (
  'work_prepared',
  'decision_required',
  'waiting',
  'no_work'
)),
ADD COLUMN IF NOT EXISTS work_title TEXT,
ADD COLUMN IF NOT EXISTS what_i_prepared TEXT,
ADD COLUMN IF NOT EXISTS why_matters TEXT;

-- Create index for work_state queries
CREATE INDEX IF NOT EXISTS idx_inbox_work_state ON inbox_items(user_id, work_state, status);

-- Set default work_state based on existing data
-- This ensures backward compatibility with existing inbox items
UPDATE inbox_items
SET work_state = CASE
  WHEN ai_suggestion_type IN ('action_required', 'question') THEN 'work_prepared'
  WHEN ai_suggestion_type = 'decision' THEN 'decision_required'
  WHEN ai_suggestion_type IN ('newsletter', 'promotional', 'social', 'other') THEN 'no_work'
  ELSE 'work_prepared'
END
WHERE work_state IS NULL;

-- Set work_title from existing subject
UPDATE inbox_items
SET work_title = CASE
  WHEN source_data->>'draftReply' IS NOT NULL THEN 'Reply to ' || (source_data->>'from_name')
  WHEN source_data->>'calendarEvent' IS NOT NULL THEN 'Schedule with ' || (source_data->>'from_name')
  ELSE 'Review email from ' || (source_data->>'from_name')
END
WHERE work_title IS NULL;

-- Set what_i_prepared from existing data
UPDATE inbox_items
SET what_i_prepared = CASE
  WHEN source_data->>'draftReply' IS NOT NULL THEN 'Draft reply ready'
  WHEN source_data->>'calendarEvent' IS NOT NULL THEN 'Calendar event prepared'
  WHEN source_data->'actionItems' IS NOT NULL THEN 'Action items extracted'
  ELSE 'Summary and key points'
END
WHERE what_i_prepared IS NULL;

-- Set why_matters from existing summary
UPDATE inbox_items
SET why_matters = source_data->>'summary'
WHERE why_matters IS NULL AND source_data->>'summary' IS NOT NULL;

COMMENT ON COLUMN inbox_items.work_state IS 'Work state: work_prepared (AI can prepare it), decision_required (needs judgment), waiting (blocked), no_work (FYI only)';
COMMENT ON COLUMN inbox_items.work_title IS 'User-facing work title (e.g., "Reply to John Smith")';
COMMENT ON COLUMN inbox_items.what_i_prepared IS 'What AI prepared (e.g., "Draft to schedule call")';
COMMENT ON COLUMN inbox_items.why_matters IS 'Why this work matters (context for user)';
