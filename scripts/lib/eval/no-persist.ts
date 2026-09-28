// THE NO-PERSIST GUARD (eval --user / --no-persist). The Home chat core writes through the client
// it is handed AND through service-role clients it builds itself (hand-offs, artifacts, usage logs),
// so "pass no roomKey" alone cannot promise that a real user's account is left untouched. This guard
// sits one level lower: every supabase-js client resolves the global `fetch` lazily per request, so
// wrapping `globalThis.fetch` refuses every write to the project's Supabase host — PostgREST
// POST/PATCH/PUT/DELETE, storage uploads, edge functions, and any RPC not on the read allowlist —
// with a PostgREST-shaped 403 the core's own error checks already handle. Reads (GET/HEAD, read
// RPCs, storage list/sign) pass. Non-Supabase traffic (the model endpoints) is untouched.
// Pure classifier exported for the unit test.

export type GuardVerdict = { allow: true } | { allow: false; label: string };

/** RPCs that only read (search / listing). Anything else is refused — an unknown RPC may write. */
export const READ_RPC_RE = /^(search_|hybrid_search_|match_|get_|count_|list_)|^drive_augmtd_artifacts$/;

export function classifySupabaseRequest(rawUrl: string, method: string, supabaseUrl: string): GuardVerdict {
  let u: URL, base: URL;
  try { u = new URL(rawUrl); base = new URL(supabaseUrl); } catch { return { allow: true }; }
  if (u.host !== base.host) return { allow: true };
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return { allow: true };
  const p = u.pathname;
  const rpc = /^\/rest\/v1\/rpc\/([^/?]+)/.exec(p);
  if (rpc) return READ_RPC_RE.test(rpc[1]) ? { allow: true } : { allow: false, label: `rpc:${rpc[1]}` };
  const table = /^\/rest\/v1\/([^/?]+)/.exec(p);
  if (table) return { allow: false, label: `${table[1]}.${m === 'POST' ? (/upsert|merge-duplicates/.test(u.search) ? 'upsert' : 'insert') : m === 'PATCH' ? 'update' : m.toLowerCase()}` };
  if (/^\/storage\/v1\/object\/(list|sign)\//.test(p)) return { allow: true };
  if (p.startsWith('/storage/v1/')) return { allow: false, label: `storage:${m} ${p.replace(/^\/storage\/v1\//, '').slice(0, 80)}` };
  if (p.startsWith('/auth/v1/')) return { allow: false, label: `auth:${m} ${p.replace(/^\/auth\/v1\//, '').slice(0, 60)}` };
  if (p.startsWith('/functions/v1/')) return { allow: false, label: `function:${p.replace(/^\/functions\/v1\//, '').slice(0, 60)}` };
  return { allow: false, label: `${m} ${p.slice(0, 80)}` };
}

let installedGuard = false;

/** Wrap global fetch. `onBlock` receives each refused write's label (attribute it to the turn). */
export function installNoPersistGuard(opts: { supabaseUrl: string; onBlock: (label: string) => void }): void {
  if (installedGuard) return;
  installedGuard = true;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    const v = classifySupabaseRequest(url, method, opts.supabaseUrl);
    if (v.allow) return orig(input, init);
    opts.onBlock(v.label);
    return new Response(JSON.stringify({
      code: 'EVAL_NO_PERSIST', message: `eval no-persist guard: write refused (${v.label})`, details: null, hint: null,
    }), { status: 403, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
