// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HALF-DEAD SESSION SUITE (permanent — the Sep 2026 ERR_TOO_MANY_REDIRECTS incident, made a
// fixture the day it was found).
//
// THE BUG: a session whose access-token JWT is still unexpired while its REFRESH token is dead
// (single-use rotation — the same account signing in from a second browser strands this one's
// token: `refresh_token_already_used`, then `refresh_token_not_found` once the family is revoked).
// `getUser()` validates only the live JWT, so middleware called the session AUTHENTICATED and
// bounced /login → /home, while anything that actually refreshed called it DEAD and bounced back:
// an infinite 307 loop that only ended when the JWT expired (~1h).
//
// THE FIX: on the auth routes — the one leg that can close the loop — the middleware verdict comes
// from a real refresh instead of a JWT check. Still exactly ONE auth call; every other route keeps
// the untouched single `getUser()`.
//
// This suite mints a REAL half-dead session against the live Supabase project (throwaway auth
// users only, deleted in a finally) — no mocks for the auth verdicts. Only the transport-hiccup
// gate (D2) stubs fetch, because an auth-server outage cannot be minted on demand.
//
// Run: npx tsx --env-file=.env.local scripts/smoke-auth-refresh.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient, type Session } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { updateSession } from '../lib/supabase/middleware';
import { middleware } from '../middleware';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Throwaway auth users — NEVER a real account. Deleted in the finally.
const HALF_DEAD_EMAIL = 'smoke-auth-refresh-halfdead@augmtd-internal.test';
const HEALTHY_EMAIL = 'smoke-auth-refresh-healthy@augmtd-internal.test';
const CHUNKED_EMAIL = 'smoke-auth-refresh-chunked@augmtd-internal.test';
const PASS = 'Pr0be-AuthRefresh!42';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(SB_URL, SVC, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
function gate(id: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${id} ${detail}`); }
  else { fail++; console.log(`  ✗ ${id} ${detail}`); }
}

const rawRefresh = (rt: string) =>
  fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rt }),
  });

async function dropUser(email: string) {
  for (let page = 1; page <= 5; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const found = data?.users?.find((u) => u.email === email);
    if (found) { await admin.auth.admin.deleteUser(found.id); return; }
    if (!data?.users?.length || data.users.length < 200) return;
  }
}

async function mintSession(email: string, metadata?: Record<string, unknown>): Promise<Session> {
  await dropUser(email);
  const { error: ce } = await admin.auth.admin.createUser({
    email, password: PASS, email_confirm: true, user_metadata: metadata,
  });
  if (ce) throw new Error(`createUser ${email}: ${ce.message}`);
  const anon = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASS });
  if (error || !data.session) throw new Error(`signIn ${email}: ${error?.message}`);
  return data.session;
}

/** The cookie set @supabase/ssr itself would write for this session (correct names AND chunking). */
async function cookiesFor(session: Session): Promise<{ name: string; value: string }[]> {
  const jar = new Map<string, string>();
  const c = createServerClient(SB_URL, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => { if (!value) jar.delete(name); else jar.set(name, value); }),
    },
  });
  await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

function req(cookies: { name: string; value: string }[], path: string) {
  const r = new NextRequest(new globalThis.URL(`https://app.example.test${path}`));
  cookies.forEach((c) => r.cookies.set(c.name, c.value));
  return r;
}

/** The OLD verdict, verbatim: validate the JWT and believe it. Proves the bug's premise. */
async function legacyVerdict(cookies: { name: string; value: string }[]) {
  const c = createServerClient(SB_URL, ANON, {
    cookies: { getAll: () => cookies, setAll: () => {} },
  });
  const { data } = await c.auth.getUser();
  return data.user;
}

/** Count auth-server round-trips made inside fn. */
async function countAuthCalls<T>(fn: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url.startsWith(`${SB_URL}/auth/v1/`)) calls.push(url.replace(`${SB_URL}/auth/v1/`, '').split('?')[0]);
    return real(input, init);
  }) as typeof fetch;
  try { return { result: await fn(), calls }; } finally { globalThis.fetch = real; }
}

function clearedCookieNames(res: { cookies: { getAll(): { name: string; value: string }[] } }): string[] {
  return res.cookies.getAll().filter((c) => c.value === '').map((c) => c.name);
}

async function main() {
  console.log('\nTHE HALF-DEAD SESSION SUITE\n');

  // ── A. Mint a REAL half-dead session ──────────────────────────────────────────────────────────
  console.log('A. minting a real half-dead session (live Supabase, throwaway user)');
  const dead = await mintSession(HALF_DEAD_EMAIL);
  const deadCookies = await cookiesFor(dead);

  // Rotate twice so the original refresh token is two generations stale — past the reuse-interval
  // grace, which is exactly what a second browser signing into the same account does.
  const rot1 = await (await rawRefresh(dead.refresh_token)).json();
  await sleep(12000);
  await rawRefresh(rot1.refresh_token);
  await sleep(12000);

  const probe = await rawRefresh(dead.refresh_token);
  const probeBody = await probe.json();
  gate('A1 refresh token is DEAD', probe.status === 400 && /refresh_token_(already_used|not_found)/.test(probeBody.error_code ?? ''), `(${probe.status} ${probeBody.error_code})`);

  const jwtCheck = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${dead.access_token}` } });
  gate('A2 access-token JWT is STILL VALID (the half-dead state)', jwtCheck.status === 200, `(GET /user ${jwtCheck.status})`);

  // ── B. The verdict ────────────────────────────────────────────────────────────────────────────
  console.log('\nB. the verdict on the half-dead session');
  const legacyUser = await legacyVerdict(deadCookies);
  gate('B1 OLD logic calls it AUTHENTICATED (the loop premise)', legacyUser?.email === HALF_DEAD_EMAIL, `(${legacyUser?.email ?? 'null'})`);

  const fixedAuthRoute = await updateSession(req(deadCookies, '/login'), { verifyRefreshable: true });
  gate('B2 NEW auth-route verdict returns user:null', fixedAuthRoute.user === null, `(${fixedAuthRoute.user ? 'user present' : 'null'})`);

  // ── C. The loop is structurally broken ────────────────────────────────────────────────────────
  console.log('\nC. the middleware, end to end, on the half-dead cookie');
  const onLogin = await middleware(req(deadCookies, '/login'));
  const loginLoc = onLogin.headers.get('location');
  gate('C1 /login does NOT bounce to /home', !loginLoc || !loginLoc.includes('/home'), `(status ${onLogin.status}, location ${loginLoc ?? 'none'})`);
  const cleared = clearedCookieNames(onLogin as any);
  gate('C2 /login clears the sb-* auth cookies', deadCookies.every((c) => cleared.includes(c.name)), `(cleared: ${cleared.join(', ') || 'none'})`);
  gate('C3 /login never re-sets a dead cookie', !(onLogin as any).cookies.getAll().some((c: any) => c.value && c.name.startsWith('sb-')), '');

  const onHome = await middleware(req(deadCookies, '/home'));
  const homeLoc = onHome.headers.get('location');
  gate('C4 /home does not bounce back to /login (no loop leg)', !homeLoc || !homeLoc.includes('/login'), `(status ${onHome.status}, location ${homeLoc ?? 'none'})`);

  // ── D. The healthy path is untouched ──────────────────────────────────────────────────────────
  console.log('\nD. the healthy path (regression-critical: one auth call, never a false logout)');
  const healthy = await mintSession(HEALTHY_EMAIL);
  const healthyCookies = await cookiesFor(healthy);

  const protectedRun = await countAuthCalls(() => updateSession(req(healthyCookies, '/home'), {}));
  gate('D1 healthy protected route keeps the user', protectedRun.result.user?.email === HEALTHY_EMAIL, `(${protectedRun.result.user?.email ?? 'null'})`);
  gate('D1b ...in exactly ONE auth round-trip', protectedRun.calls.length === 1, `(calls: ${protectedRun.calls.join(', ') || 'none'})`);

  const authRun = await countAuthCalls(() => updateSession(req(healthyCookies, '/login'), { verifyRefreshable: true }));
  gate('D2 healthy auth route keeps the user (no false logout)', authRun.result.user?.email === HEALTHY_EMAIL, `(${authRun.result.user?.email ?? 'null'})`);
  gate('D2b ...also in exactly ONE auth round-trip', authRun.calls.length === 1, `(calls: ${authRun.calls.join(', ') || 'none'})`);

  const loginRedirect = await middleware(req(healthyCookies, '/login'));
  gate('D3 a healthy session on /login still lands on /home', (loginRedirect.headers.get('location') ?? '').includes('/home'), `(${loginRedirect.headers.get('location') ?? 'none'})`);
  gate('D3b ...carrying the rotated cookies (never a stranded refresh token)', (loginRedirect as any).cookies.getAll().some((c: any) => c.name.startsWith('sb-') && c.value), '');

  // Transport hiccup: the auth server is unreachable for the refresh probe. MUST fail open —
  // a Supabase blip may never log a healthy user out. (The one stubbed gate; an outage cannot
  // be minted on demand.) NB: supabase-js logs its own retry stack traces here — that noise is the
  // stub working, not a failure; the gate below is the verdict.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url.includes('/auth/v1/token')) return Promise.reject(new TypeError('fetch failed'));
    return realFetch(input, init);
  }) as typeof fetch;
  let hiccup: Awaited<ReturnType<typeof updateSession>>;
  try { hiccup = await updateSession(req(healthyCookies, '/login'), { verifyRefreshable: true }); }
  finally { globalThis.fetch = realFetch; }
  gate('D4 a transport hiccup on the probe FAILS OPEN (no blip logout)', hiccup.user?.email === HEALTHY_EMAIL, `(${hiccup.user?.email ?? 'null'})`);

  // ── E. No cookies at all ──────────────────────────────────────────────────────────────────────
  console.log('\nE. the clean-cookie paths');
  const anonHome = await middleware(req([], '/home'));
  gate('E1 no cookies + /home = exactly one 307 to /login', anonHome.status === 307 && (anonHome.headers.get('location') ?? '').endsWith('/login'), `(${anonHome.status} → ${anonHome.headers.get('location')})`);
  const anonLogin = await middleware(req([], '/login'));
  gate('E2 no cookies + /login renders (no redirect)', !anonLogin.headers.get('location'), `(status ${anonLogin.status})`);

  // ── F. Chunked cookies ────────────────────────────────────────────────────────────────────────
  console.log('\nF. chunked cookies (sb-<ref>-auth-token.0/.1/…)');
  const chunked = await mintSession(CHUNKED_EMAIL, { padding: 'x'.repeat(4000) });
  const chunkedCookies = await cookiesFor(chunked);
  gate('F1 the session really chunks', chunkedCookies.length > 1 && chunkedCookies.some((c) => /\.\d+$/.test(c.name)), `(${chunkedCookies.map((c) => c.name).join(', ')})`);

  // Kill this session outright so the protected-route branch (the cookie-clearing branch) runs.
  await admin.auth.admin.signOut(chunked.access_token, 'global');
  const chunkedHome = await middleware(req(chunkedCookies, '/home'));
  const chunkCleared = clearedCookieNames(chunkedHome as any);
  gate('F2 a dead session on /home redirects to /login', (chunkedHome.headers.get('location') ?? '').endsWith('/login'), `(${chunkedHome.status} → ${chunkedHome.headers.get('location')})`);
  gate('F3 EVERY chunk is cleared', chunkedCookies.every((c) => chunkCleared.includes(c.name)), `(cleared: ${chunkCleared.join(', ') || 'none'})`);

  console.log(`\n${pass}/${pass + fail} gates\n`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    for (const email of [HALF_DEAD_EMAIL, HEALTHY_EMAIL, CHUNKED_EMAIL]) {
      await dropUser(email).catch(() => {});
    }
    console.log('throwaway users cleaned up');
  });
