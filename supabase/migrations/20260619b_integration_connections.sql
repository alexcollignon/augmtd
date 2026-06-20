-- Integration connections (Nango-backed). Nango is the source of truth for the
-- OAuth tokens (self-hosted); this is the lightweight local record for UX + "which
-- integrations exist" + scope.
--
-- SCOPE matters: some integrations are personal (per-user), some are shared team
-- surfaces (per-company). Slack is COMPANY-scoped — one workspace install, shared
-- by the whole company; the AI coworkers post through one bot as per-coworker
-- personas (so a coworker appears once in a channel, never once-per-user).
--   scope='company'  → one row per (company_id, provider); Nango connection_id = company_id
--   scope='user'     → one row per (user_id, provider);    Nango connection_id = user_id
--
-- This migration is IDEMPOTENT and upgrade-safe: re-running it on a DB that
-- already has the earlier per-user version of this table adds the scope columns,
-- swaps the old unique constraint for scoped partial indexes, and replaces the
-- RLS policy.

-- Fresh DBs get the full shape here; existing tables are upgraded by the ALTERs below.
CREATE TABLE IF NOT EXISTS integration_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- who connected it
  company_id          UUID,                                  -- set for company-scoped providers
  scope               TEXT NOT NULL DEFAULT 'company',        -- 'company' | 'user'
  provider            TEXT NOT NULL,                          -- 'slack' | …
  nango_connection_id TEXT NOT NULL,                          -- = company_id (company) or user_id (user)
  status              TEXT NOT NULL DEFAULT 'active',          -- active | error | revoked
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { workspace_name, scopes, … }
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade an already-created (per-user) table to the scoped shape.
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'company';
-- Old per-user unique constraint is replaced by the scoped partial indexes below.
ALTER TABLE integration_connections DROP CONSTRAINT IF EXISTS integration_connections_user_id_provider_key;

-- One connection per scope key + provider.
CREATE UNIQUE INDEX IF NOT EXISTS ic_company_provider_uq ON integration_connections (company_id, provider) WHERE scope = 'company';
CREATE UNIQUE INDEX IF NOT EXISTS ic_user_provider_uq    ON integration_connections (user_id, provider)    WHERE scope = 'user';
CREATE INDEX IF NOT EXISTS integration_connections_company_idx ON integration_connections (company_id);
CREATE INDEX IF NOT EXISTS integration_connections_user_id_idx ON integration_connections (user_id);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

-- Read: the connector, or any active member of the company (for company scope).
-- Writes are intentionally NOT granted to authenticated users — connect/disconnect
-- go through service-role API routes that check the owner/admin role explicitly.
DROP POLICY IF EXISTS "integration_connections: owner full access" ON integration_connections;   -- old per-user policy
DROP POLICY IF EXISTS "integration_connections: read own or company" ON integration_connections;
CREATE POLICY "integration_connections: read own or company"
  ON integration_connections
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      scope = 'company' AND company_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM company_members cm
        WHERE cm.company_id = integration_connections.company_id
          AND cm.user_id = auth.uid()
          AND cm.status = 'active'
      )
    )
  );
