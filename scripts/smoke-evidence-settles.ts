// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVIDENCE SETTLES — THE GATE (stabilization W3.1, invariant 7). ZERO AI.
//
// Three tiers: (1) the nominator's pure cores on fixtures (matching · bounding · time order ·
// direction); (2) source floors on every seam the law crosses (the sweep no longer reads one
// newest email; the judge takes a candidate set; the settle stamps evidence:<type>, logs a
// REVERSIBLE type, narrates through the one drain; the three event hooks fire-and-forget and never
// await on the sync path; the law version bumped); (3) a READ-ONLY live census: how many open rows
// the nominator would hand to the judge today, per account (SELECT only — no writes, no AI).
// Run: npx tsx scripts/smoke-evidence-settles.ts        (--no-census skips tier 3)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  matchEvidence, addressesOf, attendeeAddressByName, registryAddress, evidenceSig, loadEvidencePool,
  resolveCommitmentAddresses, EVIDENCE_PER_TYPE, REVERSE_MAX_NOMINATIONS, type EvidencePool, type OpenWork,
} from '../lib/work/evidence-nominator';
import { FULFILLMENT_LAW_VERSION } from '../lib/commitments/fulfillment';
import { REVERSIBLE_TYPE_ENTITY } from '../lib/activity/restore';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');

// ── TIER 1 · THE PURE CORES ──────────────────────────────────────────────────────────────────────
console.log('THE NOMINATOR (pure):');
const NOW = '2026-09-22T12:00:00.000Z';
const CP = 'sam@acme-example.com';
const pool: EvidencePool = {
  emails: [
    { id: 'e-before', at: '2026-08-01T10:00:00Z', subject: 'before', from: 'me@x.com', to: [CP], threadId: 'tA', attachmentCount: 0, fromUser: true },
    { id: 'e1', at: '2026-09-10T10:00:00Z', subject: 'one', from: 'me@x.com', to: ['SAM@Acme-Example.com'], threadId: 'tB', attachmentCount: 1, fromUser: true },
    { id: 'e2', at: '2026-09-12T10:00:00Z', subject: 'two', from: 'me@x.com', to: ['other@x.com', CP], threadId: 'tC', attachmentCount: null, fromUser: true },
    { id: 'e3', at: '2026-09-14T10:00:00Z', subject: 'three', from: 'me@x.com', to: [CP], threadId: 'tD', attachmentCount: 0, fromUser: true },
    { id: 'e4', at: '2026-09-15T10:00:00Z', subject: 'four', from: 'me@x.com', to: [CP], threadId: 'tE', attachmentCount: 0, fromUser: true },
    { id: 'e-stranger', at: '2026-09-13T10:00:00Z', subject: 'stranger', from: 'me@x.com', to: ['nobody@x.com'], threadId: 'tF', attachmentCount: 0, fromUser: true },
    { id: 'e-thread', at: '2026-09-11T10:00:00Z', subject: 'same thread', from: 'me@x.com', to: ['fwd@x.com'], threadId: 't1', attachmentCount: 0, fromUser: true },
    { id: 'e-inbound', at: '2026-09-16T10:00:00Z', subject: 'they wrote', from: CP, to: ['me@x.com'], threadId: 'tG', attachmentCount: 0, fromUser: false },
  ],
  events: [
    { id: 'c-held', at: '2026-09-11T09:00:00Z', end: '2026-09-11T10:00:00Z', title: 'Sync', attendees: [CP], cancelled: false },
    { id: 'c-booked', at: '2026-09-30T09:00:00Z', end: '2026-09-30T10:00:00Z', title: 'Next', attendees: [CP], cancelled: false },
    { id: 'c-cancelled', at: '2026-09-12T09:00:00Z', end: '2026-09-12T10:00:00Z', title: 'Gone', attendees: [CP], cancelled: true },
    { id: 'c-before', at: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z', title: 'Old', attendees: [CP], cancelled: false },
  ],
  transcripts: [
    { id: 'tr1', at: '2026-09-11T09:05:00Z', title: 'Sync (rec)', attendees: [CP] },
    { id: 'tr-none', at: '2026-09-11T09:05:00Z', title: 'Other', attendees: ['x@y.com'] },
  ],
};
const work: OpenWork = { kind: 'commitment', id: 'k1', afterISO: '2026-09-01T00:00:00Z', counterpartyEmail: CP, threadId: 't1', fulfiller: 'user', description: 'send Sam the deck' };
const ev = matchEvidence(pool, work, NOW);
const emailIds = ev.filter((e) => e.type === 'email').map((e) => e.id);
ok('emails: strictly after the origin · to the counterparty (case-blind, cc counts) · newest first · top N',
  JSON.stringify(emailIds) === JSON.stringify(['e4', 'e3', 'e2']) && emailIds.length === EVIDENCE_PER_TYPE, JSON.stringify(emailIds));
ok('a pre-dating deed never nominates', !ev.some((e) => e.id === 'e-before' || e.id === 'c-before'));
ok('a deed to a stranger never nominates', !ev.some((e) => e.id === 'e-stranger'));
ok('the counterparty\'s inbound never settles the USER\'s debt', !ev.some((e) => e.id === 'e-inbound'));
ok('calendar: held vs booked decided by the clock; cancelled excluded',
  JSON.stringify(ev.filter((e) => e.type === 'calendar').map((e) => [e.id, e.status])) === JSON.stringify([['c-booked', 'booked'], ['c-held', 'held']]));
ok('transcript: by attendee address only', JSON.stringify(ev.filter((e) => e.type === 'transcript').map((e) => e.id)) === JSON.stringify(['tr1']));
ok('an AWAITING obligation is settled by THEIR inbound, never by the user\'s own mail',
  JSON.stringify(matchEvidence(pool, { ...work, fulfiller: 'counterparty', threadId: null }, NOW).filter((e) => e.type === 'email').map((e) => e.id)) === JSON.stringify(['e-inbound']));
ok('no address → same-thread user mail only, no meetings (no fuzz, no guess)',
  JSON.stringify(matchEvidence(pool, { ...work, counterpartyEmail: null }, NOW).map((e) => e.id)) === JSON.stringify(['e-thread']));
ok('no origin moment → nothing', matchEvidence(pool, { ...work, afterISO: '' }, NOW).length === 0);
ok('the sig is order-independent and moves with a new piece', evidenceSig(ev) === evidenceSig([...ev].reverse()) && evidenceSig(ev) !== evidenceSig(ev.slice(1)));
ok('addressesOf reads every attendee shape, normalized + deduped',
  JSON.stringify(addressesOf([{ email: 'Sam@Acme-Example.com' }, 'Sam <sam@acme-example.com>', 'p@x.com', { name: 'no email' }])) === JSON.stringify(['sam@acme-example.com', 'p@x.com']));
ok('attendeeAddressByName: exactly one alias-aware hit, ambiguity refuses',
  attendeeAddressByName([{ email: 'sam.vendor@acme-example.com', name: 'Sam Vendor' }], 'Sam') === 'sam.vendor@acme-example.com' &&
  attendeeAddressByName([{ email: 'a@x.com', name: 'Sam A' }, { email: 'b@x.com', name: 'Sam B' }], 'Sam') === null);
ok('registryAddress: stored address → registry alias → null',
  registryAddress([], 'Sam <SAM@acme-example.com>') === 'sam@acme-example.com' &&
  registryAddress([{ id: 'p', name: 'Sam Vendor', aliases: ['sam vendor', CP], state: null, nextTouch: null, lastEventAt: null, quietDays: null }], 'Sam Vendor') === CP &&
  registryAddress([], 'Sam Vendor') === null);
ok('the reverse door is bounded', REVERSE_MAX_NOMINATIONS <= 10);

// ── TIER 2 · SOURCE FLOORS ───────────────────────────────────────────────────────────────────────
console.log('\nTHE SEAMS (source floors):');
const nom = src('lib/work/evidence-nominator.ts');
const settle = src('lib/work/evidence-settle.ts');
const ful = src('lib/commitments/fulfillment.ts');
const sweep = src('app/api/cron/commitments-sweep/route.ts');
const sync = src('lib/email-sync/sync-emails.ts');
const cal = src('lib/calendar/sync-calendar.ts');
const bot = src('lib/integrations/meeting-bot/bot-manager.ts');
const applyV = src('lib/work/apply-verdict.ts');
const state = src('lib/entities/state.ts');

ok('the nominator is zero-AI (no aiCall / getAIClient / factory import)', !/aiCall|getAIClient|lib\/ai\//.test(nom));
ok('the nominator matches by address only (no name-similarity over free text, no keyword list)',
  nom.includes('sameAddress') && !/includes\(first\)|\.includes\(cp\)/.test(nom));
ok('the sweep no longer reads ONE newest email per row',
  !sweep.includes(".contains('to_addresses', [cpEmail])") && !sweep.includes("order('received_at', { ascending: false }).limit(1)") && sweep.includes('settleCommitmentByEvidence'));
ok('the sweep loads ONE evidence pool per user and bounds its spend (cap + leftBehind counted)',
  sweep.includes('userEvidenceContext') && sweep.includes('EVIDENCE_COMMITMENT_JUDGMENTS_PER_SWEEP') && sweep.includes('evidenceLeftBehind'));
ok('the sweep carries the INBOX lane through the same door, capped',
  sweep.includes('settleInboxItemByEvidence') && sweep.includes('EVIDENCE_INBOX_JUDGMENTS_PER_SWEEP'));
ok('the fulfillment judge takes a candidate SET (emails + calendar + transcript facts) and names WHICH piece delivered',
  ful.includes('export async function judgeFulfillmentFromEvidence') && ful.includes('candidates: FulfillmentCandidate[]') &&
  ful.includes('CALENDAR FACT') && ful.includes('MEETING FACT') && ful.includes('"by":'));
ok('the pick is validated in code (an invented label never picks)', ful.includes('labels.get(String(res.json?.by'));
ok('THE MEETING CLAUSE: a held/booked meeting is delivery for a scheduling obligation, never of a report/file/answer',
  ful.includes('THE MEETING CLAUSE') && ful.includes('NEVER delivery of a report'));
ok('the scheduling signal is STRUCTURED (the judgment record\'s work=schedule), never a keyword read',
  // ⟲ RE-POINTED (W2.6 TYPED STORES): the judgment record is read through the typed door
  // (lib/store/item-plans.ts readPlan(…, 'judgment', …)) instead of a raw `.eq('kind', 'judgment')` —
  // the same record, the same structured field; the law (structured, never a keyword read) is unchanged.
  settle.includes("=== 'schedule'") && /readPlan\(client, userId, 'judgment',/.test(settle) && !/\b(schedule|book|call|meet)\w*\s*[|,]/i.test(nom));
ok('the cache sig is the evidence SET under the law version (a new piece re-judges; the same set never re-spends)',
  ful.includes("`${FULFILLMENT_LAW_VERSION}:${candidates.map((c) => `${c.type[0]}${c.id}`).sort().join(',')}`"));
ok('FULFILLMENT_LAW_VERSION bumped past the one-message law (≥5)', FULFILLMENT_LAW_VERSION >= 5, String(FULFILLMENT_LAW_VERSION));
ok('the one-message door survives as a wrapper (both resolvers + the repair sweep keep their seam)',
  ful.includes('export async function judgeCommitmentFulfillment') && ful.includes('return judgeFulfillmentFromEvidence('));
ok('only delivered closes — unclear/promised/failure change nothing on the inbox door',
  settle.includes("if (verdict.verdict !== 'delivered') return { judged: true, closed: false") && ful.includes("return { verdict: 'unclear', reason: 'fulfillment judge unavailable' }"));
ok('the settle stamps resolved_reason evidence:<type> at the EVIDENCE\'S OWN TIME',
  settle.includes('`evidence:${type}`') && settle.includes('resolved_at: stampAt') && settle.includes('by?.at'));
ok('the settle logs a REVERSIBLE activity type for both kinds (/api/restore reopens it)',
  settle.includes("isCommitment ? 'commitment_done' : 'marked_done'") &&
  REVERSIBLE_TYPE_ENTITY['commitment_done'] === 'commitment' && REVERSIBLE_TYPE_ENTITY['marked_done'] === 'inbox_item');
ok('/api/restore clears the evidence stamp on reopen (resolved_at + resolved_reason)',
  src('app/api/restore/route.ts').includes('delete preSd.resolved_reason') && src('app/api/restore/route.ts').includes('resolved_reason: null'));
// ⟲ RE-POINTED (W2.3 RETIRE THE MIRRORS): the settle used to carry its own mirror flip; the one
// harmless archive-only writer now lives in lib/inbox/commitment-mirrors.ts and no new mirror is
// ever written — the settle must reach it through that module, never a private `.eq('source', …)`.
ok('a historical mirror archives with its commitment through THE ONE writer (settleMirrorRows), never a private flip',
  settle.includes("from '@/lib/inbox/commitment-mirrors'") && settle.includes('settleMirrorRows(client, userId, work.id') && !settle.includes("eq('source', 'commitment')"));
ok('narration rides THE ONE drain (apply-verdict\'s narrateResolution, exported)',
  applyV.includes('export async function narrateResolution') && settle.includes('narrateResolution'));
ok('LAW 4 cascades from the close on both doors', settle.includes('applyFulfillmentVerdict') && settle.includes('cascadeConversationSettlement'));
ok('the settle never sends (no send route, no Resend, no mailbox write)', !/sendCoworkerEmail|resend|send-email|sendMail/i.test(settle + nom));
ok('the entity ledger treats evidence:* as a machine stamp (never quoted as the user\'s words)', state.includes("startsWith('evidence:')"));

console.log('\nTHE HOOKS (fire-and-forget, never awaited on the sync path):');
const hookRe = (s: string, type: string) => new RegExp(`void import\\('@/lib/work/evidence-settle'\\)[\\s\\S]{0,400}settleForEvent\\([^)]*type: '${type}'`).test(s);
ok('sync-emails: a user-sent email fires the reverse door (void, .catch, recent-only)', hookRe(sync, 'email') && sync.includes('7 * 86_400_000'));
ok('sync-calendar: the upserted batch fires the reverse door (void, .catch) on both providers\' returns',
  hookRe(cal, 'calendar') && (cal.match(/upsertedEventIds\.push/g) ?? []).length === 2);
ok('bot-manager: a processed transcript fires the reverse door (void, .catch)', hookRe(bot, 'transcript'));
ok('no hook awaits the door', !/await import\('@\/lib\/work\/evidence-settle'\)[\s\S]{0,200}settleForEvent/.test(sync + cal + bot));

// ── TIER 3 · THE LIVE CENSUS (read-only) ────────────────────────────────────────────────────────
async function census(): Promise<void> {
  if (process.argv.includes('--no-census')) return;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('\n(census skipped — no env)'); return; }
  console.log('\nTHE CENSUS (read-only — what the nominator would hand to the judge today):');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { getPersonEntities } = await import('../lib/entities/people');
  const page = async (table: string, select: string, f: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await f(sb.from(table).select(select)).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data ?? [])); if (!data || data.length < 1000) break;
    }
    return out;
  };
  const commits = await page('commitments', 'id, user_id, description, counterparty, thread_id, source, source_id, created_at, direction',
    (q) => q.eq('status', 'open').in('direction', ['you_owe', 'awaiting']).order('created_at', { ascending: false }));
  const items = await page('inbox_items', 'id, user_id, work_title, source_data, created_at, last_activity_at, type_override',
    (q) => q.eq('status', 'pending').eq('source', 'email').or('work_state.in.(work_prepared,decision_required,action_required),rule_type.eq.needs_reply').order('created_at', { ascending: false }));
  const users = [...new Set([...commits.map((c) => c.user_id), ...items.map((i) => i.user_id)])];
  const nowISO = new Date().toISOString();
  const tot = { cOpen: 0, cResolved: 0, cNom: 0, cByType: { email: 0, calendar: 0, transcript: 0 }, cSched: 0, iOpen: 0, iNom: 0, iByType: { email: 0, calendar: 0, transcript: 0 } };
  const rows: string[] = [];
  for (const userId of users) {
    const cs = commits.filter((c) => c.user_id === userId && !['workflow', 'handoff'].includes(String(c.source ?? '')));
    const is = items.filter((i) => i.user_id === userId && i.type_override !== 'waiting_on' && i.type_override !== 'fyi');
    if (!cs.length && !is.length) continue;
    const registry = await getPersonEntities(sb, userId);
    const since = [...cs.map((c) => String(c.created_at)), ...is.map((i) => String(i.last_activity_at ?? i.created_at))].sort()[0];
    const pool = await loadEvidencePool(sb, userId, since);
    const addr = await resolveCommitmentAddresses(sb, userId, cs, registry);
    let cNom = 0, cRes = 0, iNom = 0;
    const cT = { email: 0, calendar: 0, transcript: 0 }, iT = { email: 0, calendar: 0, transcript: 0 };
    for (const c of cs) {
      const cp = addr.get(c.id) ?? null; if (cp) cRes++;
      const w: OpenWork = { kind: 'commitment', id: c.id, afterISO: String(c.created_at), counterpartyEmail: cp, threadId: c.thread_id, fulfiller: c.direction === 'awaiting' ? 'counterparty' : 'user', description: String(c.description ?? '') };
      const e = matchEvidence(pool, w, nowISO);
      if (e.length) { cNom++; for (const t of new Set(e.map((x) => x.type))) cT[t]++; }
    }
    for (const it of is) {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const w: OpenWork = { kind: 'inbox', id: it.id, afterISO: String(it.last_activity_at ?? it.created_at), counterpartyEmail: sd.from_address ? String(sd.from_address).toLowerCase() : null, threadId: (sd.thread_id as string) ?? null, fulfiller: 'user', description: String(it.work_title ?? '') };
      const e = matchEvidence(pool, w, nowISO);
      if (e.length) { iNom++; for (const t of new Set(e.map((x) => x.type))) iT[t]++; }
    }
    tot.cOpen += cs.length; tot.cResolved += cRes; tot.cNom += cNom; tot.iOpen += is.length; tot.iNom += iNom;
    for (const t of ['email', 'calendar', 'transcript'] as const) { tot.cByType[t] += cT[t]; tot.iByType[t] += iT[t]; }
    rows.push(`  ${userId.slice(0, 8)}  commitments ${cNom}/${cs.length} nominated (address resolved ${cRes}; e${cT.email} c${cT.calendar} t${cT.transcript})  ·  inbox ${iNom}/${is.length} nominated (e${iT.email} c${iT.calendar} t${iT.transcript})`);
  }
  rows.sort().forEach((r) => console.log(r));
  console.log(`  TOTAL  commitments ${tot.cNom}/${tot.cOpen} nominated (address resolved ${tot.cResolved}/${tot.cOpen}; by type e${tot.cByType.email} c${tot.cByType.calendar} t${tot.cByType.transcript})`);
  console.log(`  TOTAL  inbox       ${tot.iNom}/${tot.iOpen} nominated (by type e${tot.iByType.email} c${tot.iByType.calendar} t${tot.iByType.transcript})`);
  console.log(`  first-sweep judgments ≈ ${tot.cNom + tot.iNom} (classification tier, ~€0.002–0.004 each → ≈ €${((tot.cNom + tot.iNom) * 0.003).toFixed(2)})`);
  ok('census ran (read-only)', true);
}

census().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('census failed:', e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
