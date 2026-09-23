// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM-OPEN BENCHMARK (stabilization W11.4 — THE ITEM OPENS NOW). READ-ONLY, ZERO AI.
//
// Times the SERVER WORK of every request the deep-dive makes when an item opens, for one account:
//   • view        — GET /api/items/view (the door's ONE outcome read: wave 1 · wave 2 · last-good brief)
//   • commitment  — GET /api/commitments/[id] (the commitment door's facts + source context)
//   • thread      — GET /api/inbox/[id]/thread (the email door's thread read)
//   • entity      — GET /api/items/entity (the header's filing chip — AddToProjectControl)
//   • turns       — GET /api/room/turns (the rail's conversation + the read marker)
//   • judge-cache — the judge's CACHED verdict read only (item_plans 'judgment'). The live judge can
//                   buy a model call on a sig miss, so this script never runs it — its full cost is
//                   the item + neighbourhood load on top of this read (≤ 10s seen in dev logs).
// Each request's work is REPLICATED from its route handler through the SAME library calls, on a
// service-role client whose writes are BLOCKED and counted (after() work is never run). What the
// replica cannot include is per-request overhead: the lambda, middleware's session refresh, and the
// handler's own `auth.getUser()` round trip — the RTT line below prices one Supabase round trip,
// which each real request pays at least twice (middleware + handler).
//
// Printed per kind: ms per request (median of N rounds after one cold round), the SERIAL sum, and
// the PARALLEL wall (all first-paint reads fired at once — the shape the client uses).
//
// Run: npx tsx --env-file=.env.local scripts/bench-item-open.ts [--user <id or id-prefix>]
//        [--commitment <id>] [--email <inbox item id>] [--rounds N]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { performance } from 'perf_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { preparedState } from '../lib/prepare/read';
import { anchorOf, looseRoomKeyOf, ANCHOR_ROW_SELECT, foldAnchorRow, type AnchorLinkKind } from '../lib/room/item-anchor';
import { readRoomResponse } from '../lib/room/brief';
import { buildRoomView, emptySiblings } from '../lib/entities/room-view';
import { workStateOf } from '../lib/work/machine';
import { inboxItemForEmail, meetingSourceOf } from '../lib/commitments/source';
import { loadUserForms, isUserForm } from '../lib/prepare/addressee';
import { readRoomTurns } from '../lib/room/turns';
import { readRoomMarker } from '../lib/room/read-marker';
import { loadUserRules } from '../lib/inbox/rules/load';
import { buildInviteObject } from '../lib/present/invite-object';

/* eslint-disable @typescript-eslint/no-explicit-any */
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] ?? null : null; };
const blocked: string[] = [];

// ── THE WRITE-BLOCKING CLIENT — reads pass through; every write is refused and counted. ──────────
const chainNoop = (): any => {
  const p: any = new Proxy(function () { /* noop */ }, {
    get: (_t, prop) => prop === 'then' ? (res: (v: unknown) => unknown) => res({ data: null, error: null }) : () => p,
    apply: () => p,
  });
  return p;
};
function readOnly(real: SupabaseClient): SupabaseClient {
  return new Proxy(real as any, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const qb = target.from(table);
          return new Proxy(qb, {
            get(t, p) {
              if (p === 'insert' || p === 'update' || p === 'upsert' || p === 'delete') {
                return () => { blocked.push(`${String(p)} ${table}`); return chainNoop(); };
              }
              const v = Reflect.get(t, p);
              return typeof v === 'function' ? v.bind(t) : v;
            },
          });
        };
      }
      if (prop === 'rpc') return (fn: string) => { blocked.push(`rpc ${fn}`); return chainNoop(); };
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as SupabaseClient;
}

// ── THE REPLICAS (each mirrors its route handler's awaited work, minus auth and after()) ─────────
/** BEFORE W11.4: wave 1 as ONE barrier, then wave 2 (every wave-2 read waited on the slowest wave-1 read). */
async function viewWorkBarrier(sb: SupabaseClient, uid: string, kind: 'email' | 'commitment', id: string): Promise<unknown> {
  const linkKind: AnchorLinkKind = kind === 'commitment' ? 'commitment' : 'inbox_item';
  const looseKey = looseRoomKeyOf(linkKind, id);
  const lastGoodP = readRoomResponse(sb, uid, looseKey, { allowStaleVersion: true }).catch(() => null);
  const [, prepState, linkRes, , itemRowRes] = await Promise.all([
    sb.from('item_plans').select('tasks, updated_at').eq('user_id', uid).eq('kind', kind).eq('entity_id', id).maybeSingle(),
    preparedState(sb, uid, { kind: linkKind, id }).catch(() => null),
    sb.from('entity_links').select('entity_id').eq('user_id', uid).eq('item_kind', linkKind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle(),
    sb.from('entity_links').select('item_id').eq('user_id', uid).eq('item_kind', linkKind).eq('item_id', id).maybeSingle(),
    linkKind === 'inbox_item'
      ? sb.from('inbox_items').select(ANCHOR_ROW_SELECT.inbox_item).eq('id', id).eq('user_id', uid).maybeSingle()
      : sb.from('commitments').select(ANCHOR_ROW_SELECT.commitment).eq('id', id).eq('user_id', uid).maybeSingle(),
  ]);
  const itemRow = foldAnchorRow(linkKind, itemRowRes.data ?? null) as any;
  anchorOf(linkKind, itemRow, prepState?.all ?? []);
  const out = await Promise.all([
    linkRes.data?.entity_id ? buildRoomView(sb, uid, linkRes.data.entity_id as string, id) : Promise.resolve({ entity: null, siblings: emptySiblings() }),
    workStateOf(sb, uid, { kind: linkKind === 'inbox_item' ? 'inbox' : 'commitment', id }, { row: itemRow, prepared: prepState } as any).catch(() => null),
    (async () => {
      if (linkKind !== 'commitment' || !itemRow || String(itemRow.source ?? '') !== 'email') return null;
      return inboxItemForEmail(sb, uid, { emailId: itemRow.source_id ? String(itemRow.source_id) : null, threadId: itemRow.thread_id ? String(itemRow.thread_id) : null });
    })(),
    (async () => {
      if (linkKind !== 'commitment' || !itemRow || String(itemRow.source ?? '') !== 'meeting' || !itemRow.source_id) return null;
      const forms = await loadUserForms(sb, uid);
      return meetingSourceOf(sb, uid, String(itemRow.source_id), (who) => isUserForm(who, forms));
    })(),
  ]);
  await lastGoodP;
  return out;
}

/** AFTER W11.4 (the route as it stands): every read started at once, each wave-2 read chained on ITS
 *  OWN input (rail ← link · source objects ← row · machine ← row + prepared), last-good beside. */
async function viewWorkChained(sb: SupabaseClient, uid: string, kind: 'email' | 'commitment', id: string): Promise<unknown> {
  const linkKind: AnchorLinkKind = kind === 'commitment' ? 'commitment' : 'inbox_item';
  const looseKey = looseRoomKeyOf(linkKind, id);
  const planP = Promise.resolve(sb.from('item_plans').select('tasks, updated_at').eq('user_id', uid).eq('kind', kind).eq('entity_id', id).maybeSingle());
  const prepP = preparedState(sb, uid, { kind: linkKind, id }).catch(() => null);
  const linkP = Promise.resolve(sb.from('entity_links').select('entity_id').eq('user_id', uid).eq('item_kind', linkKind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle());
  const anyP = Promise.resolve(sb.from('entity_links').select('item_id').eq('user_id', uid).eq('item_kind', linkKind).eq('item_id', id).maybeSingle());
  const rowP = Promise.resolve(linkKind === 'inbox_item'
    ? sb.from('inbox_items').select(ANCHOR_ROW_SELECT.inbox_item).eq('id', id).eq('user_id', uid).maybeSingle()
    : sb.from('commitments').select(ANCHOR_ROW_SELECT.commitment).eq('id', id).eq('user_id', uid).maybeSingle());
  const foldedP: Promise<any> = rowP.then((r) => foldAnchorRow(linkKind, r.data ?? null));
  const lastGoodP = readRoomResponse(sb, uid, looseKey, { allowStaleVersion: true }).catch(() => null);
  const roomP = linkP.then((l) => l.data?.entity_id ? buildRoomView(sb, uid, l.data.entity_id as string, id) : { entity: null, siblings: emptySiblings() });
  const machineP = Promise.all([foldedP, prepP]).then(([row, ps]) => workStateOf(sb, uid, { kind: linkKind === 'inbox_item' ? 'inbox' : 'commitment', id }, { row, prepared: ps } as any).catch(() => null));
  const srcP = foldedP.then((row) => (linkKind === 'commitment' && row && String(row.source ?? '') === 'email')
    ? inboxItemForEmail(sb, uid, { emailId: row.source_id ? String(row.source_id) : null, threadId: row.thread_id ? String(row.thread_id) : null }) : null);
  const meetP = foldedP.then(async (row) => {
    if (linkKind !== 'commitment' || !row || String(row.source ?? '') !== 'meeting' || !row.source_id) return null;
    const forms = await loadUserForms(sb, uid);
    return meetingSourceOf(sb, uid, String(row.source_id), (who) => isUserForm(who, forms));
  });
  const [, ps, , , rowRes] = await Promise.all([planP, prepP, linkP, anyP, rowP]);
  anchorOf(linkKind, foldAnchorRow(linkKind, rowRes.data ?? null), ps?.all ?? []);
  const out = await Promise.all([roomP, machineP, srcP, meetP]);
  await lastGoodP;
  return out;
}

async function commitmentWork(sb: SupabaseClient, uid: string, id: string): Promise<unknown> {
  const { data: c } = await sb.from('commitments')
    .select('id, direction, description, counterparty, due_date, source, source_id, thread_id, status, created_at')
    .eq('id', id).eq('user_id', uid).maybeSingle();
  if (!c) return null;
  if (c.source === 'email' && c.source_id) {
    await sb.from('emails').select('subject, body, from_name, from_address, received_at').eq('id', c.source_id).eq('user_id', uid).maybeSingle();
  } else if (c.source === 'meeting' && c.source_id) {
    await sb.from('meeting_transcripts').select('title, start_time, summary').eq('id', c.source_id).eq('user_id', uid).maybeSingle();
  }
  return c;
}

async function threadWork(sb: SupabaseClient, uid: string, id: string): Promise<unknown> {
  const { data: item } = await sb.from('inbox_items')
    .select('id, work_title, source_data, created_at, work_state, rule_type, type_override, status, source, project_id')
    .eq('id', id).eq('user_id', uid).maybeSingle();
  if (!item) return null;
  const sd = (item.source_data ?? {}) as Record<string, any>;
  const SELECT = 'id, message_id, from_address, from_name, subject, body, html_body, received_at, is_from_user, to_addresses, cc_addresses';
  return Promise.all([
    loadUserRules(uid, sb).catch(() => null),
    sd.thread_id
      ? sb.from('emails').select(SELECT).eq('user_id', uid).eq('thread_id', sd.thread_id).order('received_at', { ascending: true })
      : sd.email_id ? sb.from('emails').select(SELECT).eq('user_id', uid).eq('id', sd.email_id).maybeSingle() : Promise.resolve(null),
    buildInviteObject(sb, uid, sd).catch(() => null),
  ]);
}

async function entityWork(sb: SupabaseClient, uid: string, kind: 'inbox_item' | 'commitment', id: string): Promise<unknown> {
  const { data: link } = await sb.from('entity_links').select('entity_id')
    .eq('user_id', uid).eq('item_kind', kind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle();
  if (!link?.entity_id) return null;
  return sb.from('work_entities').select('name, state, tracked').eq('id', link.entity_id).eq('user_id', uid).maybeSingle();
}

async function turnsWork(sb: SupabaseClient, uid: string, key: string): Promise<unknown> {
  return Promise.all([readRoomTurns(sb, uid, key), readRoomMarker(sb, uid, key)]);
}

async function judgeCacheWork(sb: SupabaseClient, uid: string, kind: 'inbox' | 'commitment', id: string): Promise<unknown> {
  return sb.from('item_plans').select('tasks').eq('user_id', uid).eq('kind', 'judgment').eq('entity_id', `${kind}:${id}`).maybeSingle();
}

// ── TIMING ────────────────────────────────────────────────────────────────────────────────────────
const timed = async (fn: () => Promise<unknown>): Promise<number> => { const t = performance.now(); await fn(); return performance.now() - t; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const fmt = (ms: number) => `${Math.round(ms)}ms`.padStart(7);

async function benchKind(label: string, reqs: Record<string, () => Promise<unknown>>, rounds: number): Promise<void> {
  console.log(`\n── ${label}`);
  const names = Object.keys(reqs);
  const per: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  const cold: Record<string, number> = {};
  const walls: number[] = [];
  // The PARALLEL pass is the client's first-paint shape: ONE view read (the W11.4 route) beside the rest.
  const firstPaint = names.filter((n) => n !== 'view-before');
  for (let r = 0; r <= rounds; r++) {
    // SERIAL pass — each request alone (its own cost, no contention).
    for (const n of names) { const ms = await timed(reqs[n]); if (r === 0) cold[n] = ms; else per[n].push(ms); }
    // PARALLEL pass — every first-paint read at once (the client's shape).
    const w = await timed(() => Promise.all(firstPaint.map((n) => reqs[n]())));
    if (r > 0) walls.push(w);
  }
  for (const n of names) console.log(`  ${n.padEnd(12)} cold ${fmt(cold[n])} · warm median ${fmt(median(per[n]))}`);
  const serial = firstPaint.reduce((s, n) => s + median(per[n]), 0);
  console.log(`  ${'SERIAL sum'.padEnd(12)}              ${fmt(serial)}  (${firstPaint.join(' + ')})`);
  console.log(`  ${'PARALLEL'.padEnd(12)}              ${fmt(median(walls))}  (the same ${firstPaint.length} fired at once — the client's shape)`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (--env-file=.env.local)'); process.exit(2); }
  const real = createClient(url, key, { auth: { persistSession: false } });
  const sb = readOnly(real);
  const want = (arg('--user') ?? '08fe4449').toLowerCase();
  let uid = want;
  if (want.length < 36) {
    const lo = (want + '00000000-0000-0000-0000-000000000000'.slice(want.length));
    const hiPrefix = (BigInt('0x' + want.replace(/-/g, '')) + BigInt(1)).toString(16).padStart(want.replace(/-/g, '').length, '0');
    const hi = hiPrefix + '00000000-0000-0000-0000-000000000000'.slice(want.length);
    const { data, error } = await real.from('profiles').select('id').gte('id', lo).lt('id', hi);
    if (error || !data?.length) { console.error(`no profile with id prefix ${want}`); process.exit(2); }
    if (data.length > 1) { console.error(`ambiguous prefix ${want} (${data.length} profiles)`); process.exit(2); }
    uid = data[0].id as string;
  }
  const rounds = Math.max(1, Number(arg('--rounds') ?? 3) || 3);

  // The items: named, else the account's most recent open commitment + most recent pending email.
  let cid = arg('--commitment');
  if (!cid) {
    const { data, error } = await real.from('commitments').select('id').eq('user_id', uid).eq('status', 'open')
      .order('created_at', { ascending: false }).limit(1);
    if (error) { console.error('commitment pick failed:', error.message); process.exit(2); }
    cid = (data?.[0]?.id as string | undefined) ?? null;
  }
  let eid = arg('--email');
  if (!eid) {
    const { data, error } = await real.from('inbox_items').select('id').eq('user_id', uid).eq('status', 'pending')
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(1);
    if (error) { console.error('email pick failed:', error.message); process.exit(2); }
    eid = (data?.[0]?.id as string | undefined) ?? null;
  }
  console.log(`\nTHE ITEM-OPEN BENCHMARK — account ${uid.slice(0, 8)}… · read-only · zero AI · ${rounds} warm rounds`);
  console.log(`  commitment ${cid ? cid.slice(0, 8) + '…' : '(none)'} · email ${eid ? eid.slice(0, 8) + '…' : '(none)'}`);

  // One Supabase round trip — what each real request pays again for auth.getUser() (+ middleware).
  const rtts: number[] = [];
  for (let i = 0; i < 5; i++) rtts.push(await timed(async () => real.from('profiles').select('id').eq('id', uid).maybeSingle()));
  console.log(`  one DB round trip ≈ ${Math.round(median(rtts))}ms (each real request adds ≥ 2 of these: middleware session + handler auth)`);

  if (cid) {
    const c = cid;
    await benchKind(`COMMITMENT open — the first-paint reads (before W11.4: view · commitment · entity · turns in parallel, judge beside them)`, {
      'view-before': () => viewWorkBarrier(sb, uid, 'commitment', c),
      'view-after': () => viewWorkChained(sb, uid, 'commitment', c),
      commitment: () => commitmentWork(sb, uid, c),
      entity: () => entityWork(sb, uid, 'commitment', c),
      turns: () => turnsWork(sb, uid, `commitment:${c}`),
      'judge-cache': () => judgeCacheWork(sb, uid, 'commitment', c),
    }, rounds);
  }
  if (eid) {
    const e = eid;
    await benchKind(`EMAIL open — the first-paint reads (view · thread · entity · turns; judge + draft beside them)`, {
      'view-before': () => viewWorkBarrier(sb, uid, 'email', e),
      'view-after': () => viewWorkChained(sb, uid, 'email', e),
      thread: () => threadWork(sb, uid, e),
      entity: () => entityWork(sb, uid, 'inbox_item', e),
      turns: () => turnsWork(sb, uid, `inbox:${e}`),
      'judge-cache': () => judgeCacheWork(sb, uid, 'inbox', e),
    }, rounds);
  }
  console.log(`
THE CLIENT'S SHAPE (not measurable here — a browser + the route; stated from the code):
  BEFORE  click → [router waits: lambda + middleware session + RSC segment] → [deep-dive chunk] → mount
          → view · object · entity · turns · judge all at once (judge contends with the paint's read)
          → nothing painted until the segment + chunk arrived (the 5–9s blank on the owner's walk).
  AFTER   click → THE FRAME paints (prefetched loading boundary; held name from the hover warm)
          → the frame STARTS view + object at the click (overlapping the segment + chunk wait)
          → mount JOINS those flights (or takes their landing once): ONE view + ONE object request
          → entity · turns at mount; judge only after the view settles (≤ 2.5s cap).`);
  console.log(`\n  writes blocked: ${blocked.length}${blocked.length ? ` (${[...new Set(blocked)].join(', ')})` : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
