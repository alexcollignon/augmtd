-- ─── Team sharing: shared_with_company on workflows + custom_agents ──────────
-- Adds a shared_with_company flag so power users can share their agents and
-- workflows with all members of their company. Live-shared: owner edits
-- propagate instantly. Reads only — non-owners cannot modify shared records.
-- Also adds per-user agent memory table so each user builds independent memory
-- when using a shared agent.

-- 1. Add company_id + shared_with_company to workflows
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shared_with_company BOOLEAN NOT NULL DEFAULT false;

-- Backfill company_id from company_members (single-workspace design)
UPDATE workflows w
SET company_id = cm.company_id
FROM company_members cm
WHERE cm.user_id = w.user_id
  AND cm.status = 'active'
  AND w.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflows_company_shared
  ON workflows (company_id) WHERE shared_with_company = true;

-- 2. Add shared_with_company to custom_agents (company_id already exists from migration 20260413)
ALTER TABLE custom_agents
  ADD COLUMN IF NOT EXISTS shared_with_company BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_custom_agents_company_shared
  ON custom_agents (company_id) WHERE shared_with_company = true;

-- 3. Extend RLS SELECT policies to allow company-member reads of shared records

-- Workflows: drop the single owner policy and recreate as two separate policies
DROP POLICY IF EXISTS "workflows_owner_all" ON workflows;
CREATE POLICY "workflows_owner_all" ON workflows
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "workflows_company_read" ON workflows
  FOR SELECT
  USING (
    shared_with_company = true
    AND company_id IN (
      SELECT company_id FROM company_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Custom agents: recreate owner policy + add shared read policy
DROP POLICY IF EXISTS "custom_agents: owner full access" ON custom_agents;
DROP POLICY IF EXISTS "custom_agents_owner_all" ON custom_agents;
CREATE POLICY "custom_agents_owner_all" ON custom_agents
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "custom_agents_company_read" ON custom_agents
  FOR SELECT
  USING (
    shared_with_company = true
    AND company_id IN (
      SELECT company_id FROM company_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- 4. Per-user agent memory table
-- Stores personal memory for non-owners using a shared agent.
-- Owner memory stays in custom_agents.memory_text (unchanged).
CREATE TABLE IF NOT EXISTS agent_memories (
  agent_id   UUID NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  memory_text TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, user_id)
);

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_memories_owner" ON agent_memories
  FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_agent_memories_user ON agent_memories (user_id);
