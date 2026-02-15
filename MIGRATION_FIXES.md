# Migration Fixes - 2026-02-14

## Summary

Two issues were discovered during testing after the modular profiles migration:

1. ✅ **FIXED:** Confidence score showing 5800% instead of 58%
2. ⚠️  **ACTION REQUIRED:** RLS policy infinite recursion on profiles table

---

## Issue 1: Confidence Score Bug ✅ FIXED

### Problem
```
✓ Loaded user context (confidence: 5800%, 0 signals)
```

The confidence score was showing 5800% instead of the expected 58%.

### Root Cause
- Old system: `overallScore` is 0-1 value (e.g., 0.58)
- New system: Profile confidence scores are 0-100 values (e.g., 58)
- The `calculateOverallConfidence()` function was returning 0-100 instead of 0-1
- When sync-emails.ts multiplied by 100 to display as percentage: `58 * 100 = 5800%` ❌

### Fix Applied
**File:** `lib/context/profile-adapter.ts` (line 187)

**Before:**
```typescript
return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
// Returns 0-100 value
```

**After:**
```typescript
const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
return average / 100;
// Returns 0-1 value (matches old format)
```

### Verification
After restarting the app, you should see:
```
✓ Loaded user context (confidence: 58%, 0 signals)
```

---

## Issue 2: Infinite Recursion in Profiles RLS Policy ⚠️

### Problem
```
[Onboarding] Failed to update profile: {
  code: '42P17',
  message: 'infinite recursion detected in policy for relation "profiles"'
}
```

### Root Cause
The RLS policy "Company admins can read org profiles" queries the `profiles` table while being defined ON the `profiles` table:

```sql
CREATE POLICY "Company admins can read org profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles AS p  -- ❌ Queries profiles while ON profiles!
      WHERE p.id = auth.uid()
        AND p.organization_id = profiles.organization_id
        AND p.role IN ('company_admin', 'super_admin')
    )
  );
```

This creates infinite recursion when PostgreSQL tries to evaluate the policy.

### Fix - ACTION REQUIRED

**Migration file created:** `supabase/migrations/20260214_fix_profiles_rls.sql`

**You must run this in Supabase Dashboard:**

1. Go to Supabase Dashboard → SQL Editor
2. Run the migration file: `supabase/migrations/20260214_fix_profiles_rls.sql`
3. Verify the fix by completing onboarding again

**What the fix does:**
- Creates a `SECURITY DEFINER` function `is_org_admin()` that checks org admin status
- This function executes with elevated privileges, breaking the recursion
- Recreates the RLS policy using the function instead of a subquery

**SQL to run:**
```sql
-- Drop problematic policy
DROP POLICY IF EXISTS "Company admins can read org profiles" ON profiles;

-- Create security definer function (breaks recursion)
CREATE OR REPLACE FUNCTION is_org_admin(user_id UUID, org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id
      AND organization_id = org_id
      AND role IN ('company_admin', 'super_admin')
  );
END;
$$;

-- Recreate policy using function
CREATE POLICY "Company admins can read org profiles"
  ON profiles FOR SELECT
  USING (is_org_admin(auth.uid(), organization_id));

-- Grant permissions
GRANT EXECUTE ON FUNCTION is_org_admin(UUID, UUID) TO authenticated;
```

### Note on Current Behavior

Despite the error, onboarding **still works** because:
- The profile update fails (non-critical)
- The context profiles are created successfully
- The app continues functioning

However, you should still fix this to prevent future issues with profile updates.

---

## Testing Checklist

After applying the RLS fix, test the following:

- [ ] Restart dev server: `npm run dev`
- [ ] Sign up a new user or onboard existing user
- [ ] Verify no RLS errors in logs
- [ ] Check confidence score displays correctly (e.g., "58%" not "5800%")
- [ ] Verify 3 profiles created in `context_profiles` table:
  - `identity` (95% confidence)
  - `email_communication` (20% confidence)
  - `domain_knowledge` (0% confidence)
- [ ] Test email sync loads profiles correctly
- [ ] Test email drafting still works

---

## Summary of All Changes

### Code Changes (Already Applied ✅)
1. `lib/email-sync/sync-emails.ts` - Uses `getUserContextLegacy()`
2. `lib/context/user-context-engine.ts` - Uses `getUserContextLegacy()`
3. `app/api/context/onboarding/route.ts` - Uses `initializeUserContext()`
4. `lib/context/profile-adapter.ts` - Fixed confidence calculation (divide by 100)

### Database Changes (Action Required ⚠️)
1. `supabase/migrations/20260214_migrate_to_modular_profiles.sql` - ✅ Already run
2. `supabase/migrations/20260214_fix_profiles_rls.sql` - ⚠️  **NEED TO RUN**

---

## Next Steps

1. **Immediate:** Run the RLS fix migration in Supabase Dashboard
2. **Test:** Restart server and verify onboarding works without errors
3. **Monitor:** Watch logs for confidence scores (should be 0-100%, not 1000%+)
4. **After 1 week:** If everything works, backup and drop old `user_context_profiles` table

---

**Migration Status:** 95% Complete
- ✅ Modular profiles migration
- ✅ Code updates
- ✅ Backward compatibility
- ✅ Confidence score bug fix
- ⚠️  RLS policy fix (pending manual step)
