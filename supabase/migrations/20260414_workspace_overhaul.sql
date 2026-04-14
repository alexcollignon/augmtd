-- ============================================================================
-- Phase 122: Workspace overhaul
--   - companies.type (company | beta | pilot | internal)
--   - companies.features (JSONB: email, meetings, drive, agents)
--   - companies.status extended with 'deleting' (concurrent-delete safety)
--   - Backfill + NOT NULL on companies.join_code
--   - profiles.needs_join flag (for OAuth first-time signups)
--   - audit_logs table (superadmin-read, service-role-write)
--   - generate_join_code() helper
--   - AUGMTD internal workspace auto-created
--   - Orphan users auto-assigned to AUGMTD workspace
-- ============================================================================

-- 1. companies.type ----------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'company'
    CHECK (type IN ('company', 'beta', 'pilot', 'internal'));

CREATE INDEX IF NOT EXISTS idx_companies_type ON companies(type);

-- 2. companies.features (JSONB) ---------------------------------------------
-- Default: all modules enabled. Admin opts OUT via UI.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT
    '{"email":true,"meetings":true,"drive":true,"agents":true}'::jsonb;

UPDATE companies
  SET features = '{"email":true,"meetings":true,"drive":true,"agents":true}'::jsonb
  WHERE features IS NULL OR features = '{}'::jsonb;

-- 3. Extend companies.status to include 'deleting' --------------------------
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_status_check;
ALTER TABLE companies ADD CONSTRAINT companies_status_check
  CHECK (status IN ('active', 'suspended', 'deleting'));

-- 4. join_code helper + backfill + NOT NULL ---------------------------------
CREATE OR REPLACE FUNCTION generate_join_code() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I for UX
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars))::INT + 1, 1);
  END LOOP;
  RETURN result;
END $$;

DO $$
DECLARE
  r RECORD;
  candidate TEXT;
BEGIN
  FOR r IN SELECT id FROM companies WHERE join_code IS NULL LOOP
    LOOP
      candidate := generate_join_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE join_code = candidate);
    END LOOP;
    UPDATE companies SET join_code = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE companies ALTER COLUMN join_code SET NOT NULL;

-- 5. profiles.needs_join flag -----------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS needs_join BOOLEAN NOT NULL DEFAULT false;

-- 6. audit_logs table -------------------------------------------------------
-- Drop legacy audit_logs from the initial supabase-schema.sql (unused; it
-- referenced a non-existent `organizations` table and had no code writing to
-- it). Safe: no consumers in the codebase. We recreate fresh below.
DROP TABLE IF EXISTS audit_logs CASCADE;

CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email    TEXT,
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      UUID,
  workspace_id   UUID REFERENCES companies(id) ON DELETE SET NULL,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created
  ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs(actor_user_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_service_write" ON audit_logs;
CREATE POLICY "audit_logs_service_write" ON audit_logs FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "audit_logs_superadmin_read" ON audit_logs;
CREATE POLICY "audit_logs_superadmin_read" ON audit_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_super_admin = true
  ));

-- 7. AUGMTD internal workspace + orphan auto-assign -------------------------
DO $$
DECLARE
  augmtd_id UUID;
  orphan_code TEXT;
BEGIN
  -- Create AUGMTD internal workspace if it doesn't exist
  SELECT id INTO augmtd_id FROM companies WHERE slug = 'augmtd-internal' LIMIT 1;

  IF augmtd_id IS NULL THEN
    LOOP
      orphan_code := generate_join_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE join_code = orphan_code);
    END LOOP;

    INSERT INTO companies (name, slug, plan, type, status, features, join_code)
    VALUES (
      'AUGMTD',
      'augmtd-internal',
      'enterprise',
      'internal',
      'active',
      '{"email":true,"meetings":true,"drive":true,"agents":true}'::jsonb,
      orphan_code
    )
    RETURNING id INTO augmtd_id;
  END IF;

  -- Assign every user without an active company_members row to AUGMTD as 'member'
  INSERT INTO company_members (company_id, user_id, role, status)
  SELECT augmtd_id, p.id, 'member'::company_role, 'active'
    FROM profiles p
    LEFT JOIN company_members cm
      ON cm.user_id = p.id AND cm.status = 'active'
    WHERE cm.id IS NULL
  ON CONFLICT (company_id, user_id) DO NOTHING;

  -- Sync denormalized profiles.company_id for those newly-assigned orphans
  UPDATE profiles p
    SET company_id = augmtd_id
    WHERE p.company_id IS NULL
      AND EXISTS (
        SELECT 1 FROM company_members cm
        WHERE cm.user_id = p.id
          AND cm.company_id = augmtd_id
          AND cm.status = 'active'
      );
END $$;
