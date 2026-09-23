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
  matchEvidence, addressesOf, attendeeAddressByName, registryAddress, evidenceSig,
  EVIDENCE_PER_TYPE, REVERSE_MAX_NOMINATIONS, type EvidencePool, type OpenWork,
} from '../lib/work/evidence-nominator';
import { FULFILLMENT_LAW_VERSION } from '../lib/commitments/fulfillment';
import { mailEventOf, calendarEventOf, transcriptEventOf } from '../lib/evidence/sources';
import type { ActorContext } from '../lib/evidence/types';
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
// ⟲ RE-POINTED (W8.1 EVIDENCE FROM EVERYWHERE): the pool is ONE list of normalized events; the same
// fixtures now enter through each registry row's own pure mapper (mail · calendar · transcript).
const ME: ActorContext = { own: ['me@x.com'], teammates: [], teamDomains: [] };
const legacy = {
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
const pool: EvidencePool = { events: [
  ...legacy.emails.map((m) => mailEventOf(m, ME)),
  ...legacy.events.map((r) => calendarEventOf({ id: r.id, start_time: r.at, end_time: r.end, title: r.title, attendees: r.attendees.map((email) => ({ email })), status: r.cancelled ? 'cancelled' : 'confirmed' }, ME, NOW)).filter((e): e is NonNullable<typeof e> => !!e),
  ...legacy.transcripts.map((r) => transcriptEventOf({ id: r.id, start_time: r.at, title: r.title }, r.attendees, null)),
] };
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

// ⟲ RE-POINTED (W8.1): the nominator is the door onto lib/evidence/** (registry · matcher · ladder ·
// identity); the zero-AI and no-guessing laws now read the whole family, never weaker.
const evFam = ['lib/evidence/types.ts', 'lib/evidence/sources.ts', 'lib/evidence/match.ts', 'lib/evidence/actor.ts', 'lib/evidence/identity.ts'].map(src).join('\n');
ok('the nominator (and the evidence family it delegates to) is zero-AI (no aiCall / getAIClient / factory import)', !/aiCall|getAIClient|lib\/ai\//.test(nom + evFam));
ok('the nominator matches by identity only — address · person id · object (no name-similarity over free text, no keyword list)',
  nom.includes('sameAddress') && evFam.includes('partyMatches') && !/includes\(first\)|\.includes\(cp\)/.test(nom + evFam));
// ⟲ RE-POINTED (W7.1 HEARTBEAT THROUGHPUT): the commitments sweep is a DISPATCHER now; the
// per-account body (evidence + expiry) lives in lib/work/evidence-sweep.ts and runs in each account's
// own /api/internal/sweeps/user job. The laws are unchanged — ONE pool per account, bounded spend
// with leftBehind counted, the inbox lane through the same door — only their home moved.
const esw = src('lib/work/evidence-sweep.ts');
ok('the sweep no longer reads ONE newest email per row',
  !(sweep + esw).includes(".contains('to_addresses', [cpEmail])") && !(sweep + esw).includes("order('received_at', { ascending: false }).limit(1)") && esw.includes('settleWorkByEvidence(admin, userId, e.work, e.evidence)'));
ok('the per-account pass loads ONE evidence pool and bounds its spend (fresh caps + leftBehind/capLeftBehind counted)',
  /const pool = await loadEvidencePool\(admin, userId, since, scopeOf\(/.test(esw) && esw.includes('EVIDENCE_FRESH_CAP') && esw.includes('lane.capLeftBehind++') && esw.includes('lane.leftBehind++'));
ok('the per-account pass carries the INBOX lane through the same door, capped',
  esw.includes("kind: 'inbox'") && /inbox: \d+/.test(esw) && esw.includes(".eq('source', 'email')"));
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
  settle.includes("if (verdict.verdict !== 'delivered') return { judged: true, closed: false") && ful.includes("return { verdict: 'unclear', reason: 'fulfillment judge unavailable'"));
ok('the settle stamps resolved_reason evidence:<type> at the EVIDENCE\'S OWN TIME',
  settle.includes('`evidence:${type}`') && settle.includes('resolved_at: stampAt') && settle.includes('by?.at'));
ok('the settle logs a REVERSIBLE activity type for both kinds (/api/restore reopens it)',
  settle.includes("isCommitment ? 'commitment_done' : 'marked_done'") &&
  REVERSIBLE_TYPE_ENTITY['commitment_done'] === 'commitment' && REVERSIBLE_TYPE_ENTITY['marked_done'] === 'inbox_item');
ok('/api/restore clears the evidence stamp on reopen (resolved_at + resolved_reason)',
  // ⟲ RE-POINTED (W7.6): the route calls THE ONE restore flip (lib/activity/reopen.ts), shared with the repairs.
  src('app/api/restore/route.ts').includes('reopenInboxItem(supabase, user.id, entityId)') && src('app/api/restore/route.ts').includes('reopenCommitment(supabase, user.id, entityId)')
  && src('lib/activity/reopen.ts').includes('delete preSd.resolved_reason') && src('lib/activity/reopen.ts').includes('resolved_reason: null'));
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

// ── TIER 2b · W7.1 HEARTBEAT THROUGHPUT (the fan-out lane · the priority order · fresh-only caps ·
// the scoped pool · the backfill) — found live Sep 23: a nominated commitment stayed open because the
// one serial 95s sweep ran out of clock and its caps were spent by cache hits. ──────────────────────
console.log('\nW7.1 HEARTBEAT THROUGHPUT:');
{
  const fan = src('lib/work/sweep-fanout.ts');
  const userRoute = src('app/api/internal/sweeps/user/route.ts');
  const judge = src('lib/work/judge.ts');
  const bf = src('scripts/backfill-evidence-settles.ts');
  // F · the fan-out lane
  ok("F1 the fan-out has an 'evidence' lane (lane type · guard · marker · per-account budget)",
    /export type SweepLane = 'judgment' \| 'draft' \| 'evidence'/.test(fan) && /x === 'evidence'/.test(fan)
    && /evidence: 'evidence_sweep'/.test(fan) && /evidence: 240_000/.test(fan));
  ok('F2 runUserSweep runs the evidence pass and stamps its rotation marker',
    /lane === 'evidence'[\s\S]{0,400}runEvidenceSweep\(admin, userId, \{ budgetMs \}\)/.test(fan) && /stampServed\(admin, userId, SWEEP_MARKER\.evidence/.test(fan));
  ok('F3 the commitments sweep is a DISPATCHER (the rotation · planDispatch · dispatchSweepJobs \'evidence\')',
    /orderLeastRecentlyServed\(sb, await evidenceSweepUsers\(sb\), SWEEP_MARKER\.evidence\)/.test(sweep)
    && /planDispatch\(users, \{ maxUsers: maxDispatchPerRun\(\) \}\)/.test(sweep) && /dispatchSweepJobs\(plan\.dispatch, 'evidence'/.test(sweep));
  ok('F4 the fallback runs ONLY undispatched accounts, CLAIMED, logged, wall-clock guarded',
    /const fallbackUsers = sent\.failed/.test(sweep) && /claimSweepJob\(sb, uid, 'evidence'\)/.test(sweep)
    && sweep.indexOf('claimSweepJob(') < sweep.indexOf('runUserSweep(sb') && /fan-out fallback/.test(sweep) && /routeDeadline = Date\.now\(\) \+ 265_000/.test(sweep));
  ok('F5 honest counts (dispatched / dispatchFailed / usersLeftBehind incl. the cap\'s remainder)',
    /dispatched: sent\.accepted\.length/.test(sweep) && /dispatchFailed: sent\.failed\.length/.test(sweep) && /usersLeftBehind = plan\.leftBehind\.length/.test(sweep));
  ok('F6 the dispatcher calls no lane directly and walks no rows itself (ONE per-account body)',
    !/settleWorkByEvidence|settleCommitmentByEvidence|judgeCommitmentExpiry|from\('commitments'\)/.test(sweep.replace(/\/\/.*$/gm, '')) && /export const maxDuration = 300/.test(sweep));
  ok('F7 the per-user route accepts the evidence lane', /'judgment', 'draft' or 'evidence'/.test(userRoute));
  ok('F8 the dispatch set includes every account holding an open commitment (a quiet debtor is still owed its pass)',
    /export async function evidenceSweepUsers[\s\S]{0,600}from\('commitments'\)\.select\('user_id'\)[\s\S]{0,80}\.eq\('status', 'open'\)/.test(esw));
  // O · the priority order
  ok('O1 the queue is ordered by orderEvidenceQueue (never updated_at desc)',
    /const queue = orderEvidenceQueue\(/.test(esw) && !/updated_at/.test(esw.replace(/\/\/.*$/gm, '')));
  ok('O2 the tier reads the fulfillment store through ONE sig definition (fulfillmentSigOf)',
    /evidenceTier\(stored\.get\([\s\S]{0,60}fulfillmentSigOf\(n\.evidence\)\)/.test(esw) && ful.includes('const sig = fulfillmentSigOf(candidates);'));
  // C · fresh-only caps
  ok('C1 the fulfillment judge reports cached / fresh on every exit',
    ful.includes('export type FulfillmentJudgment') && ful.includes('cached: true, fresh: false') && ful.includes('cached: false, fresh: true')
    && ful.includes("reason: 'no evidence text to judge', cached: false, fresh: false"));
  ok('C2 the settle propagates cached / fresh', settle.includes('const spend = { cached: verdict.cached, fresh: verdict.fresh }') && (settle.match(/\.\.\.spend/g) ?? []).length >= 4);
  ok('C3 the caps count FRESH only (a slot reserved only for an expected-fresh row; a cache hit never takes one)',
    /if \(expectsFresh\(e\.tier\)\) \{[\s\S]{0,200}freshStarted\[e\.kind\] >= caps\[e\.kind\]/.test(esw) && /if \(countsTowardCap\(r\)\) lane\.fresh\+\+/.test(esw));
  ok('C4 a row the cap deferred is never expiry-judged in the same pass (evidence first)',
    /deferredIds\.add\(e\.id\)/.test(esw) && /if \(deferredIds\.has\(id\)\) \{ out\.expiry\.deferred\+\+/.test(esw));
  // P · the scoped pool
  // ⟲ RE-POINTED (W8.1): the scoped mail lane lives in the mail registry row (lib/evidence/sources.ts);
  // the loader signature stays on the nominator. Same lanes, same bound, same report.
  const srcs = src('lib/evidence/sources.ts');
  ok('P1 the pool loader takes a scope and adds a PAGED people-scoped lane (to/cc overlaps · from in · threads)',
    /export async function loadEvidencePool\(client: SupabaseClient, userId: string, sinceISO: string, scope\?: EvidenceScope/.test(nom)
    && srcs.includes(".overlaps('to_addresses', addrs)") && srcs.includes(".overlaps('cc_addresses', addrs)") && srcs.includes(".in('from_address', addrs)")
    && srcs.includes(".in('thread_id', threads)") && /fetchAllRows<Record<string, unknown>>/.test(srcs));
  ok('P2 the scoped lane is bounded and REPORTED (POOL_SCOPED_MAX · stats.capped)', srcs.includes('POOL_SCOPED_MAX') && srcs.includes('capped') && nom.includes('stats'));
  ok('P3 the newest-first window stays as the safety net (a pool is a superset, never a subset)', /mergePoolEmails\(sc\.rows, newest\)/.test(srcs));
  // ⟲ RE-POINTED (W8.1): the doors also hand the loader the registry they already hold (one
  // registry read per pass) — the scope argument is unchanged, so the regex accepts a trailing option bag.
  ok('P4 every scoped door passes its scope (the sweep · the reverse event door · the judge · the context helper)',
    /loadEvidencePool\(client, userId, since, scopeOf\(touched\)[,)]/.test(nom) && /loadEvidencePool\(client, userId, since, scope\)/.test(judge)
    && /loadEvidencePool\(client, userId, sinceISO, scope[,)]/.test(settle));
  ok('P5 the counterparty resolver CHUNKS instead of slicing (no silent .slice(0, 300))', !/\.slice\(0, (200|300)\)/.test(nom));
  // J · the judge half
  ok('J1 the judge stamps the evidence set it judged against and relaxes the prior anchor on NEW evidence',
    /await writeCache\(client, userId, input, sig, verdict, evSig\)/.test(judge) && /evidenceNewToPrior\(evSig, priorEv\)/.test(judge)
    && /priorEv = typeof t!\.ev === 'string'/.test(judge));
  // B · the backfill
  ok('B1 the backfill is DRY-RUN by default and refuses an unscoped --apply',
    /const APPLY = flag\('--apply'\)/.test(bf) && /if \(APPLY && !ALL && !USER\)[\s\S]{0,160}REFUSED/.test(bf) && /if \(!APPLY\) \{[\s\S]{0,400}planUserEvidence\(sb, uid\)/.test(bf));
  ok('B2 the backfill settles through THE SAME per-account pass (runEvidenceSweep → settleWorkByEvidence), claimed, evidence-only',
    /runEvidenceSweep\(sb, uid, \{[\s\S]{0,120}expiry: false/.test(bf) && /claimSweepJob\(sb, uid, 'evidence'\)/.test(bf) && !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(bf));
  ok('B3 the dry run prints the cost estimate (fresh judgments × the classification-tier cost)', /EST_EUR_PER_JUDGMENT/.test(bf) && /estimated cost/.test(bf));
}

// ── TIER 3 · THE LIVE CENSUS (read-only) ────────────────────────────────────────────────────────
async function census(): Promise<void> {
  if (process.argv.includes('--no-census')) return;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('\n(census skipped — no env)'); return; }
  console.log('\nTHE CENSUS (read-only — what the per-account evidence pass would hand the judge today):');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // ⟲ RE-POINTED (W7.1): the census reads THE SAME plan the live pass executes (planUserEvidence —
  // the people-scoped pool, the priority tiers) instead of a private re-implementation of it.
  const { planUserEvidence, evidenceSweepUsers } = await import('../lib/work/evidence-sweep');
  const tot = { cOpen: 0, iOpen: 0, cNom: 0, iNom: 0, fresh: 0, cached: 0, byType: { email: 0, calendar: 0, transcript: 0 } as Record<string, number> };
  const rows: string[] = [];
  for (const userId of await evidenceSweepUsers(sb)) {
    const plan = await planUserEvidence(sb, userId);
    if (!plan.openCommitments && !plan.openInbox) continue;
    const cNom = plan.queue.filter((e) => e.kind === 'commitment').length;
    const iNom = plan.queue.length - cNom;
    const fresh = plan.queue.filter((e) => e.tier !== 2).length;
    for (const e of plan.queue) for (const t of new Set(e.evidence.map((x) => x.type))) tot.byType[t] = (tot.byType[t] ?? 0) + 1;
    tot.cOpen += plan.openCommitments; tot.iOpen += plan.openInbox; tot.cNom += cNom; tot.iNom += iNom;
    tot.fresh += fresh; tot.cached += plan.queue.length - fresh;
    rows.push(`  ${userId.slice(0, 8)}  commitments ${cNom}/${plan.openCommitments} · inbox ${iNom}/${plan.openInbox} nominated · fresh ${fresh} · cache ${plan.queue.length - fresh} · pool scoped ${plan.pool?.scopedEmails ?? 0} + newest ${plan.pool?.newestEmails ?? 0}`);
  }
  rows.sort().forEach((r) => console.log(r));
  console.log(`  TOTAL  commitments ${tot.cNom}/${tot.cOpen} · inbox ${tot.iNom}/${tot.iOpen} nominated (by type e${tot.byType.email} c${tot.byType.calendar} t${tot.byType.transcript})`);
  console.log(`  next-pass judgments ≈ ${tot.fresh} fresh + ${tot.cached} cache hits (classification tier, ~€0.003 each → ≈ €${(tot.fresh * 0.003).toFixed(2)})`);
  ok('census ran (read-only)', true);
}

census().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('census failed:', e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
