// ════════════════════════════════════════════════════════════════════════════════════════════════
// CENSUS — W8.1 EVIDENCE FROM EVERYWHERE: how much open work is NOMINATABLE now vs before.
// READ-ONLY: SELECTs only, ZERO writes, ZERO AI. Prints ids by prefix and counts — never titles/names.
//
// BEFORE = the W3.1/W7.1 semantics, recomputed: the counterparty's ONE primary address (a bare-name
//          meeting counterparty resolved only through the recording's own attendees / linked event),
//          the work's own thread, the legacy evidence types (email · calendar · transcript), no teammate
//          deeds, no feature gating.
// AFTER  = the registry path the live pass runs (planUserEvidence semantics): every address + person
//          id of the resolved person, object + entity keys, every enabled registry row, teammate deeds.
// The owner account is resolved by its user-id prefix (never a stored name); `--user <uuid>` for one.
//
// Run: npx tsx scripts/census-evidence-reach.ts [--user <uuid>] [--owner-prefix 08fe4449] [--commitment dc58e3f0]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { getPersonEntities } from '../lib/entities/people';
import { resolveCommitmentIdentities, loadWorkEntities, mergeKeys } from '../lib/evidence/identity';
import { loadEvidencePool, matchEvidence, inboxKeys, scopeOf, SETTLE_MATCH, type OpenWork, type Evidence } from '../lib/work/evidence-nominator';
import { evidenceSweepUsers } from '../lib/work/evidence-sweep';
import { readPlans } from '../lib/store/item-plans';
import { fulfillmentSigOf, isCurrentLawSig } from '../lib/commitments/fulfillment';

const argv = process.argv.slice(2);
const val = (f: string): string | null => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const OWNER_PREFIX = val('--owner-prefix') ?? '08fe4449';
const TARGET = val('--commitment') ?? 'dc58e3f0';
const ONE = val('--user');

type Row = Record<string, unknown>;
const INBOX_ACTIONABLE = 'work_state.in.(work_prepared,decision_required,action_required),rule_type.eq.needs_reply';

type Tally = { cOpen: number; iOpen: number; cBefore: number; cAfter: number; iBefore: number; iAfter: number; gained: Record<string, number>; lost: number };
const tally = (): Tally => ({ cOpen: 0, iOpen: 0, cBefore: 0, cAfter: 0, iBefore: 0, iAfter: 0, gained: {}, lost: 0 });

/** Why a newly nominated row became nominatable (first reason that explains it). */
function gainReason(after: Evidence[]): string {
  if (after.some((e) => e.by === 'teammate')) return 'teammate deed';
  if (after.some((e) => e.source === 'deeds')) return 'commit-door deed';
  if (after.some((e) => e.key === 'entity')) return 'entity membership';
  return 'person identity (alias · person id · meeting attendees)';
}

async function censusUser(sb: SupabaseClient, userId: string, t: Tally, isOwner: boolean): Promise<void> {
  const [commitments, items] = await Promise.all([
    fetchAllRows<Row>((from, to) => sb.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at, direction')
      .eq('user_id', userId).eq('status', 'open').order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
    fetchAllRows<Row>((from, to) => sb.from('inbox_items').select('id, work_title, created_at, last_activity_at, source_data, type_override')
      .eq('user_id', userId).eq('status', 'pending').eq('source', 'email').or(INBOX_ACTIONABLE)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
  ]);
  const cRows = commitments.filter((c) => !['workflow', 'handoff'].includes(String(c.source ?? '')));
  const iRows = items.filter((it) => it.type_override !== 'waiting_on' && it.type_override !== 'fyi');
  if (!cRows.length && !iRows.length) return;
  const registry = await getPersonEntities(sb, userId);
  const idRows = cRows.map((c) => ({ id: String(c.id), counterparty: (c.counterparty as string | null) ?? null, thread_id: (c.thread_id as string | null) ?? null, source: (c.source as string | null) ?? null, source_id: (c.source_id as string | null) ?? null }));
  const [ids, cEnts, iEnts] = await Promise.all([
    resolveCommitmentIdentities(sb, userId, idRows, registry),
    loadWorkEntities(sb, userId, cRows.map((c) => ({ kind: 'commitment' as const, id: String(c.id) }))),
    loadWorkEntities(sb, userId, iRows.map((it) => ({ kind: 'inbox' as const, id: String(it.id) }))),
  ]);
  // BEFORE's meeting resolution only read the recording's own attendees / its linked event.
  const tIds = [...new Set(cRows.filter((c) => c.source === 'meeting' && c.source_id).map((c) => String(c.source_id)))];
  const legacyMeetingOk = new Set<string>();
  for (let i = 0; i < tIds.length; i += 150) {
    const { data, error } = await sb.from('meeting_transcripts').select('id, attendees, calendar_event_id').eq('user_id', userId).in('id', tIds.slice(i, i + 150));
    if (error) continue;
    for (const r of (data ?? []) as Row[]) if ((Array.isArray(r.attendees) && (r.attendees as unknown[]).length) || r.calendar_event_id) legacyMeetingOk.add(String(r.id));
  }

  type W = { after: OpenWork; before: OpenWork };
  const works: W[] = [];
  for (const c of cRows) {
    const r = ids.get(String(c.id));
    const base = { kind: 'commitment' as const, id: String(c.id), afterISO: String(c.created_at ?? ''), threadId: (c.thread_id as string | null) ?? null,
      fulfiller: String(c.direction) === 'awaiting' ? 'counterparty' as const : 'user' as const, description: String(c.description ?? '') };
    const legacyCp = r?.via === 'meeting' && !legacyMeetingOk.has(String(c.source_id)) ? null : (r?.primary ?? null);
    works.push({
      after: { ...base, counterpartyEmail: r?.primary ?? null, keys: mergeKeys(r?.keys, { entityIds: cEnts.get(`commitment:${c.id}`) ?? [] }) },
      before: { ...base, counterpartyEmail: legacyCp },
    });
  }
  for (const it of iRows) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const k = inboxKeys({ id: String(it.id), source_data: sd }, registry, iEnts);
    const base = { kind: 'inbox' as const, id: String(it.id), afterISO: String(it.last_activity_at ?? it.created_at ?? ''), threadId: (sd.thread_id as string | null) ?? null,
      fulfiller: 'user' as const, description: String(it.work_title ?? ''), counterpartyEmail: k.from };
    works.push({ after: { ...base, keys: k.keys }, before: base });
  }
  const since = works.map((w) => w.after.afterISO).filter(Boolean).sort()[0];
  if (!since) return;
  const nowISO = new Date().toISOString();
  const scope = scopeOf(works.map((w) => w.after));
  const [poolAfter, poolBefore] = await Promise.all([
    loadEvidencePool(sb, userId, since, scope, { registry, nowISO }),
    loadEvidencePool(sb, userId, since, scopeOf(works.map((w) => w.before)), { registry, nowISO, features: null }),
  ]);
  const u = tally();
  for (const w of works) {
    const lane = w.after.kind === 'commitment' ? 'c' : 'i';
    const after = matchEvidence(poolAfter, w.after, nowISO, SETTLE_MATCH);
    const before = matchEvidence(poolBefore, w.before, nowISO);
    if (lane === 'c') { u.cOpen++; if (before.length) u.cBefore++; if (after.length) u.cAfter++; }
    else { u.iOpen++; if (before.length) u.iBefore++; if (after.length) u.iAfter++; }
    if (after.length && !before.length) { const g = gainReason(after); u.gained[g] = (u.gained[g] ?? 0) + 1; }
    if (before.length && !after.length) u.lost++;
    if (isOwner && w.after.id.startsWith(TARGET)) {
      const cal = after.filter((e) => e.type === 'calendar');
      const stored = await readPlans(sb, userId, 'fulfillment', { keys: [`commitment:${w.after.id}`] });
      const sig = String((stored[0]?.tasks as { sig?: string } | null)?.sig ?? '');
      console.log(`\n  TARGET commitment ${TARGET}… (${w.after.fulfiller === 'user' ? 'you_owe' : 'awaiting'}; counterparty resolved via ${ids.get(w.after.id)?.via ?? 'n/a'}):`);
      console.log(`    nominated evidence AFTER: ${after.map((e) => `${e.type}:${e.id.slice(0, 8)}@${e.at.slice(0, 10)}${e.status ? `(${e.status})` : ''}${e.by ? `[${e.by}]` : ''}`).join(' · ') || 'none'}`);
      console.log(`    nominated evidence BEFORE: ${before.map((e) => `${e.type}:${e.id.slice(0, 8)}@${e.at.slice(0, 10)}`).join(' · ') || 'none'}`);
      const sep14 = cal.find((e) => e.at.startsWith('2026-09-14'));
      console.log(`    → nominates the Sep 14 calendar event: ${sep14 ? `YES (${sep14.id.slice(0, 8)}, ${sep14.status})` : 'NO'}`);
      console.log(`    → stored fulfillment verdict: ${sig ? `${isCurrentLawSig(sig) ? 'current law' : 'OLDER law'}${sig === fulfillmentSigOf(after) ? ', same evidence set (cache hit)' : ', evidence set moved (re-judges next pass)'}` : 'none (never judged)'}`);
    }
  }
  const gains = Object.entries(u.gained).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`  ${userId.slice(0, 8)}${isOwner ? ' (owner)' : ''}  commitments ${u.cBefore}→${u.cAfter}/${u.cOpen} · inbox ${u.iBefore}→${u.iAfter}/${u.iOpen}${gains ? ` · gained: ${gains}` : ''}${u.lost ? ` · lost ${u.lost}` : ''}${poolAfter.stats?.gated.length ? ` · gated: ${poolAfter.stats.gated.join('/')}` : ''}${poolAfter.stats?.capped ? ` · CAPPED: ${poolAfter.stats.cappedSources.join('/')}` : ''}`);
  t.cOpen += u.cOpen; t.iOpen += u.iOpen; t.cBefore += u.cBefore; t.cAfter += u.cAfter; t.iBefore += u.iBefore; t.iAfter += u.iAfter; t.lost += u.lost;
  for (const [k, v] of Object.entries(u.gained)) t.gained[k] = (t.gained[k] ?? 0) + v;
}

async function main() {
  // W11.2: READ-ONLY means the working circle's inference cache is never written either.
  (await import('../lib/evidence/circle')).setCirclePersistence(false);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('no Supabase env'); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const users = ONE ? [ONE] : (await evidenceSweepUsers(sb)).sort();
  const owner = users.find((u) => u.startsWith(OWNER_PREFIX)) ?? null;
  console.log(`CENSUS — evidence reach (READ-ONLY · no writes · no AI) · ${users.length} account(s) · owner ${owner ? owner.slice(0, 8) : 'not in set'}\n`);
  const t = tally();
  const ordered = owner ? [owner, ...users.filter((u) => u !== owner)] : users;
  for (const u of ordered) {
    try { await censusUser(sb, u, t, u === owner); } catch (e) { console.log(`  ${u.slice(0, 8)}  error: ${e instanceof Error ? e.message : e}`); }
  }
  console.log(`\nTOTAL  commitments nominatable ${t.cBefore} → ${t.cAfter} of ${t.cOpen} open · inbox ${t.iBefore} → ${t.iAfter} of ${t.iOpen}`);
  console.log(`       gained: ${Object.entries(t.gained).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} · lost: ${t.lost}`);
}

main().catch((e) => { console.error('census failed:', e); process.exit(1); });
