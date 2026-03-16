-- Phase 51B: Super-admin flag + lock down company creation

-- 1. Add is_super_admin flag to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Add status column to companies (active / suspended)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended'));

-- 3. Remove the open insert policy (any authenticated user could create a company)
DROP POLICY IF EXISTS "authenticated_insert_company" ON companies;

-- 4. Replace with service-role-only insert
CREATE POLICY "service_role_insert_company" ON companies FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- To set your own account as super_admin, run:
-- UPDATE profiles SET is_super_admin = true
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
