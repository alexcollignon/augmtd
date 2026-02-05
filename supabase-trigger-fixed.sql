-- ==========================================
-- FIXED: AUTO-CREATE PROFILE ON USER SIGNUP
-- This version handles errors gracefully
-- ==========================================

-- First, let's make sure the trigger doesn't fail on existing users
-- Drop the old trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create improved function with error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create profile if it doesn't exist
  INSERT INTO public.profiles (id, email, full_name, role, organization_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'user'::user_role,
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  -- Only create context profile if it doesn't exist
  INSERT INTO public.user_context_profiles (user_id, context_data)
  VALUES (
    NEW.id,
    '{}'::jsonb
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the signup
    RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- ALSO: Fix for existing users without profiles
-- ==========================================

-- Create profiles for any existing auth users who don't have one
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

-- Create context profiles for existing users
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
-- TEST
-- ==========================================
-- Verify all auth users have profiles:
-- SELECT
--   u.id,
--   u.email,
--   p.role,
--   CASE WHEN p.id IS NULL THEN '❌ Missing' ELSE '✅ Exists' END as profile_status
-- FROM auth.users u
-- LEFT JOIN profiles p ON u.id = p.id
-- ORDER BY u.created_at DESC;
