// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HOT-PATH BENCHMARK (event-spine P0 · THE HOT-PATH LAW). READ-ONLY, ZERO AI.
//
// Times the page-load reads of one account in TWO modes through the SAME code:
//   • BEFORE — every lean select is rewritten back to the legacy shape (the whole `source_data`, the
//     deck-context thread listing WITH bodies, the open-commitments pool as `select('*')`), so the
//     derivations run exactly as they did before P0.
//   • AFTER  — the code as it stands (body-free JSON paths + the bounded served-row hydrates).
// Per query: rows, payload bytes (the JSON the client receives) and wall ms, summed per route.
//
// THE SHADOW CHECK (truth must not change): the derived outputs — the Home door's held counts, the
// whole held-ledger payload (bands, classes, members, excerpts, prepared kinds), the deck pool's per-row
// class/floor/snippet derivation, the prepared-work states, the FYI grouping, the open commitments,
// the room anchor, the deck-card contexts — are compared BEFORE vs AFTER, canonically. Any diff fails.
//
// Every write the derivations would make (e.g. the echo-signature cache) is BLOCKED by the client
// proxy and counted — this script never writes. Service role, one account, `.env.local`'s database.
//
// Run: npx tsx --env-file=.env.local scripts/bench-hot-paths.ts [--user <id or id-prefix>] [--json <path>]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COMMITMENT_ROW_COLS, foldLeanRows, hydrateBodies, leanSelect, readLeanPool, DECK_KEYS, FYI_KEYS, BOARD_KEYS } from '../lib/home/lean-source';
import { servedClaimOf } from '../lib/inbox/refresh-understanding';
import { workStatesFor } from '../lib/work/machine';
import { countHeld, hydrateHeldBodies } from '../lib/deeds/held-members';
import { buildHeldPayload } from '../lib/deeds/held-cache';
import { classifyItem } from '../lib/inbox/classify-item';
import { loadUserRules } from '../lib/inbox/rules/load';
import { getCampaignSignature, isCampaignEcho } from '../lib/inbox/campaign-echo';
import { deckEligible, noticeIsDemoted, fromEmailOf, readJudgedNone, DECK_POOL_LIMIT, FYI_POOL_LIMIT, type DeckFloors, type DeckItem } from '../lib/home/deck-floors';
import { getUnderstanding } from '../lib/inbox/item-understanding';
import { preparedStatesFor, preparedState } from '../lib/prepare/read';
import { anchorOf, activityAtOf, looseTitleOf, ANCHOR_ROW_SELECT, foldAnchorRow } from '../lib/room/item-anchor';
import { readDeckContexts, DECK_CONTEXT_MAX_IDS } from '../lib/triage/deck-context-read';
import { MIRROR_SOURCE } from '../lib/inbox/commitment-mirrors';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mode = 'before' | 'after';
type QueryRec = { route: string; table: string; cols: string; start: number; end: number; ms: number; bytes: number; rows: number; error: string | null };

const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] ?? null : null; };
const DAY = 86_400_000;
const FYI_WINDOW_DAYS = 7;                   // app/api/home/brief/route.ts
const FYI_POOL_MAX = FYI_POOL_LIMIT * 10;    // app/api/home/brief/route.ts

// ── THE METERED, WRITE-BLOCKING, MODE-REWRITING CLIENT ───────────────────────────────────────────
class Meter {
  route = '-';
  queries: QueryRec[] = [];
  blockedWrites: string[] = [];
}

const DECK_CTX_EMAIL_COLS_AFTER = 'id, thread_id, from_name, from_address, received_at, is_from_user';

/** BEFORE mode: the legacy shape of a select the P0 code now narrows. */
function legacyCols(table: string, cols: string): string {
  if (table === 'inbox_items' && cols.includes('source_data->')) {
    const kept = cols.split(',').map((c) => c.trim()).filter((c) => c && !c.startsWith('source_data->'));
    return [...kept, 'source_data'].join(', ');
  }
  if (table === 'emails' && cols === DECK_CTX_EMAIL_COLS_AFTER) return 'id, thread_id, from_name, from_address, body, received_at, is_from_user';
  if (table === 'commitments' && cols === COMMITMENT_ROW_COLS) return '*';
  return cols;
}

const chainNoop = (): any => {
  const p: any = new Proxy(function () { /* noop */ }, {
    get: (_t, prop) => prop === 'then' ? (res: (v: unknown) => unknown) => res({ data: null, error: null }) : () => p,
    apply: () => p,
  });
  return p;
};

function instrument(q: any, meter: Meter, table: string, cols: string) {
  const origThen = q.then.bind(q);
  q.then = (onF?: (v: any) => any, onR?: (e: any) => any) => {
    const t0 = performance.now();
    return origThen((res: any) => {
      const data = res?.data;
      const end = performance.now();
      meter.queries.push({
        route: meter.route, table, cols: cols.length > 90 ? cols.slice(0, 87) + '…' : cols,
        start: t0, end, ms: end - t0, bytes: data == null ? 0 : Buffer.byteLength(JSON.stringify(data)),
        rows: Array.isArray(data) ? data.length : data ? 1 : 0, error: res?.error ? String(res.error.message ?? res.error) : null,
      });
      return onF ? onF(res) : res;
    }, onR);
  };
  return q;
}

function meteredClient(real: SupabaseClient, mode: Mode, meter: Meter): any {
  return new Proxy(real as any, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const qb = target.from(table);
          return new Proxy(qb, {
            get(t, p) {
              if (p === 'select') return (cols = '*', opts?: unknown) => {
                const c = mode === 'before' ? legacyCols(table, String(cols)) : String(cols);
                return instrument(t.select(c, opts), meter, table, c);
              };
              if (p === 'insert' || p === 'update' || p === 'upsert' || p === 'delete') {
                return () => { meter.blockedWrites.push(`${String(p)} ${table}`); return chainNoop(); };
              }
              const v = Reflect.get(t, p);
              return typeof v === 'function' ? v.bind(t) : v;
            },
          });
        };
      }
      if (prop === 'rpc') return (fn: string) => { meter.blockedWrites.push(`rpc ${fn}`); return chainNoop(); };
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

// ── CANONICAL COMPARE ────────────────────────────────────────────────────────────────────────────
const canon = (v: unknown): unknown => {
  if (v instanceof Map) return canon(Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), x])));
  if (v instanceof Set) return [...v].map(canon).sort();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])]));
  return v;
};
function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  const ca = canon(a) as any, cb = canon(b) as any;
  if (JSON.stringify(ca) === JSON.stringify(cb)) return null;
  if (ca && cb && typeof ca === 'object' && typeof cb === 'object') {
    for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      const d = firstDiff(ca[k], cb[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  // Never print the values — they are a real account's data. Shape + length only.
  const desc = (v: unknown) => v === undefined ? 'absent' : v === null ? 'null' : `${Array.isArray(v) ? 'array' : typeof v}(${JSON.stringify(v).length})`;
  return `${path}: ${desc(ca)} ≠ ${desc(cb)}`;
}

// ── THE SCENARIOS (each returns the DERIVED output the surface serves) ───────────────────────────
type Ctx = { client: any; meter: Meter; uid: string; email: string | null; today: string; floors: DeckFloors; rules: any[] };

async function heldScenario(c: Ctx) {
  c.meter.route = 'home/brief · held door (countHeld)';
  const counts = await countHeld(c.client, c.uid, c.email);
  c.meter.route = '/api/home/held · served rows (hydrate)';
  await hydrateHeldBodies(c.client, c.uid, counts.derived, c.today);
  const payload = buildHeldPayload(counts.derived, c.today, { filedThisMonth: 0 });
  const numbers = { ...counts } as Partial<typeof counts>;
  delete numbers.derived;
  return { numbers, payload };
}

const snippet = (sd: any, n: number) => String(sd?.body || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function deckScenario(c: Ctx) {
  c.meter.route = 'home/brief · deck pool';
  const { data, error } = await c.client.from('inbox_items')
    .select(leanSelect('id, work_title, work_state, rule_type, type_override, source, source_id, source_meeting_transcript_id, created_at, last_activity_at', { keys: DECK_KEYS, withBody: true }))
    .neq('source', MIRROR_SOURCE)
    .eq('user_id', c.uid).eq('status', 'pending')
    .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
    .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(DECK_POOL_LIMIT);
  if (error) throw new Error(`deck pool: ${error.message}`);
  const items = foldLeanRows(data as Record<string, unknown>[], { keys: DECK_KEYS, withBody: true }) as any[];
  const perRow = items.map((it) => {
    const posture = classifyItem(it, c.rules);
    const sd = it.source_data ?? {};
    return {
      id: it.id, posture, demoted: noticeIsDemoted(it as never, c.floors), eligible: deckEligible(it as DeckItem, posture, c.floors),
      u: getUnderstanding(it), from: fromEmailOf(sd), fromName: sd.from_name ?? null, subject: sd.subject ?? null,
      s240: snippet(sd, 240), s300: snippet(sd, 300), s400: snippet(sd, 400), draft: sd.draft?.body ?? null, meeting: sd.meeting_title ?? null,
      claim: servedClaimOf(sd, getUnderstanding(it) as never, new Date(c.today + 'T12:00:00Z')), echo: c.floors.isEcho(it as DeckItem),
    };
  });
  c.meter.route = 'home/brief · prepared states (rows in hand)';
  const prepared = await preparedStatesFor(c.client, c.uid, items.map((it) => ({
    kind: 'inbox' as const, id: String(it.id), row: { source_data: it.source_data, last_activity_at: it.last_activity_at ?? null },
  })));
  c.meter.route = 'home/brief · work states (rows in hand)';
  const machine = await workStatesFor(c.client, c.uid, items.map((it) => ({
    kind: 'inbox' as const, id: String(it.id), row: { status: 'pending', source_data: it.source_data, last_activity_at: it.last_activity_at ?? null },
  })));
  return { perRow, prepared, machine, ids: items.map((i) => String(i.id)) };
}

async function fyiScenario(c: Ctx) {
  c.meter.route = 'home/brief · FYI pool';
  const now = Date.now();
  const rows = await readLeanPool(c.client, c.uid, (from, to) => c.client.from('inbox_items').select('id')
    .neq('source', MIRROR_SOURCE)
    .eq('user_id', c.uid).eq('status', 'pending').eq('work_state', 'noted')
    .gte('last_activity_at', new Date(now - FYI_WINDOW_DAYS * DAY).toISOString())
    .order('last_activity_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
    .range(from, to), 'id, work_title, rule_type, created_at, last_activity_at', { keys: FYI_KEYS, maxRows: FYI_POOL_MAX }) as any[];
  // Every subject-less row's one-liner reads the body (the brief hydrates only the ≤12 it serves;
  // the shadow check hydrates ALL of them — a stronger claim than the route needs).
  c.meter.route = 'home/brief · FYI served one-liners (hydrate)';
  const subjectless = rows.filter((r) => !String(r.work_title || r.source_data.subject || '').trim());
  await hydrateBodies(c.client, c.uid, subjectless, Math.max(1, subjectless.length));
  return rows.map((r) => {
    const sd = r.source_data ?? {};
    const subject = r.work_title || sd.subject || '';
    const sn = snippet(sd, 100000);
    return {
      id: r.id, fromName: sd.from_name ?? null, from: sd.from ?? null, u: sd.understanding ?? null, unsub: !!sd.has_unsubscribe,
      cc: sd.is_cc_only ?? null, at: sd.received_at ?? null, summary: String(subject).trim() || (sn ? sn.slice(0, 90) : 'Kept in the loop'),
    };
  });
}

async function commitmentsScenario(c: Ctx) {
  c.meter.route = 'home/brief · open commitments';
  const { data, error } = await c.client.from('commitments').select(COMMITMENT_ROW_COLS).eq('user_id', c.uid).eq('status', 'open')
    .order('due_date', { ascending: true, nullsFirst: false }).limit(500);
  if (error) throw new Error(`commitments: ${error.message}`);
  // Ties on due_date come back in either order between two reads — compare as a set (by id).
  return [...(data ?? [])].sort((x: any, y: any) => String(x.id).localeCompare(String(y.id)));
}

async function viewScenario(c: Ctx, ids: string[]) {
  const out: unknown[] = [];
  for (const id of ids) {
    c.meter.route = '/api/items/view · anchor row';
    const { data, error } = await c.client.from('inbox_items').select(ANCHOR_ROW_SELECT.inbox_item).eq('id', id).eq('user_id', c.uid).maybeSingle();
    if (error) throw new Error(`anchor: ${error.message}`);
    c.meter.route = '/api/items/view · the one reader (single)';
    const st = await preparedState(c.client, c.uid, { kind: 'inbox_item', id });
    const row = foldAnchorRow('inbox_item', data);
    out.push({ id, anchor: anchorOf('inbox_item', row, st.all), at: activityAtOf('inbox_item', row), title: looseTitleOf('inbox_item', row), st });
  }
  return out;
}

async function boardScenario(c: Ctx, ids: string[]) {
  // The room board's read (lib/room/grounding.ts) + THE ONE READER on the rows in hand.
  c.meter.route = 'room grounding · board rows';
  const { data, error } = await c.client.from('inbox_items').select(leanSelect('id, work_title, status, last_activity_at', { keys: BOARD_KEYS }))
    .in('id', ids).eq('user_id', c.uid).order('last_activity_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`board: ${error.message}`);
  const rows = foldLeanRows(data, { keys: BOARD_KEYS }) as any[];
  c.meter.route = 'room grounding · prepared states';
  const st = await preparedStatesFor(c.client, c.uid, rows.map((it) => ({ kind: 'inbox' as const, id: String(it.id), row: { source_data: it.source_data, last_activity_at: it.last_activity_at ?? null } })));
  return { board: rows.map((r) => ({ id: r.id, t: r.work_title, s: r.status, sub: r.source_data.subject ?? null, th: r.source_data.thread_id ?? null, att: r.source_data.attachments ?? null, who: r.source_data.from_name ?? r.source_data.from_address ?? null, due: r.source_data.understanding?.deadline ?? null, at: r.source_data.received_at ?? null })), st };
}

async function deckContextScenario(c: Ctx, commitIds: string[]) {
  c.meter.route = '/api/home/deck-context';
  return readDeckContexts(c.client, c.uid, commitIds);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (--env-file=.env.local)'); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const want = (arg('--user') ?? '08fe4449').toLowerCase();
  let uid = want;
  if (want.length < 36) {
    const lo = (want + '00000000-0000-0000-0000-000000000000'.slice(want.length));
    const hiPrefix = (BigInt('0x' + want.replace(/-/g, '')) + BigInt(1)).toString(16).padStart(want.replace(/-/g, '').length, '0');
    const hi = hiPrefix + '00000000-0000-0000-0000-000000000000'.slice(want.length);
    const { data, error } = await sb.from('profiles').select('id, email').gte('id', lo).lt('id', hi);
    if (error || !data?.length) { console.error(`no profile with id prefix ${want}`); process.exit(2); }
    if (data.length > 1) { console.error(`ambiguous prefix ${want} (${data.length} profiles)`); process.exit(2); }
    uid = data[0].id as string;
  }
  const { data: prof } = await sb.from('profiles').select('email').eq('id', uid).maybeSingle();
  const email = (prof?.email as string | null) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nTHE HOT-PATH BENCHMARK — account ${uid.slice(0, 8)}… · read-only · zero AI\n`);

  // Shared, shape-independent inputs (read once).
  const rules = await loadUserRules(uid, sb).catch(() => []);
  const setup = new Meter();
  const setupClient = meteredClient(sb, 'after', setup);
  const sig = await getCampaignSignature(setupClient, uid).catch(() => null);
  const { data: idRows } = await sb.from('inbox_items').select('id').eq('user_id', uid).eq('status', 'pending')
    .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(300);
  const pendingIds = (idRows ?? []).map((r) => String(r.id));
  const judgedNone = await readJudgedNone(sb, uid, pendingIds);
  const floors: DeckFloors = { judgedNone, isEcho: (it) => isCampaignEcho(it as never, sig) };
  const { data: inviteRows } = await sb.from('inbox_items').select('id').eq('user_id', uid).eq('status', 'pending').not('source_data->prepared_invite', 'is', null).limit(10);
  const boardIds = [...new Set([...(inviteRows ?? []).map((r) => String(r.id)), ...pendingIds.slice(0, 30)])].slice(0, 40);
  const viewIds = [...new Set([...(inviteRows ?? []).map((r) => String(r.id)), ...pendingIds.slice(0, 8)])].slice(0, 12);
  const { data: cRows } = await sb.from('commitments').select('id').eq('user_id', uid).eq('status', 'open')
    .order('due_date', { ascending: true, nullsFirst: false }).limit(DECK_CONTEXT_MAX_IDS);
  const commitIds = (cRows ?? []).map((r) => String(r.id));
  console.log(`rules read the body: ${rules.some((r: any) => r.enabled !== false && !r.ai_match && (r.conditions ?? []).some((x: any) => String(x?.field ?? '').startsWith('body_')))} · invite rows sampled: ${(inviteRows ?? []).length} · commitments for deck-context: ${commitIds.length}`);

  const rounds = Math.max(1, Number(arg('--rounds') ?? 2) || 2);
  type Round = { results: Record<Mode, Record<string, unknown>>; meters: Record<Mode, Meter>; wall: Record<Mode, Record<string, number>> };
  const all: Round[] = [];
  for (let r = 0; r < rounds; r++) {
    const round: Round = { results: { before: {}, after: {} }, meters: { before: new Meter(), after: new Meter() }, wall: { before: {}, after: {} } };
    // Alternate the order per round so neither mode always runs on a warm cache.
    for (const mode of (r % 2 === 0 ? ['before', 'after'] : ['after', 'before']) as Mode[]) {
      const meter = round.meters[mode];
      const c: Ctx = { client: meteredClient(sb, mode, meter), meter, uid, email, today, floors, rules };
      const run = async (name: string, f: () => Promise<unknown>) => {
        const t0 = performance.now();
        round.results[mode][name] = await f();
        round.wall[mode][name] = performance.now() - t0;
      };
      await run('held', () => heldScenario(c));
      await run('deck', () => deckScenario(c));
      await run('fyi', () => fyiScenario(c));
      await run('commitments', () => commitmentsScenario(c));
      await run('view', () => viewScenario(c, viewIds));
      await run('board', () => boardScenario(c, boardIds));
      await run('deckContext', () => deckContextScenario(c, commitIds));
    }
    all.push(round);
  }

  // ── THE NUMBERS — bytes are deterministic; ms is each route's WALL SPAN (first query start → last
  //    query end, so parallel reads are not double-counted), the best of the rounds. ──
  const byRoute = (m: Meter) => {
    const o = new Map<string, { q: number; start: number; end: number; bytes: number; rows: number }>();
    for (const q of m.queries) {
      const e = o.get(q.route) ?? { q: 0, start: Infinity, end: 0, bytes: 0, rows: 0 };
      e.q++; e.start = Math.min(e.start, q.start); e.end = Math.max(e.end, q.end); e.bytes += q.bytes; e.rows += q.rows; o.set(q.route, e);
    }
    return new Map([...o.entries()].map(([k, e]) => [k, { q: e.q, ms: e.end - e.start, bytes: e.bytes, rows: e.rows }]));
  };
  const best = (mode: Mode) => {
    const out = new Map<string, { q: number; ms: number; bytes: number; rows: number }>();
    for (const rd of all) for (const [k, e] of byRoute(rd.meters[mode])) {
      const prev = out.get(k);
      out.set(k, prev ? { ...e, ms: Math.min(prev.ms, e.ms) } : e);
    }
    return out;
  };
  const b = best('before'), a = best('after');
  const mb = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} KB`;
  console.log(`\n(${rounds} rounds, alternating order; ms = best wall span per route)`);
  console.log('route                                              |   BEFORE bytes      ms |    AFTER bytes      ms');
  console.log('-'.repeat(104));
  for (const route of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(route), y = a.get(route);
    console.log(`${route.padEnd(50)} | ${(x ? mb(x.bytes) : '—').padStart(12)} ${(x ? x.ms.toFixed(0) : '—').padStart(7)} | ${(y ? mb(y.bytes) : '—').padStart(12)} ${(y ? y.ms.toFixed(0) : '—').padStart(7)}`);
  }
  const homeRoutes = (m: Map<string, { bytes: number; ms: number }>) => [...m.entries()].filter(([r]) => r.startsWith('home/brief')).reduce((acc, [, e]) => ({ bytes: acc.bytes + e.bytes, ms: acc.ms + e.ms }), { bytes: 0, ms: 0 });
  const hb = homeRoutes(b), ha = homeRoutes(a);
  console.log('-'.repeat(104));
  console.log(`${'HOME OPEN (these reads, spans summed)'.padEnd(50)} | ${mb(hb.bytes).padStart(12)} ${hb.ms.toFixed(0).padStart(7)} | ${mb(ha.bytes).padStart(12)} ${ha.ms.toFixed(0).padStart(7)}`);
  const minWall = (mode: Mode, k: string) => Math.min(...all.map((rd) => rd.wall[mode][k]));
  console.log(`\nscenario wall ms, best of rounds (before → after): ${Object.keys(all[0].wall.after).map((k) => `${k} ${minWall('before', k).toFixed(0)}→${minWall('after', k).toFixed(0)}`).join(' · ')}`);
  const meters = { before: { queries: all.flatMap((rd) => rd.meters.before.queries), blockedWrites: all.flatMap((rd) => rd.meters.before.blockedWrites) },
    after: { queries: all.flatMap((rd) => rd.meters.after.queries), blockedWrites: all.flatMap((rd) => rd.meters.after.blockedWrites) } };
  const results = all[0].results;

  // ── THE SHADOW CHECK ──
  let fail = 0;
  const errors = [...meters.before.queries, ...meters.after.queries].filter((q) => q.error);
  for (const q of errors) { fail++; console.log(`  ✗ query error [${q.route}] ${q.table}: ${q.error}`); }
  console.log('\nSHADOW CHECK — derived output BEFORE vs AFTER:');
  for (const k of Object.keys(results.after)) {
    const d = all.map((rd) => firstDiff(rd.results.before[k], rd.results.after[k])).find(Boolean) ?? null;
    if (d) { fail++; console.log(`  ✗ ${k} DIFFERS — ${d}`); }
    else console.log(`  ✓ ${k} identical`);
  }
  const held = results.after.held as { numbers: Record<string, unknown>; payload: any };
  console.log(`  held door: total ${held.numbers.total} · waiting ${held.numbers.waiting} · watched ${held.numbers.watched} · handled ${held.numbers.handled} · pool ${held.numbers.poolRead}`);
  console.log(`  held classes: ${(held.payload.classes ?? []).map((x: any) => `${x.id}:${x.count}`).join(' ')}`);
  const deck = results.after.deck as { perRow: Array<{ eligible: boolean; posture: string }> };
  console.log(`  deck pool: ${deck.perRow.length} rows · eligible ${deck.perRow.filter((r) => r.eligible).length} · postures ${JSON.stringify(deck.perRow.reduce((m: Record<string, number>, r) => { m[r.posture] = (m[r.posture] ?? 0) + 1; return m; }, {}))}`);
  console.log(`  writes blocked (never sent): ${[...setup.blockedWrites, ...meters.before.blockedWrites, ...meters.after.blockedWrites].length}`);

  const json = arg('--json');
  if (json) writeFileSync(json, JSON.stringify({ uid: uid.slice(0, 8), rounds, before: Object.fromEntries(b), after: Object.fromEntries(a), walls: all.map((rd) => rd.wall), queries: meters }, null, 2));
  console.log(fail ? `\n✗ ${fail} failure(s)` : '\n✓ identical — the P0 projection changed bytes, not truth');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
