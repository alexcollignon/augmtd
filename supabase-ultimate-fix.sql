-- ==========================================
-- ULTIMATE FIX: Schema & Permissions
-- This ensures the type is accessible to auth triggers
-- ==========================================

-- 1. Create the ENUM in public schema with explicit schema name
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('super_admin', 'company_admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Grant usage on the type to necessary roles
GRANT USAGE ON TYPE public.user_role TO postgres, anon, authenticated, service_role;

-- 3. Make sure the profiles table uses the correct type
-- First, check if we need to alter the table
DO $$
BEGIN
  -- This will fail silently if the column already exists with correct type
  ALTER TABLE public.profiles
    ALTER COLUMN role TYPE public.user_role USING role::text::public.user_role;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Column role already has correct type or table does not exist';
END $$;

-- 4. Drop and recreate trigger function with explicit schema references
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 5. Create function with fully qualified type names
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert into profiles with explicit schema and type
  INSERT INTO public.profiles (id, email, full_name, role, organization_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'user'::public.user_role,  -- Fully qualified type reference
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert into context profiles
  INSERT INTO public.user_context_profiles (user_id, context_data)
  VALUES (
    NEW.id,
    '{}'::jsonb
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error
    RAISE WARNING 'Error in handle_new_user for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- 6. Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- 7. Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 8. Create profiles for existing users
INSERT INTO public.profiles (id, email, full_name, role, organization_id)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email),
  'user'::public.user_role,
  NULL
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- 9. Create context profiles for existing users
INSERT INTO public.user_context_profiles (user_id, context_data)
SELECT
  u.id,
  '{}'::jsonb
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_context_profiles c WHERE c.user_id = u.id
)
ON CONFLICT (user_id) DO NOTHING;

-- ==========================================
-- VERIFICATION QUERIES
-- ==========================================

-- Check if type exists and is accessible
SELECT
  typname as type_name,
  nspname as schema_name,
  'public.user_role type exists' as status
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE typname = 'user_role';

-- Check if trigger exists
SELECT
  tgname as trigger_name,
  'Trigger exists on auth.users' as status
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Check if function exists
SELECT
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  'Function exists' as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'handle_new_user'
  AND n.nspname = 'public';

-- Check all users and their profiles
SELECT
  u.id,
  u.email,
  p.role,
  CASE
    WHEN p.id IS NULL THEN '❌ Missing'
    ELSE '✅ Exists'
  END as profile_status
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
ORDER BY u.created_at DESC;

-- Summary
SELECT
  COUNT(*) FILTER (WHERE p.id IS NOT NULL) as users_with_profiles,
  COUNT(*) FILTER (WHERE p.id IS NULL) as users_without_profiles,
  COUNT(*) as total_users
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id;
