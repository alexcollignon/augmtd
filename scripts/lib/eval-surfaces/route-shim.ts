// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 — CALL A NEXT.JS ROUTE HANDLER IN-PROCESS (eval only). Some producers live only inside a route
// (the coworker DM: app/api/work/threads/[id]/chat/route.ts POST — a 2,700-line native loop with no
// lib entry). To measure THE REAL producer, the eval imports the route module and calls its handler
// with a real NextRequest. Two request-scoped Next.js facilities are bridged, nothing else changes:
//   · `@/lib/supabase/server` createClient() — cookie-bound in production — returns the PROBE HOST's
//     RLS session for the call in flight (AsyncLocalStorage; outside a call it throws, as cookies()
//     does outside a request). The session's auth.getUser() answers from its own access token.
//   · `next/server` after() — request-scoped in production — runs the task at once and the eval
//     awaits it before reading the served result (what the platform does after the response).
// The bridge is installed ONCE, before the first product module loads (require.cache for the server
// client; a property on the plain next/server exports object). Probe hosts only: the CLI refuses any
// other account before this is armed, and the engine's probe write fence stays on.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { AsyncLocalStorage } from 'async_hooks';
import Module, { createRequire } from 'module';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type RouteCtx = { client: SupabaseClient; pending: Promise<unknown>[] };
const als = new AsyncLocalStorage<RouteCtx>();
let installed = false;
const repoRequire = createRequire(path.join(process.cwd(), 'package.json'));

/** An RLS client for a probe host whose auth.getUser() works without a stored session. */
export type ProbeSession = { client: SupabaseClient; userId: string; accessToken: string };

export async function mintProbeSession(admin: SupabaseClient, email: string): Promise<ProbeSession> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY missing (.env.local)');
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new Error(`generateLink failed: ${error?.message ?? 'no token'}`);
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  const token = v?.session?.access_token;
  if (e2 || !token || !v?.user?.id) throw new Error(`verifyOtp failed: ${e2?.message ?? 'no session'}`);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // The route calls auth.getUser() with no argument (a cookie session in production): answer it from
  // this session's own token.
  const auth = client.auth as unknown as { getUser: (jwt?: string) => Promise<unknown> };
  const real = auth.getUser.bind(client.auth);
  auth.getUser = (jwt?: string) => real(jwt ?? token);
  return { client, userId: v.user.id, accessToken: token };
}

/** Arm the bridge. Must run before any module that imports `@/lib/supabase/server` or `next/server`. */
export function installRouteBridge(): void {
  if (installed) return;
  installed = true;
  // 1 · the server client: a cached module under the file's own resolved path.
  const serverPath = repoRequire.resolve(path.join(process.cwd(), 'lib/supabase/server.ts'));
  const fake = new Module(serverPath);
  fake.filename = serverPath;
  fake.loaded = true;
  fake.exports = {
    createClient: async () => {
      const ctx = als.getStore();
      if (!ctx) throw new Error('eval route bridge: createClient() called outside an in-process route call');
      return ctx.client;
    },
  };
  (Module as unknown as { _cache: Record<string, unknown> })._cache[serverPath] = fake;
  // 2 · after(): run now, awaited by the caller before it reads the served result.
  const nextServer = repoRequire('next/server') as Record<string, unknown>;
  nextServer.after = (task: unknown) => {
    const ctx = als.getStore();
    const p = Promise.resolve().then(() => (typeof task === 'function' ? (task as () => unknown)() : task)).catch((e) => { console.error('[eval after()]', (e as Error)?.message ?? e); });
    if (ctx) ctx.pending.push(p);
  };
}

/** Load a route module through the (bridged) CJS loader. */
export function loadRoute<T>(rel: string): T {
  if (!installed) throw new Error('eval route bridge not installed');
  return repoRequire(path.join(process.cwd(), rel)) as T;
}

/** Run `fn` as the probe host's request: createClient() → its session; after() tasks collected and
 *  awaited (bounded) before returning. */
export async function asRouteRequest<T>(client: SupabaseClient, fn: () => Promise<T>, afterTimeoutMs = 120_000): Promise<T> {
  const ctx: RouteCtx = { client, pending: [] };
  return als.run(ctx, async () => {
    const out = await fn();
    // Tasks may schedule further tasks; drain until quiet (bounded).
    const deadline = Date.now() + afterTimeoutMs;
    for (let seen = 0; seen < ctx.pending.length && Date.now() < deadline;) {
      const batch = ctx.pending.slice(seen);
      seen = ctx.pending.length;
      await Promise.race([Promise.all(batch), new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now())))]);
    }
    return out;
  });
}

/** Read a streamed Response body to a string. */
export async function readBody(res: Response): Promise<string> {
  if (!res.body) return await res.text().catch(() => '');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}
