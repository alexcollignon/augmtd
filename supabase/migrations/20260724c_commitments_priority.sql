-- WORKBENCH B4 (docs/workbench-plan.md) — the human's MANUAL priority on a task.
-- The spine honors it as an OVERRIDE of the computed weight ('high' floors at 85, 'low' caps at 15)
-- — a human's hand outranks the machine, permanently (the project_locked rule).
-- Additive + idempotent; the spine's read degrades to no-overrides until this is applied.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS priority TEXT NULL
  CHECK (priority IS NULL OR priority IN ('high', 'low'));
