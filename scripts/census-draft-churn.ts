// ════════════════════════════════════════════════════════════════════════════════════════════════
// CENSUS — W9.1 DRAFTS CHANGE ONLY WHEN THE GROUND MOVES + THE USER'S HAND WINS.
// READ-ONLY: SELECTs only, ZERO writes, ZERO AI. Prints user-id prefixes and counts — never titles,
// names or words.
//
// What it measures over the window (default 14 days):
//   A · DEFINITE clock regenerations — pool lanes (a commitment's nudge rows, paste packs, decision
//       briefs, coworker deliverables) where a later row replaced an earlier one ON THE SAME GROUND and
//       the earlier row was never filed as superseded (only the retired 24h clock did that).
//   B · PROBABLE clock regenerations — source_data artifacts (reply draft · nudge · invite · forward;
//       only the newest survives there) the engine wrote > 24h after the inbound they stand on with no
//       thread activity since (an upper bound: a budget-delayed first preparation reads the same).
//   C · the LEGITIMATE re-preparations — the outcome ledger's `superseded` rows (door ground_move),
//       for scale.
//   D · user edits overwritten — (1) steered versions (the user's own direction) the engine later
//       replaced with a pass draft; (2) VOID hand stamps (a stamp whose content no longer hashes —
//       words written over the user's; the permanent regression probe after W9.1); (3) the honest
//       note: before W9.1 an edit was never persisted before Send, so an edit lost to a reload is not
//       recordable server-side.
//
// Run: npx tsx scripts/census-draft-churn.ts [--days 14] [--user <uuid>]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { clockRegenerationsInLane, probableClockRegen, voidHandStamp, type LaneRow } from '../lib/prepare/churn';
import { isHandHeld, isPoolRowHandHeld, type HandKind } from '../lib/prepare/hand';

const argv = process.argv.slice(2);
const val = (f: string): string | null => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const DAYS = Math.max(1, Number(val('--days') ?? 14) || 14);
const ONE = val('--user');
const SINCE_MS = Date.now() - DAYS * 86_400_000;
const SINCE = new Date(SINCE_MS).toISOString();

type Row = Record<string, unknown>;
type T = {
  users: number; poolRows: number; definite: Record<string, number>; probable: Record<string, number>;
  superseded: number; edited: number; steeredOverwritten: number; voidStamps: number; handHeld: number;
};
const tally = (): T => ({ users: 0, poolRows: 0, definite: {}, probable: {}, superseded: 0, edited: 0, steeredOverwritten: 0, voidStamps: 0, handHeld: 0 });
const bump = (m: Record<string, number>, k: string, n = 1) => { if (n) m[k] = (m[k] ?? 0) + n; };

const SD_FIELDS: Array<[string, HandKind]> = [['draft', 'reply_draft'], ['nudge_draft', 'nudge_draft'], ['prepared_invite', 'invite'], ['prepared_forward', 'forward']];

/** Which pool lane a row belongs to (the pass's own task/type conventions). */
function laneOf(r: Row): string | null {
  const meta = (r.metadata ?? {}) as Row;
  const task = String(r.task_id ?? '');
  if (task === 'paste-pack') return 'paste_pack';
  if (task === 'decision-brief') return 'decision_brief';
  if (task === 'prepare-pass') return 'deliverable';
  if (r.kind === 'commitment' && r.type === 'draft' && !task && !meta.hand && meta.version_of !== 'reply_draft') return 'commitment_nudge';
  return null;
}

async function censusUser(sb: SupabaseClient, userId: string, t: T): Promise<void> {
  const [pool, items, signals] = await Promise.all([
    fetchAllRows<Row>((from, to) => sb.from('item_deliverables').select('id, kind, entity_id, task_id, type, content, metadata, created_at')
      .eq('user_id', userId).gte('created_at', SINCE).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('inbox_items').select('id, source_data, last_activity_at')
      .eq('user_id', userId).eq('status', 'pending')
      .order('id', { ascending: true }).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('learning_signals').select('signal_data, created_at')
      .eq('user_id', userId).eq('signal_type', 'action_taken').gte('created_at', SINCE)
      .order('created_at', { ascending: true }).range(from, to)),
  ]);
  if (!pool.length && !items.length && !signals.length) return;
  t.users++;
  t.poolRows += pool.length;

  // A · pool lanes.
  const lanes = new Map<string, LaneRow[]>();
  for (const r of pool) {
    const lane = laneOf(r);
    if (!lane) continue;
    const k = `${lane}|${r.kind}|${r.entity_id}`;
    const arr = lanes.get(k) ?? [];
    arr.push({ id: String(r.id), created_at: String(r.created_at), metadata: (r.metadata ?? {}) as Record<string, unknown> });
    lanes.set(k, arr);
  }
  for (const [k, rows] of lanes) bump(t.definite, k.split('|')[0], clockRegenerationsInLane(rows));

  // D2 · void stamps + hand-held on pool rows.
  for (const r of pool) {
    const meta = (r.metadata ?? {}) as Row;
    if (meta.version_of) continue;
    const kind: HandKind = meta.invite ? 'invite' : meta.pastePack ? 'paste_pack' : r.type === 'draft' ? 'nudge_draft' : 'deliverable';
    if (isPoolRowHandHeld(kind, r as never)) t.handHeld++;
    else if (voidHandStamp(kind, meta, kind === 'invite' ? meta.invite : { content: r.content })) t.voidStamps++;
  }

  // B · source_data artifacts + D2 on them.
  const itemById = new Map<string, Row>();
  for (const it of items) {
    itemById.set(String(it.id), it);
    const sd = (it.source_data ?? {}) as Row;
    for (const [field, kind] of SD_FIELDS) {
      const art = sd[field] as Row | undefined;
      if (!art || art.sent_at) continue;
      if (isHandHeld(kind, art)) { t.handHeld++; continue; }
      if (voidHandStamp(kind, art)) t.voidStamps++;
      if (probableClockRegen(art as never, { windowStartMs: SINCE_MS, lastActivityAt: (it.last_activity_at as string | null) ?? null })) bump(t.probable, field);
    }
  }

  // D1 · steered versions the engine later replaced.
  for (const r of pool) {
    const meta = (r.metadata ?? {}) as Row;
    if (meta.version_of !== 'reply_draft' || meta.steered !== true || r.kind !== 'email') continue;
    const it = itemById.get(String(r.entity_id));
    const draft = ((it?.source_data ?? {}) as Row).draft as Row | undefined;
    if (!draft || draft.prepared !== 'pass') continue;
    if (String(draft.generated_at ?? '') > String(r.created_at) && String(draft.body ?? '').trim() !== String(r.content ?? '').trim()) t.steeredOverwritten++;
  }

  // C · the ledger.
  for (const s of signals) {
    const d = (s.signal_data ?? {}) as Row;
    if (d.outcome === 'superseded') t.superseded++;
    if (d.outcome === 'edited') t.edited++;
  }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('census-draft-churn: no Supabase env — nothing to read (0 writes).'); return; }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  let userIds: string[];
  if (ONE) userIds = [ONE];
  else {
    const rows = await fetchAllRows<Row>((from, to) => sb.from('profiles').select('id').order('id', { ascending: true }).range(from, to));
    userIds = rows.map((r) => String(r.id));
  }
  const t = tally();
  const perUser: Array<{ u: string; definite: number; probable: number }> = [];
  for (const u of userIds) {
    const before = { d: Object.values(t.definite).reduce((a, b) => a + b, 0), p: Object.values(t.probable).reduce((a, b) => a + b, 0) };
    try { await censusUser(sb, u, t); } catch (e) { console.log(`  ${u.slice(0, 8)} — read failed: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
    const d = Object.values(t.definite).reduce((a, b) => a + b, 0) - before.d;
    const p = Object.values(t.probable).reduce((a, b) => a + b, 0) - before.p;
    if (d || p) perUser.push({ u: u.slice(0, 8), definite: d, probable: p });
  }
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  console.log(`\nDRAFT CHURN CENSUS — last ${DAYS} days · ${t.users} account(s) with prepared work · ${t.poolRows} pool rows read · ZERO writes, ZERO AI\n`);
  console.log(`A · DEFINITE clock regenerations (same ground, prior row never filed): ${sum(t.definite)}`);
  for (const [k, n] of Object.entries(t.definite)) console.log(`    ${k.padEnd(18)} ${n}`);
  console.log(`B · PROBABLE clock regenerations (source_data, >24h past its inbound, no activity since — upper bound): ${sum(t.probable)}`);
  for (const [k, n] of Object.entries(t.probable)) console.log(`    ${k.padEnd(18)} ${n}`);
  console.log(`C · legitimate re-preparations on a moved ground (ledger 'superseded'): ${t.superseded} · user-edited sends ('edited'): ${t.edited}`);
  console.log(`D · user edits overwritten:`);
  console.log(`    steered versions later replaced by a pass draft: ${t.steeredOverwritten}`);
  console.log(`    void hand stamps (words written over a saved edit — must be 0 after W9.1): ${t.voidStamps}`);
  console.log(`    hand-held artifacts standing: ${t.handHeld}`);
  console.log(`    note: before W9.1 an edit lived only in the card until Send — an edit lost to a reload left no server record.`);
  console.log(`\nEach A/B regeneration = one drafting call (conversation tier) + one evaluator call (+ at most one capped revision).`);
  if (perUser.length) {
    console.log('\nper account (id prefix · definite · probable):');
    for (const r of perUser.sort((a, b) => (b.definite + b.probable) - (a.definite + a.probable)).slice(0, 25)) console.log(`    ${r.u}  ${r.definite}  ${r.probable}`);
  }
}

main().catch((e) => { console.error('census-draft-churn failed:', e); process.exit(1); });
