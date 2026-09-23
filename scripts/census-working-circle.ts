// ════════════════════════════════════════════════════════════════════════════════════════════════
// CENSUS — W11.2 THE WORKING CIRCLE: how many OPEN you_owe items gain TEAMMATE evidence once the
// actor ladder reads the circle.
// READ-ONLY: SELECTs only, ZERO writes (the circle's inference cache is switched read-only for the
// process), ZERO AI. Prints COUNTS ONLY — no names, no addresses, no titles, no ids (accounts are
// numbered in scan order).
//
// Three ladders over the SAME pool per account (the real loaders, the real matcher, SETTLE_MATCH):
//   base      — members + corporate domain (the pre-W11.2 ladder)
//   counting  — base + the circle as it COUNTS today (confirmed ∪ inferred above the high bar − removed)
//   confirmed — base + every SUGGESTED address, as if the user confirmed them all (the ceiling)
// "Gains teammate evidence" = the item's nominated evidence holds a teammate deed under that ladder
// and held none under base.
//
// Run: npx tsx scripts/census-working-circle.ts [--user <uuid>]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { getPersonEntities } from '../lib/entities/people';
import { resolveCommitmentIdentities, loadWorkEntities, mergeKeys } from '../lib/evidence/identity';
import { matchEvidence, inboxKeys, scopeOf, SETTLE_MATCH, type OpenWork } from '../lib/work/evidence-nominator';
import { evidenceSweepUsers } from '../lib/work/evidence-sweep';
import { loadEvidenceEvents } from '../lib/evidence/sources';
import { loadActorContext } from '../lib/evidence/actor';
import { computeCircle, countingCircle, readCircleDecisions, setCirclePersistence } from '../lib/evidence/circle';
import type { ActorContext } from '../lib/evidence/types';

setCirclePersistence(false);
const argv = process.argv.slice(2);
const val = (f: string): string | null => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const ONE = val('--user');
type Row = Record<string, unknown>;
const INBOX_ACTIONABLE = 'work_state.in.(work_prepared,decision_required,action_required),rule_type.eq.needs_reply';

type Tally = { accounts: number; withCircle: number; suggested: number; counting: number; auto: number; publicSuggested: number;
  youOwe: number; gainCounting: number; gainConfirmed: number; cGainCounting: number; cGainConfirmed: number; capped: number };
const T: Tally = { accounts: 0, withCircle: 0, suggested: 0, counting: 0, auto: 0, publicSuggested: 0, youOwe: 0, gainCounting: 0, gainConfirmed: 0, cGainCounting: 0, cGainConfirmed: 0, capped: 0 };

const withCircle = (base: ActorContext, circle: string[]): ActorContext => ({ ...base, circle: [...new Set(circle)].filter((a) => !base.teammates.includes(a) && !base.own.includes(a)).sort() });

async function censusUser(sb: SupabaseClient, userId: string, n: number): Promise<void> {
  T.accounts++;
  const base = await loadActorContext(sb, userId, { circle: false });
  const inf = await computeCircle(sb, userId, base);
  if (inf.capped) T.capped++;
  const decisions = await readCircleDecisions(sb, userId).catch(() => []);
  const counting = countingCircle(inf.candidates, decisions);
  const suggested = inf.candidates.map((c) => c.address);
  T.suggested += inf.candidates.length; T.counting += counting.length; T.auto += inf.candidates.filter((c) => c.auto).length;
  T.publicSuggested += inf.candidates.filter((c) => c.publicDomain).length;
  if (inf.candidates.length || counting.length) T.withCircle++;

  const [commitments, items] = await Promise.all([
    fetchAllRows<Row>((from, to) => sb.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at, direction')
      .eq('user_id', userId).eq('status', 'open').order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('inbox_items').select('id, work_title, created_at, last_activity_at, source_data, type_override')
      .eq('user_id', userId).eq('status', 'pending').eq('source', 'email').or(INBOX_ACTIONABLE)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
  ]);
  const cRows = commitments.filter((c) => !['workflow', 'handoff'].includes(String(c.source ?? '')) && String(c.direction) !== 'awaiting');
  const iRows = items.filter((it) => it.type_override !== 'waiting_on' && it.type_override !== 'fyi');
  const line = (g1: number, g2: number, owe: number) =>
    console.log(`  account #${n}: suggested ${inf.candidates.length} (auto ${inf.candidates.filter((c) => c.auto).length}) · counting ${counting.length} · open you_owe ${owe} · gain teammate evidence: counting ${g1} · if all confirmed ${g2}${inf.capped ? ' · READ CAPPED' : ''}`);
  if (!cRows.length && !iRows.length) { line(0, 0, 0); return; }
  const registry = await getPersonEntities(sb, userId);
  const idRows = cRows.map((c) => ({ id: String(c.id), counterparty: (c.counterparty as string | null) ?? null, thread_id: (c.thread_id as string | null) ?? null, source: (c.source as string | null) ?? null, source_id: (c.source_id as string | null) ?? null }));
  const [ids, cEnts, iEnts] = await Promise.all([
    resolveCommitmentIdentities(sb, userId, idRows, registry),
    loadWorkEntities(sb, userId, cRows.map((c) => ({ kind: 'commitment' as const, id: String(c.id) }))),
    loadWorkEntities(sb, userId, iRows.map((it) => ({ kind: 'inbox' as const, id: String(it.id) }))),
  ]);
  const works: OpenWork[] = [];
  for (const c of cRows) {
    const r = ids.get(String(c.id));
    works.push({ kind: 'commitment', id: String(c.id), afterISO: String(c.created_at ?? ''), threadId: (c.thread_id as string | null) ?? null,
      fulfiller: 'user', description: String(c.description ?? ''), counterpartyEmail: r?.primary ?? null,
      keys: mergeKeys(r?.keys, { entityIds: cEnts.get(`commitment:${c.id}`) ?? [] }) });
  }
  for (const it of iRows) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const k = inboxKeys({ id: String(it.id), source_data: sd }, registry, iEnts);
    works.push({ kind: 'inbox', id: String(it.id), afterISO: String(it.last_activity_at ?? it.created_at ?? ''), threadId: (sd.thread_id as string | null) ?? null,
      fulfiller: 'user', description: String(it.work_title ?? ''), counterpartyEmail: k.from, keys: k.keys });
  }
  const since = works.map((w) => w.afterISO).filter(Boolean).sort()[0];
  if (!since) { line(0, 0, works.length); return; }
  const nowISO = new Date().toISOString();
  const scope = scopeOf(works);
  const self = registry.find((p) => p.state?.self === true) ?? null;
  const baseCtx: ActorContext = { ...base, selfPersonId: self?.id ?? null };
  const pool = async (actors: ActorContext) => (await loadEvidenceEvents(sb, userId, {
    sinceISO: since, nowISO, addresses: scope.addresses, threadIds: scope.threadIds, actors,
  }, { registry, entityIds: scope.entityIds, features: null })).events;
  const [pBase, pCount, pAll] = await Promise.all([
    pool(baseCtx), pool(withCircle(baseCtx, counting)), pool(withCircle(baseCtx, [...counting, ...suggested])),
  ]);
  const hasMate = (events: typeof pBase, w: OpenWork) => matchEvidence({ events }, w, nowISO, SETTLE_MATCH).some((e) => e.by === 'teammate');
  let g1 = 0, g2 = 0, c1 = 0, c2 = 0;
  for (const w of works) {
    if (hasMate(pBase, w)) continue;
    const a = hasMate(pCount, w), b = hasMate(pAll, w);
    if (a) { g1++; if (w.kind === 'commitment') c1++; }
    if (b) { g2++; if (w.kind === 'commitment') c2++; }
  }
  T.youOwe += works.length; T.gainCounting += g1; T.gainConfirmed += g2; T.cGainCounting += c1; T.cGainConfirmed += c2;
  line(g1, g2, works.length);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('no Supabase env'); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const users = ONE ? [ONE] : (await evidenceSweepUsers(sb)).sort();
  console.log(`CENSUS — the working circle (READ-ONLY · no writes · no AI · counts only) · ${users.length} account(s)\n`);
  let n = 0;
  for (const u of users) {
    n++;
    try { await censusUser(sb, u, n); } catch (e) { console.log(`  account #${n}: error ${e instanceof Error ? e.message : String(e)}`); }
  }
  console.log(`\nTOTAL  accounts ${T.accounts} (with a circle ${T.withCircle}) · suggested ${T.suggested} (public-domain ${T.publicSuggested}, above the high bar ${T.auto}) · counting today ${T.counting}${T.capped ? ` · reads capped on ${T.capped}` : ''}`);
  console.log(`       open you_owe items ${T.youOwe} · gain teammate evidence: counting ${T.gainCounting} (commitments ${T.cGainCounting}) · if every suggestion were confirmed ${T.gainConfirmed} (commitments ${T.cGainConfirmed})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
