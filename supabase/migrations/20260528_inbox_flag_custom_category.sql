-- Flag emails + custom smart categories + per-user settings store

-- Per-user settings (custom categories, section order, preferences)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_category TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_flagged
  ON inbox_items(user_id, is_flagged, created_at DESC)
  WHERE is_flagged = TRUE;

CREATE INDEX IF NOT EXISTS idx_inbox_custom_category
  ON inbox_items(user_id, custom_category, created_at DESC)
  WHERE custom_category IS NOT NULL;
