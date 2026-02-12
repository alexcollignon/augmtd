-- Migration: Add user confirmation and visual section fields
-- Purpose: Support new UX with Prepared/Suggested/Awareness sections and user confirmations

-- Add user_confirmation field to track user decisions
ALTER TABLE inbox_items
ADD COLUMN IF NOT EXISTS user_confirmation JSONB DEFAULT NULL;

-- Add visual_section field (derived from suggestionLevel)
ALTER TABLE inbox_items
ADD COLUMN IF NOT EXISTS visual_section TEXT
  CHECK (visual_section IN ('prepared', 'suggested', 'awareness'))
  DEFAULT NULL;

-- Add index for visual_section for fast filtering
CREATE INDEX IF NOT EXISTS idx_inbox_items_visual_section
  ON inbox_items(visual_section)
  WHERE visual_section IS NOT NULL;

-- Add index for user_confirmation status for tracking confirmations
CREATE INDEX IF NOT EXISTS idx_inbox_items_user_confirmation
  ON inbox_items((user_confirmation->>'status'))
  WHERE user_confirmation IS NOT NULL;

-- Add comment explaining user_confirmation structure
COMMENT ON COLUMN inbox_items.user_confirmation IS
'User confirmation state for suggested work items. Structure:
{
  "status": "pending" | "confirmed" | "rejected" | null,
  "confirmedAt": "ISO timestamp",
  "confirmedAction": "confirm_as_mine" | "not_my_task",
  "previousSuggestionLevel": "suggested" (for learning)
}';

-- Add comment explaining visual_section
COMMENT ON COLUMN inbox_items.visual_section IS
'UI section where this item should appear:
- "prepared": High confidence (≥60%), ready to act
- "suggested": Medium confidence (40-60%), needs user confirmation
- "awareness": Low confidence (<40%), FYI only
Derived from recipient_context.suggestionLevel';

-- Helper function: Calculate visual section from suggestion level
CREATE OR REPLACE FUNCTION calculate_visual_section(suggestion_level TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE
    WHEN suggestion_level = 'assigned' THEN 'prepared'
    WHEN suggestion_level = 'suggested' THEN 'suggested'
    WHEN suggestion_level IN ('review', 'fyi') THEN 'awareness'
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper function: Update visual_section based on recipient_context
CREATE OR REPLACE FUNCTION update_visual_section()
RETURNS TRIGGER AS $$
BEGIN
  -- Extract suggestionLevel from recipient_context and calculate visual_section
  IF NEW.recipient_context IS NOT NULL AND NEW.recipient_context ? 'suggestionLevel' THEN
    NEW.visual_section := calculate_visual_section(NEW.recipient_context->>'suggestionLevel');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update visual_section when recipient_context changes
DROP TRIGGER IF EXISTS trigger_update_visual_section ON inbox_items;
CREATE TRIGGER trigger_update_visual_section
  BEFORE INSERT OR UPDATE OF recipient_context
  ON inbox_items
  FOR EACH ROW
  EXECUTE FUNCTION update_visual_section();

-- Backfill visual_section for existing items with recipient_context
UPDATE inbox_items
SET visual_section = calculate_visual_section(recipient_context->>'suggestionLevel')
WHERE recipient_context IS NOT NULL
  AND recipient_context ? 'suggestionLevel'
  AND visual_section IS NULL;
