-- ─── Replace boolean shared_with_company with three-value sharing_mode ──────────
-- 'live'     = teammates run the owner's copy; notifications go to the runner
-- 'template' = teammates must clone before running; each gets their own editable copy
-- NULL       = private (not shared)

-- 1. Workflows
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS sharing_mode TEXT
    CHECK (sharing_mode IN ('live'))
    DEFAULT NULL;

-- Backfill: existing shared workflows become 'live'
UPDATE workflows SET sharing_mode = 'live' WHERE shared_with_company = true;

DROP INDEX IF EXISTS idx_workflows_company_shared;
CREATE INDEX IF NOT EXISTS idx_workflows_company_shared
  ON workflows (company_id) WHERE sharing_mode IS NOT NULL;

-- Update RLS to use sharing_mode
DROP POLICY IF EXISTS "workflows_company_read" ON workflows;
CREATE POLICY "workflows_company_read" ON workflows FOR SELECT
  USING (
    sharing_mode IS NOT NULL
    AND company_id IN (
      SELECT company_id FROM company_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- 2. Custom agents
ALTER TABLE custom_agents
  ADD COLUMN IF NOT EXISTS sharing_mode TEXT
    CHECK (sharing_mode IN ('live'))
    DEFAULT NULL;

UPDATE custom_agents SET sharing_mode = 'live' WHERE shared_with_company = true;

DROP INDEX IF EXISTS idx_custom_agents_company_shared;
CREATE INDEX IF NOT EXISTS idx_custom_agents_company_shared
  ON custom_agents (company_id) WHERE sharing_mode IS NOT NULL;

DROP POLICY IF EXISTS "custom_agents_company_read" ON custom_agents;
CREATE POLICY "custom_agents_company_read" ON custom_agents FOR SELECT
  USING (
    sharing_mode IS NOT NULL
    AND company_id IN (
      SELECT company_id FROM company_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );
