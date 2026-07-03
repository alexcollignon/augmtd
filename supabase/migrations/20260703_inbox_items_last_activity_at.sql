-- last_activity_at: the freshness signal for an inbox item's underlying thread.
--
-- Problem: an inbox_items row is created once (created_at = first-seen) and only its
-- source_data is mutated when a NEW message lands on the same thread. The Home brief ordered
-- items by created_at DESC, so a genuinely-hot thread that got a fresh reply still looked
-- three-weeks-old and was treated as stale. updated_at exists but is bumped by ANY write
-- (labeling, draft-sweep, dismissals) so it is not a clean thread-activity signal.
--
-- Fix: a dedicated column stamped by the email sync to the newest message's received_at on
-- every create/update path. The brief orders by it so a fresh reply re-surfaces the thread.
-- Defaults to (and is backfilled from) created_at so pre-existing rows keep a sane value and
-- ordering by it is never null.

ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Backfill: prefer the newest message time already stored in source_data (the true thread
-- activity), else fall back to created_at. The regex guard keeps a malformed received_at from
-- aborting the whole UPDATE (only ISO-ish leading timestamps are cast; anything else → created_at).
-- Safe to re-run.
UPDATE inbox_items
SET last_activity_at = COALESCE(
  CASE
    WHEN source_data->>'received_at' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
      THEN (source_data->>'received_at')::timestamptz
    ELSE NULL
  END,
  created_at
)
WHERE last_activity_at IS NULL;

-- Keep the default sensible for any row inserted without an explicit value.
ALTER TABLE inbox_items
  ALTER COLUMN last_activity_at SET DEFAULT NOW();

-- Ordering index for the Home brief (user + pending, freshest activity first).
CREATE INDEX IF NOT EXISTS idx_inbox_items_user_status_activity
  ON inbox_items (user_id, status, last_activity_at DESC);
