// ─── THE PRIVILEGE-INTEGRITY GATE (W0.2, Sep 22) ────────────────────────────────────────────────
// THE HOLE: `profiles` UPDATE RLS is `USING/WITH CHECK (auth.uid() = id)` — it restricts WHICH ROW
// a caller may touch, never WHICH COLUMN. `is_super_admin` and the denormalized `company_id` sit on
// that same row unguarded, so any authenticated caller could crown themselves super-admin or graft
// themselves onto another company's tenancy straight through PostgREST, with no app code involved.
//
// Zero-AI, source-level. No DB connection, no live probe — this is a static census + guard check,
// run against the files in the working tree.
//
//   P1 MIGRATION EXISTS — 20260922_privilege_integrity.sql is present and defines the guard trigger.
//   P2 COLUMNS GUARDED — the trigger function rejects a non-service-role change to BOTH censused
//               columns (is_super_admin, company_id) on UPDATE, and rejects setting them on INSERT.
//   P3 SERVICE-ROLE ESCAPE — the guard explicitly passes through `auth.role() = 'service_role'`
//               (every legitimate write to these columns in this codebase already runs through the
//               service-role admin client — see the census below).
//   P4 IDEMPOTENT — DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION, so a re-run never errors.
//   P5 ROUTES TRUST THE SESSION, NOT THE CLIENT — every app/api/platform-admin/** route (and every
//               other `isSuperAdmin(...)` call site) resolves the flag through a SESSION-SCOPED
//               (RLS-bound) Supabase client keyed on `user.id` from `auth.getUser()` — never a
//               client-supplied boolean, never an admin client keyed on a request-body user id.
//   P6 NO OTHER RLS-WRITABLE PRIVILEGE COLUMN — `company_members.role/company_id/status` and
//               `tenant_configs.*` carry no `authenticated`-writable policy at all (service_role
//               only); `companies.*` is writable only by an active owner/admin `company_members` row,
//               which is itself not authenticated-writable — the intended admin-of-their-own-company
//               surface, not a censused hole.
//
// Run: npx tsx scripts/smoke-privilege.ts

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name === '.next' || f.name === '.next-dev' || f.name.startsWith('.')) continue;
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f.name)) out.push(p);
  }
  return out;
}

async function main() {
  console.log('THE PRIVILEGE-INTEGRITY GATE\n');

  const MIGRATION = 'supabase/migrations/20260922_privilege_integrity.sql';
  const migrationExists = existsSync(MIGRATION);
  ok('P1 migration file exists', migrationExists, MIGRATION);
  if (!migrationExists) {
    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(1);
  }
  const sql = readFileSync(MIGRATION, 'utf8');

  ok('P1 defines a guard trigger function', /CREATE OR REPLACE FUNCTION public\.guard_profiles_privilege_columns/.test(sql));
  ok('P1 attaches it BEFORE INSERT OR UPDATE ON public.profiles', /BEFORE INSERT OR UPDATE ON public\.profiles/.test(sql));

  ok('P2 guards is_super_admin on UPDATE (OLD vs NEW)', /NEW\.is_super_admin IS DISTINCT FROM OLD\.is_super_admin/.test(sql));
  ok('P2 guards company_id on UPDATE (OLD vs NEW)', /NEW\.company_id IS DISTINCT FROM OLD\.company_id/.test(sql));
  ok('P2 guards is_super_admin on INSERT', /TG_OP = 'INSERT'/.test(sql) && /NEW\.is_super_admin IS TRUE/.test(sql));
  ok('P2 guards company_id on INSERT', /NEW\.company_id IS NOT NULL/.test(sql));
  ok('P2 raises (never silently drops the write)', (sql.match(/RAISE EXCEPTION 'privilege_integrity:/g) ?? []).length >= 4);

  ok('P3 service_role escapes the guard', /\(select auth\.role\(\)\) = 'service_role'/.test(sql) && /RETURN NEW;/.test(sql));

  ok('P4 idempotent: DROP TRIGGER IF EXISTS', /DROP TRIGGER IF EXISTS guard_profiles_privilege_columns/.test(sql));
  ok('P4 idempotent: CREATE OR REPLACE FUNCTION', /CREATE OR REPLACE FUNCTION/.test(sql));
  ok('P4 SECURITY DEFINER + fixed search_path (trigger-function hardening)', /SECURITY DEFINER/.test(sql) && /SET search_path = public/.test(sql));

  ok('P1 comment carries the owner live-check SQL', /information_schema\.column_privileges/.test(sql) && /pg_trigger/.test(sql));

  // ── P5 — every platform-admin route + every isSuperAdmin() call resolves the flag through the
  // caller's own SESSION client, never a client-supplied value or an admin client keyed on a
  // request-supplied user id. ──
  const isSuperAdminHelper = 'lib/company/is-super-admin.ts';
  if (existsSync(isSuperAdminHelper)) {
    const helper = readFileSync(isSuperAdminHelper, 'utf8');
    ok('P5 isSuperAdmin() reads profiles.is_super_admin by id (no other trust path)', /\.from\('profiles'\)/.test(helper) && /is_super_admin/.test(helper));
  } else {
    ok('P5 isSuperAdmin() helper exists', false, isSuperAdminHelper);
  }

  const platformAdminRoutes = walk('app/api/platform-admin');
  const callSites: string[] = [];
  for (const f of walk('app').concat(walk('lib'))) {
    const src = readFileSync(f, 'utf8');
    if (/isSuperAdmin\(/.test(src) && !f.endsWith('is-super-admin.ts')) callSites.push(f);
  }
  ok('P5 at least one call site found (the gate is not vacuous)', callSites.length > 0, `${callSites.length} files`);
  const badCallSites = callSites.filter((f) => {
    const src = readFileSync(f, 'utf8');
    // Every call must pass a `user.id` (from a session's own auth.getUser()) — never a route param
    // (userId/companyId path segments) or a request-body field.
    return /isSuperAdmin\(\s*(userId|params\.|body\.|req\.)/i.test(src);
  });
  ok('P5 no isSuperAdmin() call is keyed on a client-supplied id', badCallSites.length === 0, badCallSites.join(', '));

  ok('P5 there are platform-admin routes to protect (census not vacuous)', platformAdminRoutes.length > 0, `${platformAdminRoutes.length} routes`);
  const unguardedMutating: string[] = [];
  for (const f of platformAdminRoutes) {
    if (f.endsWith('me/route.ts')) continue; // read-only self-check, no privileged action
    const src = readFileSync(f, 'utf8');
    const hasMutatingHandler = /export async function (POST|PATCH|PUT|DELETE)/.test(src);
    if (!hasMutatingHandler) continue;
    // Either the shared isSuperAdmin() helper, or the equivalent inline check against the
    // session-scoped `profiles.is_super_admin` read (both resolve the flag through the caller's
    // own auth.getUser()-derived session — never a client-supplied value).
    const usesHelper = /isSuperAdmin\(/.test(src);
    const usesInline = /profile\??\.is_super_admin/.test(src) && /from\('profiles'\)/.test(src) && /auth\.getUser\(\)/.test(src);
    if (!usesHelper && !usesInline) unguardedMutating.push(f);
  }
  ok('P5 every mutating platform-admin route checks isSuperAdmin()', unguardedMutating.length === 0, unguardedMutating.join(', '));

  // ── P6 — the RLS census: no OTHER authenticated-writable privilege/tenancy column. Source floor
  // over the RLS migration that defines these policies today. ──
  const rls = readFileSync('supabase/migrations/20260616_rls_performance.sql', 'utf8');
  ok('P6 company_members carries a service_role-only write policy, no authenticated write policy', /CREATE POLICY "service_role_write_members" ON company_members FOR ALL/.test(rls) && !/CREATE POLICY[^;]*ON company_members FOR (UPDATE|INSERT)[^;]*authenticated/i.test(rls));
  ok('P6 tenant_configs writes are service_role only', /tenant_configs_service_write/.test(rls) && /tenant_configs_service_update/.test(rls) && /tenant_configs_service_delete/.test(rls));
  ok('P6 companies UPDATE requires an active owner/admin company_members row (not open to any authenticated caller)', /CREATE POLICY "company_admins_update" ON companies FOR UPDATE/.test(rls) && /role = ANY \(ARRAY\['owner'::company_role, 'admin'::company_role\]\)/.test(rls));

  console.log(`\n${pass}/${pass + fail} passed`);
  console.log('\nOwner live-check (run in the Supabase SQL editor, before AND after applying the migration):');
  console.log(`  select grantee, privilege_type from information_schema.column_privileges\n   where table_schema='public' and table_name='profiles' and column_name='is_super_admin';`);
  console.log(`  select tgname from pg_trigger where tgrelid='public.profiles'::regclass and not tgisinternal;`);
  console.log('\nManual anon-key attempt to confirm the fix (expect an error, not 200) — after applying the migration:');
  console.log('  curl -X PATCH "$SUPABASE_URL/rest/v1/profiles?id=eq.<your-own-user-id>" \\');
  console.log('    -H "apikey: $ANON_KEY" -H "Authorization: Bearer <your-own-access-token>" \\');
  console.log('    -H "Content-Type: application/json" -H "Prefer: return=representation" \\');
  console.log('    -d \'{"is_super_admin": true}\'');

  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
