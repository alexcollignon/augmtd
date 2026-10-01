// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE PROBE HOSTS. Standard tier = the existing smoke probe (scripts/probe-user.ts). EU tier =
// a SECOND probe host (owner-approved, Sep 29): `smoke-probe-eu@augmtd-internal.test`, a member (owner)
// of its own internal workspace whose ai_tier is `bedrock_optimised` (the factory's workspace tier wins
// over any personal setting), with the email feature ON so mailbox-shaped fixtures are legal there.
// A test account only — never a pilot account. Created once on first use (`create: true`), reused.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { PROBE_EMAILS, POOL_MAX, probePoolEmail, probeHostOf } from './world';
import type { Tier } from './types';

export const EU_WORKSPACE = { name: 'Eval Probe EU (test workspace)', slug: 'eval-probe-eu' } as const;

async function findAuthUser(sb: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data?.users?.find((u) => (u.email ?? '').toLowerCase() === email);
    if (found) return found.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return null;
}

export type EuProbeStatus = { userId: string | null; companyId: string | null; tier: string | null; created: string[]; problems: string[] };

/** Resolve (and with `create`, provision) the EU probe host. Idempotent; every error surfaced. */
export async function resolveEuProbeUser(sb: SupabaseClient, opts: { create: boolean }): Promise<EuProbeStatus> {
  const st: EuProbeStatus = { userId: null, companyId: null, tier: null, created: [], problems: [] };
  let id = await findAuthUser(sb, PROBE_EMAILS.eu);
  if (!id) {
    if (!opts.create) { st.problems.push('EU probe host does not exist yet (run with --create-eu-probe)'); return st; }
    const { data, error } = await sb.auth.admin.createUser({ email: PROBE_EMAILS.eu, email_confirm: true });
    if (error || !data?.user) { st.problems.push(`createUser failed: ${error?.message ?? 'no user'}`); return st; }
    id = data.user.id;
    st.created.push('auth user');
  }
  st.userId = id;
  const prof = await sb.from('profiles').select('id').eq('id', id).maybeSingle();
  if (prof.error) st.problems.push(`profiles read: ${prof.error.message}`);
  if (!prof.data) {
    if (!opts.create) st.problems.push('no profile row');
    else {
      const { error } = await sb.from('profiles').upsert({ id, full_name: 'Probe Host EU', email: PROBE_EMAILS.eu }, { onConflict: 'id' });
      if (error) st.problems.push(`profiles upsert: ${error.message}`); else st.created.push('profile');
    }
  }
  const co = await sb.from('companies').select('id, ai_tier, features').eq('slug', EU_WORKSPACE.slug).maybeSingle();
  if (co.error) { st.problems.push(`companies read: ${co.error.message}`); return st; }
  let companyId = (co.data as { id?: string } | null)?.id ?? null;
  if (!companyId) {
    if (!opts.create) { st.problems.push('EU probe workspace missing'); return st; }
    const made = await sb.from('companies').insert({
      name: EU_WORKSPACE.name, slug: EU_WORKSPACE.slug, plan: 'starter', type: 'internal', status: 'active',
      join_code: `EVALEU${Math.floor(Math.random() * 9000 + 1000)}`, ai_tier: 'bedrock_optimised', settings: {},
      features: { email: true, meetings: false, drive: true, agents: true, studio: true, home: true },
    }).select('id').single();
    if (made.error || !made.data) { st.problems.push(`companies insert: ${made.error?.message ?? 'no row'}`); return st; }
    companyId = (made.data as { id: string }).id;
    st.created.push('workspace');
  } else if ((co.data as { ai_tier?: string | null }).ai_tier !== 'bedrock_optimised') {
    st.problems.push(`EU probe workspace tier is ${(co.data as { ai_tier?: string | null }).ai_tier ?? 'null'} (expected bedrock_optimised)`);
  }
  st.companyId = companyId;
  const mem = await sb.from('company_members').select('id, status').eq('company_id', companyId).eq('user_id', id).maybeSingle();
  if (mem.error) st.problems.push(`company_members read: ${mem.error.message}`);
  if (!mem.data) {
    if (!opts.create) st.problems.push('EU probe is not a member of its workspace');
    else {
      const { error } = await sb.from('company_members').insert({ company_id: companyId, user_id: id, role: 'owner', status: 'active' });
      if (error) st.problems.push(`company_members insert: ${error.message}`); else st.created.push('membership');
    }
  }
  const t = await sb.from('companies').select('ai_tier').eq('id', companyId).maybeSingle();
  st.tier = (t.data as { ai_tier?: string | null } | null)?.ai_tier ?? null;
  return st;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROBE POOL — N identical, isolated test accounts per tier (world.ts probePoolEmail). Account #1
// of a tier is its original probe host and is only ever READ here; #k ≥ 2 are provisioned (with
// `create`) as copies of #1's CONFIG: the profile's config columns, and for EU the membership (same
// role/status) in the same internal EU workspace. No standing data is copied — the eval adapters seed
// every record a case needs (FIXTURES.md); a tier's #1 may carry other suites' standing rows, which
// the CLI reports as an informational diff. Idempotent; every error surfaced; any address that is not
// a probe-pool address is refused by construction (addresses come from probePoolEmail only).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type PoolAccount = { tier: Tier; k: number; email: string; userId: string; label: string };
export type PoolSpec = Partial<Record<Tier, number[]>>;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** `std=4,eu=3` → standard #1..4, EU #1..3 · `std=2-4` → #2..4 · `eu=0` → none. Unknown keys refused. */
export function parsePoolSpec(spec: string | null | undefined): PoolSpec | null {
  if (spec == null || !spec.trim()) return null;
  const out: PoolSpec = {};
  for (const kv of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [rawK, rawV = ''] = kv.split('=');
    const tier: Tier | null = ['std', 'standard'].includes(rawK) ? 'standard' : rawK === 'eu' ? 'eu' : null;
    if (!tier) throw new Error(`--probe-pool: unknown tier "${rawK}" (use std=…, eu=…)`);
    const m = /^(\d+)(?:-(\d+))?$/.exec(rawV.trim());
    if (!m) throw new Error(`--probe-pool: ${rawK} wants a count (4) or a range (2-4), got "${rawV}"`);
    const [a, b] = m[2] ? [Number(m[1]), Number(m[2])] : [1, Number(m[1])];
    if (m[2] && a < 1) throw new Error(`--probe-pool: ${rawK} range starts at 1`);
    if (b > POOL_MAX || (m[2] && b < a)) throw new Error(`--probe-pool: ${rawK}=${rawV} out of range (max ${POOL_MAX})`);
    out[tier] = b === 0 ? [] : range(a, b);
  }
  return out;
}

export const poolLabel = (tier: Tier, k: number) => `${tier === 'standard' ? 'std' : 'eu'}#${k}`;

/** W30 — `--probe-host std=4,eu=3`: ONE named pool account per tier for the single-host harnesses
 *  (eval-surfaces, eval-home-chat), e.g. an account carrying a candidate model override. A bare `4`
 *  means std=4. Absent tier = account #1 (the default). Unknown keys / out-of-range refused. Pure. */
export function parseProbeHostSpec(spec: string | null | undefined): Partial<Record<Tier, number>> {
  const out: Partial<Record<Tier, number>> = {};
  if (spec == null || !spec.trim()) return out;
  for (const kv of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [rawK, rawV] = kv.includes('=') ? kv.split('=') : ['std', kv];
    const tier: Tier | null = ['std', 'standard'].includes(rawK.trim()) ? 'standard' : rawK.trim() === 'eu' ? 'eu' : null;
    if (!tier) throw new Error(`--probe-host: unknown tier "${rawK}" (use std=k, eu=k)`);
    const k = Number(String(rawV ?? '').trim());
    if (!Number.isInteger(k) || k < 1 || k > POOL_MAX) throw new Error(`--probe-host: ${rawK}=${rawV} must be an account number 1..${POOL_MAX}`);
    if (out[tier] != null) throw new Error(`--probe-host: ${rawK} named twice`);
    out[tier] = k;
  }
  return out;
}

/** Profile columns that are CONFIG (what a producer may read about the user), compared across a tier's
 *  pool and copied from #1 onto #k. Caches (home_brief, outbound/calendar caches) are not config. */
export const PROFILE_CONFIG_FIELDS = ['role', 'full_name', 'settings', 'email_settings', 'attendee_enabled', 'is_super_admin', 'needs_join', 'slack_dm_reports', 'team_briefing', 'company_id'] as const;
/** Privilege columns: compared, never written by the pool (a mismatch is reported, not "fixed"). */
const PRIVILEGE_FIELDS = new Set(['role', 'is_super_admin']);
/** Per-user config tables whose row counts must match across a tier's pool. */
export const CONFIG_TABLES = ['context_profiles', 'user_context_profiles', 'tenant_configs', 'inbox_rules', 'skills', 'custom_agents', 'agent_tool_settings', 'integration_connections', 'slack_identities'] as const;

export type ProbeConfig = {
  profile: Record<string, unknown> | null;
  memberships: Array<{ company_id: string; role: string | null; status: string | null; ai_tier: string | null; features: unknown; settings: unknown }>;
  counts: Record<string, number | string>;
  /** Resolved model per factory slot (filled by the caller that has the factory loaded). */
  models?: Record<string, string>;
};

async function authEmail(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error) throw new Error(`getUserById ${userId.slice(0, 8)}: ${error.message}`);
  return data?.user?.email ?? null;
}

/** The fairness-relevant configuration of one probe account (read-only). */
export async function readProbeConfig(sb: SupabaseClient, userId: string): Promise<ProbeConfig> {
  const prof = await sb.from('profiles').select(PROFILE_CONFIG_FIELDS.join(', ')).eq('id', userId).maybeSingle();
  if (prof.error) throw new Error(`profiles read: ${prof.error.message}`);
  const mem = await sb.from('company_members').select('company_id, role, status').eq('user_id', userId).order('company_id');
  if (mem.error) throw new Error(`company_members read: ${mem.error.message}`);
  const memberships: ProbeConfig['memberships'] = [];
  for (const m of (mem.data ?? []) as Array<{ company_id: string; role: string | null; status: string | null }>) {
    const co = await sb.from('companies').select('ai_tier, features, settings').eq('id', m.company_id).maybeSingle();
    if (co.error) throw new Error(`companies read: ${co.error.message}`);
    const c = (co.data ?? {}) as { ai_tier?: string | null; features?: unknown; settings?: unknown };
    memberships.push({ company_id: m.company_id, role: m.role, status: m.status, ai_tier: c.ai_tier ?? null, features: c.features ?? null, settings: c.settings ?? null });
  }
  const counts: Record<string, number | string> = {};
  for (const t of CONFIG_TABLES) {
    const { count, error } = await sb.from(t).select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
    counts[t] = error ? `unreadable (${error.message.slice(0, 60)})` : count ?? 0;
  }
  return { profile: (prof.data as Record<string, unknown> | null) ?? null, memberships, counts };
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** THE FAIRNESS CHECK (pure): within a tier every pool account's config equals account #first's —
 *  so a result never depends on which account ran a case. Returns one line per difference. */
export function poolFairnessProblems(rows: Array<{ label: string; tier: Tier; config: ProbeConfig }>): string[] {
  const out: string[] = [];
  for (const tier of ['standard', 'eu'] as const) {
    const xs = rows.filter((r) => r.tier === tier);
    if (xs.length < 2) continue;
    const ref = xs[0];
    for (const r of xs.slice(1)) {
      if (!r.config.profile) { out.push(`${r.label}: no profile row`); continue; }
      for (const f of PROFILE_CONFIG_FIELDS) {
        const a = ref.config.profile?.[f], b = r.config.profile?.[f];
        if (stable(a ?? null) !== stable(b ?? null)) out.push(`${r.label} profile.${f} = ${stable(b ?? null)} ≠ ${ref.label} ${stable(a ?? null)}`);
      }
      if (stable(r.config.memberships) !== stable(ref.config.memberships)) out.push(`${r.label} workspace membership ${stable(r.config.memberships)} ≠ ${ref.label} ${stable(ref.config.memberships)}`);
      for (const t of Object.keys({ ...ref.config.counts, ...r.config.counts })) {
        if (stable(r.config.counts[t]) !== stable(ref.config.counts[t])) out.push(`${r.label} ${t} rows ${r.config.counts[t]} ≠ ${ref.label} ${ref.config.counts[t]}`);
      }
      if (ref.config.models || r.config.models) {
        if (stable(r.config.models ?? null) !== stable(ref.config.models ?? null)) out.push(`${r.label} models ${stable(r.config.models ?? null)} ≠ ${ref.label} ${stable(ref.config.models ?? null)}`);
      }
    }
  }
  return out;
}

export type PoolResolve = { accounts: PoolAccount[]; created: string[]; problems: string[]; missing: string[] };

/**
 * Resolve (and with `create`, provision) pool accounts. `ks` per tier; absent tier = none; with
 * `discover` every existing account #1..POOL_MAX is taken (missing ones are skipped silently).
 * Account #1 is only read. #k ≥ 2: auth user (created when missing) → profile config copied from #1
 * (privilege columns never written) → EU: membership in the EU workspace mirroring #1's.
 */
export async function resolveProbePool(sb: SupabaseClient, o: { spec: PoolSpec; create: boolean; discover?: boolean }): Promise<PoolResolve> {
  const res: PoolResolve = { accounts: [], created: [], problems: [], missing: [] };
  for (const tier of ['standard', 'eu'] as const) {
    const ks = o.discover ? range(1, POOL_MAX) : o.spec[tier] ?? [];
    if (!ks.length) continue;
    // The reference (#1) — read-only here.
    const refId = await findAuthUser(sb, probePoolEmail(tier, 1));
    const ref = refId ? await readProbeConfig(sb, refId) : null;
    if (!refId || !ref) { res.problems.push(`${poolLabel(tier, 1)}: the tier's original probe host is missing (it is the pool's reference)`); continue; }
    const euCompany = tier === 'eu' ? ref.memberships.find((m) => m.ai_tier === 'bedrock_optimised')?.company_id ?? null : null;
    if (tier === 'eu' && !euCompany) { res.problems.push(`${poolLabel(tier, 1)} is not in a bedrock_optimised workspace`); continue; }
    for (const k of ks) {
      const email = probePoolEmail(tier, k);
      const label = poolLabel(tier, k);
      if (probeHostOf(email)?.tier !== tier) { res.problems.push(`${label}: ${email} is not a probe-pool address — refused`); continue; }
      let id = k === 1 ? refId : await findAuthUser(sb, email);
      if (!id) {
        if (!o.create || o.discover) { if (!o.discover) res.missing.push(`${label} (${email})`); continue; }
        const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
        if (error || !data?.user) { res.problems.push(`${label}: createUser failed: ${error?.message ?? 'no user'}`); continue; }
        id = data.user.id;
        res.created.push(`${label} auth user ${id.slice(0, 8)}`);
      }
      // Belt and braces: the auth row behind the id must carry exactly this probe address.
      const actual = (await authEmail(sb, id))?.toLowerCase() ?? null;
      if (actual !== email) { res.problems.push(`${label}: auth row ${id.slice(0, 8)} has email ${actual} — refused`); continue; }
      if (k > 1 && o.create) {
        const cur = await readProbeConfig(sb, id);
        const patch: Record<string, unknown> = {};
        for (const f of PROFILE_CONFIG_FIELDS) {
          if (stable(cur.profile?.[f] ?? null) === stable(ref.profile?.[f] ?? null)) continue;
          if (PRIVILEGE_FIELDS.has(f)) { res.problems.push(`${label}: profile.${f} differs from #1 (privilege column — not written; fix by hand)`); continue; }
          patch[f] = ref.profile?.[f] ?? null;
        }
        if (!cur.profile || Object.keys(patch).length) {
          const { error } = await sb.from('profiles').upsert({ id, email, ...patch }, { onConflict: 'id' });
          if (error) res.problems.push(`${label}: profiles upsert: ${error.message}`); else res.created.push(`${label} profile config (${Object.keys(patch).join(', ') || 'row'})`);
        }
        for (const m of ref.memberships) {
          if (cur.memberships.some((x) => x.company_id === m.company_id)) continue;
          const { error } = await sb.from('company_members').insert({ company_id: m.company_id, user_id: id, role: m.role, status: m.status });
          if (error) res.problems.push(`${label}: company_members insert: ${error.message}`); else res.created.push(`${label} membership ${m.company_id.slice(0, 8)} (${m.role})`);
        }
      }
      if (tier === 'eu') {
        const t = await sb.from('company_members').select('company_id').eq('user_id', id).eq('company_id', euCompany!).maybeSingle();
        if (t.error) { res.problems.push(`${label}: membership read: ${t.error.message}`); continue; }
        if (!t.data) { res.problems.push(`${label}: not a member of the EU workspace ${euCompany!.slice(0, 8)} (run scripts/probe-pool.ts --create)`); continue; }
      }
      res.accounts.push({ tier, k, email, userId: id, label });
    }
  }
  return res;
}
