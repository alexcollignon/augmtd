-- Add execution capabilities to inbox_items
-- Enables work decomposition and AI execution for deliverable requests

-- Add execution fields to inbox_items table
ALTER TABLE inbox_items
ADD COLUMN IF NOT EXISTS is_executable BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS execution_plan JSONB,
ADD COLUMN IF NOT EXISTS execution_status TEXT CHECK (
  execution_status IS NULL OR
  execution_status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')
),
ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS artifacts JSONB DEFAULT '[]'::jsonb;

-- Add index for querying executable items
CREATE INDEX IF NOT EXISTS idx_inbox_items_executable
  ON inbox_items(user_id, is_executable, execution_status)
  WHERE is_executable = true;

-- Add index for execution queue (items ready to execute)
CREATE INDEX IF NOT EXISTS idx_inbox_items_execution_queue
  ON inbox_items(user_id, execution_status, created_at)
  WHERE is_executable = true AND execution_status = 'queued';

-- Comments for documentation
COMMENT ON COLUMN inbox_items.is_executable IS 'Whether this work item can be executed by AI (e.g., generate report, create presentation)';
COMMENT ON COLUMN inbox_items.execution_plan IS 'Structured execution plan with steps, skills, and data sources. Format: {deliverable_type, deliverable_description, steps: [{number, action, skill, status}], estimated_time, deadline}';
COMMENT ON COLUMN inbox_items.execution_status IS 'Current execution state: queued (ready to start), running (in progress), awaiting_approval (needs human review), completed (done), failed (error), cancelled (stopped by user)';
COMMENT ON COLUMN inbox_items.current_step IS 'Index of currently executing step (0-based). Used to track progress through execution_plan.steps';
COMMENT ON COLUMN inbox_items.artifacts IS 'Generated files and outputs from execution. Format: [{type, name, url, size, created_at}]';

-- Example execution_plan structure:
-- {
--   "deliverable_type": "report",
--   "deliverable_description": "Q1 Revenue Excel report with charts",
--   "deadline": "2026-02-21T17:00:00Z",
--   "estimated_time": "5 minutes",
--   "steps": [
--     {
--       "number": 1,
--       "action": "Pull Q1 financial data from database",
--       "skill": "data_pull",
--       "status": "pending"
--     },
--     {
--       "number": 2,
--       "action": "Generate revenue analysis and charts",
--       "skill": "excel_generator",
--       "status": "pending"
--     },
--     {
--       "number": 3,
--       "action": "Create Excel workbook with formatted data",
--       "skill": "excel_generator",
--       "status": "pending"
--     },
--     {
--       "number": 4,
--       "action": "Draft email response with attachment",
--       "skill": "email_drafter",
--       "status": "pending"
--     }
--   ]
-- }

-- Example artifacts structure:
-- [
--   {
--     "type": "excel",
--     "name": "Q1_Revenue_Report.xlsx",
--     "url": "https://storage.../q1-report.xlsx",
--     "size": 49152,
--     "created_at": "2026-02-17T14:30:00Z"
--   }
-- ]
