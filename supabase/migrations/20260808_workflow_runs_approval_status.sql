-- THE APPROVAL STEP (production arc step 2): a run can PARK at a human gate
-- (`awaiting_approval`) and be explicitly held back (`rejected`). Apply manually in the
-- Supabase dashboard SQL editor. Until applied, approval steps cannot park — safe: no existing
-- workflow contains one (the pilot outcome contract), and the smoke gate asserts the code path
-- only.

ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'awaiting_approval', 'rejected'));
