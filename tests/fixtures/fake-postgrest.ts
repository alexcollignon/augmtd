// An in-memory PostgREST-shaped client for zero-DB gates (W14.2). Tables are plain row arrays; the
// builder supports the filter vocabulary the room/ask modules use: eq · neq · is · not(is) · in ·
// like · filter(<col|json path>, eq|like|ilike) · contains (json) · or (eq/like) · order · range ·
// limit · maybeSingle · select-after-write · insert (enforcing room_turns' dedupe unique index) ·
// update · delete. JSON paths (`component->state->>key`) and select aliases (`a:col->>k`) resolve.
// Deliberately small: it is a gate fixture, never a second database.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function pathGet(r: Row, path: string): any {
  const parts = path.split(/->>?/);
  const text = /->>[^>]*$/.test(path);
  let v: any = r[parts[0].trim()];
  for (const p of parts.slice(1)) v = v == null ? undefined : v[p.trim()];
  if (text && v != null && typeof v !== 'string') return typeof v === 'object' ? JSON.stringify(v) : String(v);
  return v;
}
const likeRe = (pat: string, flags = '') =>
  new RegExp(`^${String(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.').replace(/\*/g, '.*')}$`, flags);
function contains(target: any, want: any): boolean {
  if (Array.isArray(want)) return Array.isArray(target) && want.every((w) => target.some((t: any) => JSON.stringify(t) === JSON.stringify(w)));
  if (want && typeof want === 'object') return !!target && typeof target === 'object' && Object.keys(want).every((k) => contains(target[k], want[k]));
  return target === want;
}
const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

export function fakePostgrest(tables: Record<string, Row[]>) {
  let seq = 0;
  const writes: Array<{ table: string; action: string; payload?: any; ids: string[] }> = [];
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const f: Array<(r: Row) => boolean> = [];
      let action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
      let payload: any = null;
      let cols = '*';
      let returning = false;
      let order: Array<[string, boolean]> = [];
      let lo = 0; let hi = Infinity;
      const q: any = {};
      q.select = (c?: string) => { if (action === 'select') cols = c ?? '*'; else { returning = true; cols = c ?? '*'; } return q; };
      q.eq = (c: string, v: any) => { f.push((r) => { const x = pathGet(r, c); return x === v || (x != null && v != null && String(x) === String(v) && /->>/.test(c)); }); return q; };
      q.neq = (c: string, v: any) => { f.push((r) => pathGet(r, c) !== v); return q; };
      q.is = (c: string, v: any) => { f.push((r) => (pathGet(r, c) ?? null) === v); return q; };
      q.not = (c: string, op: string, v: any) => { f.push((r) => (op === 'is' ? (pathGet(r, c) ?? null) !== v : pathGet(r, c) !== v)); return q; };
      q.in = (c: string, vs: any[]) => { f.push((r) => vs.includes(pathGet(r, c))); return q; };
      q.like = (c: string, p: string) => { f.push((r) => likeRe(p).test(String(pathGet(r, c) ?? ''))); return q; };
      q.ilike = (c: string, p: string) => { f.push((r) => likeRe(p, 'i').test(String(pathGet(r, c) ?? ''))); return q; };
      q.filter = (c: string, op: string, v: any) => (op === 'eq' ? q.eq(c, v) : op === 'like' ? q.like(c, v) : op === 'ilike' ? q.ilike(c, v) : q);
      q.contains = (c: string, v: any) => { f.push((r) => contains(pathGet(r, c), v)); return q; };
      q.or = (expr: string) => {
        const alts = expr.split(',').map((part) => {
          const m = /^(.+?)\.(eq|like)\.(.*)$/.exec(part);
          if (!m) return () => false;
          const [, c, op, v] = m;
          return (r: Row) => (op === 'eq' ? String(pathGet(r, c) ?? '') === v : likeRe(v).test(String(pathGet(r, c) ?? '')));
        });
        f.push((r) => alts.some((a) => a(r)));
        return q;
      };
      q.order = (c: string, o?: { ascending?: boolean }) => { order.push([c, o?.ascending !== false]); return q; };
      q.range = (a: number, b: number) => { lo = a; hi = b; return q; };
      q.limit = (n: number) => { hi = lo + n - 1; return q; };
      q.insert = (p: any) => { action = 'insert'; payload = p; return q; };
      q.upsert = (p: any) => { action = 'upsert'; payload = p; return q; };
      q.update = (p: any) => { action = 'update'; payload = p; return q; };
      q.delete = () => { action = 'delete'; return q; };
      const project = (r: Row) => {
        if (cols.trim() === '*') return clone(r);
        const out: Row = {};
        for (const raw of cols.split(',').map((s) => s.trim()).filter(Boolean)) {
          const m = /^([\w]+):(.+)$/.exec(raw);
          if (m) out[m[1]] = clone(pathGet(r, m[2]));
          else if (/->/.test(raw)) out[raw.split(/->>?/).pop()!] = clone(pathGet(r, raw));
          else out[raw] = clone(r[raw]);
        }
        return out;
      };
      const run = (): { data: any; error: any } => {
        if (action === 'insert' || action === 'upsert') {
          const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
          for (const p of list) {
            if (table === 'room_turns' && p.dedupe_key && rows.some((r) => r.user_id === p.user_id && r.room_key === p.room_key && r.dedupe_key === p.dedupe_key)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_room_turns_dedupe"' } };
            }
            const row = { id: `row-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), archived_at: null, ...clone(p) };
            rows.push(row);
            writes.push({ table, action, payload: p, ids: [row.id] });
          }
          return { data: returning ? list.map(project) : null, error: null };
        }
        let hit = rows.filter((r) => f.every((p) => p(r)));
        if (action === 'update') {
          for (const r of hit) Object.assign(r, clone(payload));
          writes.push({ table, action, payload, ids: hit.map((r) => r.id) });
          return { data: returning ? hit.map(project) : null, error: null };
        }
        if (action === 'delete') {
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          writes.push({ table, action, ids: hit.map((r) => r.id) });
          return { data: returning ? hit.map(project) : null, error: null };
        }
        for (const [c, asc] of [...order].reverse()) hit = [...hit].sort((a, b) => (String(a[c] ?? '') < String(b[c] ?? '') ? (asc ? -1 : 1) : String(a[c] ?? '') > String(b[c] ?? '') ? (asc ? 1 : -1) : 0));
        hit = hit.slice(lo, hi === Infinity ? undefined : hi + 1);
        return { data: hit.map(project), error: null };
      };
      q.maybeSingle = () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }); };
      q.single = q.maybeSingle;
      q.then = (res: (v: any) => any, rej?: (e: any) => any) => Promise.resolve(run()).then(res, rej);
      return q;
    },
  };
  return { client: client as any, tables, writes };
}
