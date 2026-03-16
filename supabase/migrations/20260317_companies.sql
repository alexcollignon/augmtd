-- Phase 51A: Company / Team Layer
-- Creates companies, company_members, company_invitations tables
-- and adds company_id to profiles.

-- ── companies ────────────────────────────────────────────────────────────────

CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,   -- url-safe lowercase: "acme-consulting"
  plan        TEXT NOT NULL DEFAULT 'starter'
                CHECK (plan IN ('starter', 'growth', 'enterprise')),
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── company_members ───────────────────────────────────────────────────────────

CREATE TYPE company_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE company_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role           company_role NOT NULL DEFAULT 'member',
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended')),
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ,

  UNIQUE (company_id, user_id)
);

ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

-- Members can see other members of their company
CREATE POLICY "members_read_same_company" ON company_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_members me
      WHERE me.company_id = company_members.company_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  );

-- All writes go through service role (invitations, role changes, removal)
CREATE POLICY "service_role_write_members" ON company_members FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_company_members_company ON company_members(company_id);
CREATE INDEX idx_company_members_user ON company_members(user_id);

-- ── company_invitations ───────────────────────────────────────────────────────

CREATE TABLE company_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invited_by   UUID NOT NULL REFERENCES auth.users(id),
  email        TEXT NOT NULL,
  role         company_role NOT NULL DEFAULT 'member',
  -- Token is generated in the API layer and set explicitly
  token        TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE company_invitations ENABLE ROW LEVEL SECURITY;

-- Admins can read invitations for their company
CREATE POLICY "admin_read_invitations" ON company_invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_members cm
      WHERE cm.company_id = company_invitations.company_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
        AND cm.status = 'active'
    )
  );

CREATE POLICY "service_role_write_invitations" ON company_invitations FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_invitations_token ON company_invitations(token);
CREATE INDEX idx_invitations_company ON company_invitations(company_id);
CREATE INDEX idx_invitations_email ON company_invitations(email);

-- ── profiles.company_id ───────────────────────────────────────────────────────
-- Denormalized fast-lookup. company_members is authoritative.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX idx_profiles_company ON profiles(company_id)
  WHERE company_id IS NOT NULL;

-- ── companies RLS (after company_members exists) ──────────────────────────────

CREATE POLICY "company_members_read" ON companies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_members cm
      WHERE cm.company_id = companies.id
        AND cm.user_id = auth.uid()
        AND cm.status = 'active'
    )
  );

-- Admins can update company name/settings
CREATE POLICY "company_admins_update" ON companies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM company_members cm
      WHERE cm.company_id = companies.id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
        AND cm.status = 'active'
    )
  );

-- Any authenticated user can insert (creating their own company)
CREATE POLICY "authenticated_insert_company" ON companies FOR INSERT
  WITH CHECK (true);

-- ── Helper functions ──────────────────────────────────────────────────────────

-- Is the current user an admin/owner of a given company?
CREATE OR REPLACE FUNCTION is_company_admin(p_company_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE company_id = p_company_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND status = 'active'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Is the current user an active member of a given company?
CREATE OR REPLACE FUNCTION is_company_member(p_company_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE company_id = p_company_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
