-- THE STABILIZATION PROGRAM — W0.2 PRIVILEGE INTEGRITY
--
-- THE HOLE: the `profiles` UPDATE policy is `USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`
-- (20260616_rls_performance.sql) — it restricts WHICH ROW an authenticated user may touch, never
-- WHICH COLUMN. `profiles.is_super_admin` (platform-wide admin flag, 20260318_add_super_admin.sql)
-- and `profiles.company_id` (denormalized tenancy pointer, 20260317_companies.sql — still read as a
-- membership signal by lib/email-sync/sync-emails.ts to pull a company's member roster into routing
-- context) sit on that same row with no extra guard, so ANY authenticated caller can crown themselves
-- super-admin or graft themselves onto another company's tenancy straight through PostgREST with the
-- anon/authenticated key — no app code, no platform-admin route, involved at all.
-- Every platform-admin route (app/api/platform-admin/**, lib/company/is-super-admin.ts) trusts
-- `profiles.is_super_admin` read through the caller's OWN session-scoped client — that check is sound
-- (a caller can only read their own row and the route logic never trusts a client-supplied flag), but
-- it is only as strong as the column being unforgeable. It currently isn't.
--
-- OWNER LIVE-CHECK (run in the Supabase SQL editor before AND after applying this migration):
--   select grantee, privilege_type from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_super_admin';
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
-- Manual anon-key attempt to confirm the fix (should now return an error, not 200):
--   curl -X PATCH "$SUPABASE_URL/rest/v1/profiles?id=eq.<your-own-user-id>" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer <your-own-access-token>" \
--     -H "Content-Type: application/json" -H "Prefer: return=representation" \
--     -d '{"is_super_admin": true}'
--
-- CENSUS (every other RLS-writable privilege/tenancy column, checked and found already guarded):
--   company_members.role / .company_id / .status — "service_role_write_members" is FOR ALL, no
--     `authenticated`-writable policy exists at all (20260616_rls_performance.sql:81-83). Every app
--     write (join, invite-accept, role change) goes through the service-role admin client after a
--     session-scoped permission check (app/api/company/{join,members}/route.ts). Not touched here.
--   companies.* (features, join_code, plan, ai_tier, settings) — "company_admins_update" requires an
--     ACTIVE owner/admin row in company_members (itself service_role-write-only); this is the
--     intended admin surface for a company's own settings, not a cross-tenant privilege hole.
--   tenant_configs — SELECT only for authenticated; every write policy is service_role
--     (20260616_rls_performance.sql:279-286).
-- No other table's RLS policies grant `authenticated`/`anon` write access to a role, tier, or
-- cross-tenant membership column. `profiles.is_super_admin` + `profiles.company_id` are the hole.
--
-- FIX: column-level REVOKE is the simplest robust primitive here (PostgREST/Supabase honors standard
-- GRANT/REVOKE underneath RLS — a table-level policy permit does not override a column-level revoke),
-- but a REVOKE alone would make ANY update statement that merely round-trips these columns in its
-- SET list fail outright, including whole-row upserts from legitimate service-role code that happens
-- to run under a role inheriting from `authenticated`. A BEFORE UPDATE/INSERT trigger is more robust:
-- it only rejects an ACTUAL change to the guarded columns (OLD IS DISTINCT FROM NEW), passes through
-- untouched, and is bypassed cleanly for the one caller class that legitimately sets them
-- (service_role — verified by grep: every INSERT/UPDATE touching is_super_admin or company_id in this
-- repo already runs through the service-role admin client; see the "legitimate write" note in the
-- W0.2 report). Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.guard_profiles_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The service role (server-side admin client) is the only caller allowed to set or change
  -- these columns. Every legitimate write in this codebase already goes through it.
  IF (select auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- No end-user identity at all (the SQL editor, migrations/backfills, internal definer triggers):
  -- not an API caller, so not the threat. API callers without a uid (anon) never reach a profiles
  -- write — the RLS policies require auth.uid() = id.
  IF (select auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      RAISE EXCEPTION 'privilege_integrity: is_super_admin cannot be changed by this caller';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'privilege_integrity: company_id cannot be changed by this caller';
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'INSERT': a non-service-role caller may create their own row (the existing
  -- "Users can insert own profile" policy), but never as a super-admin or pre-attached to a
  -- company — both must land null/false and be set by service-role code afterward (matches the
  -- existing join/onboarding flow, which upserts via the admin client).
  IF NEW.is_super_admin IS TRUE THEN
    RAISE EXCEPTION 'privilege_integrity: is_super_admin cannot be set by this caller';
  END IF;
  IF NEW.company_id IS NOT NULL THEN
    RAISE EXCEPTION 'privilege_integrity: company_id cannot be set by this caller';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_privilege_columns ON public.profiles;
CREATE TRIGGER guard_profiles_privilege_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_privilege_columns();

REVOKE EXECUTE ON FUNCTION public.guard_profiles_privilege_columns() FROM PUBLIC;
