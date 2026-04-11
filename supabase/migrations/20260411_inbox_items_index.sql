-- Composite index to speed up the primary inbox query:
-- SELECT * FROM inbox_items WHERE user_id = ? AND status = 'pending'
-- ORDER BY priority DESC, created_at DESC
-- Without this, Postgres does a seq scan filtered by user_id then sorts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_items_user_status_priority
ON inbox_items (user_id, status, priority DESC, created_at DESC);
