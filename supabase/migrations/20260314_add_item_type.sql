-- Add item_type column for semantic email classification
ALTER TABLE inbox_items
ADD COLUMN IF NOT EXISTS item_type TEXT
  CHECK (item_type IN ('reply', 'decision', 'meeting', 'review', 'fyi', 'notification'));

-- Index for smart view filtering
CREATE INDEX IF NOT EXISTS idx_inbox_items_item_type
  ON inbox_items(item_type)
  WHERE item_type IS NOT NULL;

-- Drop old trigger that auto-wrote visual_section from recipient_context
-- (visual_section is now a legacy column; we keep it but stop writing it)
DROP TRIGGER IF EXISTS trigger_update_visual_section ON inbox_items;
