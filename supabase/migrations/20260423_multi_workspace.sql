-- Phase 1: allow users to belong to multiple workspaces
-- Adds workspace_id to user-scoped tables and is_template_code to companies.

-- 1a. Template-code flag on companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_template_code BOOLEAN NOT NULL DEFAULT FALSE;

-- 1b. workspace_id columns (nullable during migration window)
ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE custom_agents
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE work_threads
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- 1c. Backfill workspace_id from each user's current active membership
UPDATE connections c
SET workspace_id = cm.company_id
FROM company_members cm
WHERE cm.user_id = c.user_id
  AND cm.status = 'active'
  AND c.workspace_id IS NULL;

UPDATE inbox_items i
SET workspace_id = cm.company_id
FROM company_members cm
WHERE cm.user_id = i.user_id
  AND cm.status = 'active'
  AND i.workspace_id IS NULL;

UPDATE custom_agents a
SET workspace_id = cm.company_id
FROM company_members cm
WHERE cm.user_id = a.user_id
  AND cm.status = 'active'
  AND a.workspace_id IS NULL;

UPDATE work_threads t
SET workspace_id = cm.company_id
FROM company_members cm
WHERE cm.user_id = t.user_id
  AND cm.status = 'active'
  AND t.workspace_id IS NULL;

-- 1d. Indexes
CREATE INDEX IF NOT EXISTS idx_connections_workspace   ON connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace   ON inbox_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_custom_agents_workspace ON custom_agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_work_threads_workspace  ON work_threads(workspace_id);
