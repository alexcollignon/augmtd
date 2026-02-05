-- ==========================================
-- COMPLETE FIX: Create ENUM + Trigger
-- Run this entire file in Supabase SQL Editor
-- ==========================================

-- 1. Create the user_role ENUM type if it doesn't exist
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'company_admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Drop old trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 3. Create the function with proper error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile with explicit type casting
  INSERT INTO public.profiles (id, email, full_name, role, organization_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'user'::user_role,  -- Explicit cast to user_role type
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  -- Create context profile
  INSERT INTO public.user_context_profiles (user_id, context_data)
  VALUES (
    NEW.id,
    '{}'::jsonb
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail signup
    RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Fix existing users without profiles
INSERT INTO public.profiles (id, email, full_name, role, organization_id)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email),
  'user'::user_role,
  NULL
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- 6. Create context profiles for existing users
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
-- VERIFICATION
-- ==========================================

-- Check if everything is set up correctly
DO $$
DECLARE
  enum_exists boolean;
  trigger_exists boolean;
  users_without_profiles integer;
BEGIN
  -- Check if enum exists
  SELECT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'user_role'
  ) INTO enum_exists;

  -- Check if trigger exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) INTO trigger_exists;

  -- Count users without profiles
  SELECT COUNT(*) INTO users_without_profiles
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id);

  -- Report results
  RAISE NOTICE '=== Setup Verification ===';
  RAISE NOTICE 'user_role enum exists: %', enum_exists;
  RAISE NOTICE 'Trigger exists: %', trigger_exists;
  RAISE NOTICE 'Users without profiles: %', users_without_profiles;

  IF enum_exists AND trigger_exists AND users_without_profiles = 0 THEN
    RAISE NOTICE '✅ Everything is set up correctly!';
  ELSE
    RAISE WARNING '⚠️ Some issues detected. Check the output above.';
  END IF;
END $$;

-- View all users and their profiles
SELECT
  u.id,
  u.email,
  u.created_at as signed_up_at,
  p.role,
  CASE
    WHEN p.id IS NULL THEN '❌ Missing Profile'
    ELSE '✅ Profile Created'
  END as status
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
ORDER BY u.created_at DESC;
