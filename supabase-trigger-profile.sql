-- ==========================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- Run this in Supabase SQL Editor
-- ==========================================

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, organization_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'user'::user_role,
    NULL  -- Will be assigned by company admin or when they create/join org
  );

  -- Also initialize their context profile
  INSERT INTO public.user_context_profiles (user_id, context_data)
  VALUES (
    NEW.id,
    '{}'::jsonb
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- TEST: Verify the trigger works
-- ==========================================
-- After running this, try signing up a new user
-- Then check if a profile was automatically created:
--
-- SELECT * FROM profiles ORDER BY created_at DESC LIMIT 5;
-- SELECT * FROM user_context_profiles ORDER BY created_at DESC LIMIT 5;
