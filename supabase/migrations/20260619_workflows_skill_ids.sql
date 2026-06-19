-- Per-task skill pinning. When a task (workflow) has skill_ids, those skills are
-- enforced on its deliverable-producing AI step (overriding the worker's assigned
-- skills for that task). Empty/[] → fall back to the worker's assigned skills.
-- See lib/workflows/execute-step.ts (executeAIStep worker branch).
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS skill_ids JSONB DEFAULT '[]'::jsonb;
