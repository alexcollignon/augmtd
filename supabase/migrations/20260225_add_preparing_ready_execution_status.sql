-- Expand execution_status CHECK constraint to include 'preparing' and 'ready'
-- These are used by the background prepare-from-email pipeline:
--   preparing = pipeline is running (show spinner)
--   ready     = deliverable generated, ready to view (show "See prepared work")

ALTER TABLE inbox_items
  DROP CONSTRAINT IF EXISTS inbox_items_execution_status_check;

ALTER TABLE inbox_items
  ADD CONSTRAINT inbox_items_execution_status_check CHECK (
    execution_status IS NULL OR
    execution_status IN (
      'queued', 'preparing', 'running', 'awaiting_approval',
      'completed', 'failed', 'cancelled', 'ready'
    )
  );
