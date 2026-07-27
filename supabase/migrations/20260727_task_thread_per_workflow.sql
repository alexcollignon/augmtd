-- One persistent work_thread per task (workflow) per user, instead of one per run.
-- Run threads used to be created fresh on every run, flooding the worker's
-- Conversations list. From now on runWorkflow finds-or-creates a single active
-- thread per (workflow_id, user_id); report-backs append to it like a DM thread.
--
-- 1) Archive all but the most recent ACTIVE workflow thread per (workflow_id, user_id).
--    Required before the unique index can be created (historical runs each made one).
--    Archived threads disappear from the Conversations list only (it filters
--    status='active'); Drive, Ready-for-you and the chat GET don't filter status,
--    so old artifacts stay visible and old threads stay openable.
UPDATE work_threads wt
SET status = 'archived'
WHERE wt.workflow_id IS NOT NULL
  AND wt.status = 'active'
  AND wt.id NOT IN (
    SELECT DISTINCT ON (workflow_id, user_id) id
    FROM work_threads
    WHERE workflow_id IS NOT NULL AND status = 'active'
    ORDER BY workflow_id, user_id, updated_at DESC
  );

-- 2) Enforce one active thread per task per user (find-or-create race backstop).
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_threads_workflow_user_active
  ON work_threads(workflow_id, user_id)
  WHERE status = 'active' AND workflow_id IS NOT NULL;
