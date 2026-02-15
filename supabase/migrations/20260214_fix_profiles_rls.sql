-- Fix: Infinite recursion in profiles RLS policy
-- The "Company admins can read org profiles" policy was querying profiles
-- while being defined ON profiles, causing infinite recursion.

-- Drop the problematic policy
DROP POLICY IF EXISTS "Company admins can read org profiles" ON profiles;

-- Create a security definer function to check if user is org admin
-- This breaks the recursion by executing with elevated privileges
CREATE OR REPLACE FUNCTION is_org_admin(
  user_id UUID,
  org_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = user_id
      AND organization_id = org_id
      AND role IN ('company_admin', 'super_admin')
  );
END;
$$;

-- Recreate the policy using the security definer function
CREATE POLICY "Company admins can read org profiles"
  ON profiles FOR SELECT
  USING (
    -- User can read if they're an admin of the same org
    is_org_admin(auth.uid(), organization_id)
  );

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION is_org_admin(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION is_org_admin IS 'Security definer function to check if user is org admin without causing RLS recursion';
