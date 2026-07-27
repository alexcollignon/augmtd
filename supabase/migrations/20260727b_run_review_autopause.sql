-- Auto-pause unattended tasks: a scheduled task pauses itself after 3 consecutive
-- unreviewed runs and resumes when the user catches up (opens the task thread) or
-- hits Resume. "Reviewed" = the user opened the task's thread; stamped by the
-- thread chat GET, checked in runWorkflow's success path.

-- Per-run review receipt.
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Presence = the task was paused automatically for lack of review (as opposed to
-- a manual pause). Cleared on auto-resume AND on manual resume.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS auto_paused_at TIMESTAMPTZ;

-- Backfill: treat all history as reviewed so counting starts fresh — without
-- this, nearly every scheduled task would pause on its next run (3 old
-- unreviewed runs already exist).
UPDATE workflow_runs SET reviewed_at = completed_at
WHERE reviewed_at IS NULL AND status = 'succeeded';

-- The pause check reads "recent unreviewed succeeded runs per workflow".
CREATE INDEX IF NOT EXISTS idx_workflow_runs_unreviewed
  ON workflow_runs(workflow_id, completed_at DESC)
  WHERE status = 'succeeded' AND reviewed_at IS NULL;

-- No new RLS: workflow_runs has no user UPDATE policy (writes via service role),
-- and the review-stamp/auto-resume paths use the admin client server-side.
