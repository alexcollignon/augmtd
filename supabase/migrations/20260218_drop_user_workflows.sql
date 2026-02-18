-- Drop user_workflows table — superseded by work_threads
-- work_threads stores the same data (plan JSONB with inputs/steps/outputs)
-- plus the full conversation history that created the workflow
DROP TABLE IF EXISTS user_workflows CASCADE;
