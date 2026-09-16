// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REACH SUITE (permanent — proactive-reach LAW 1, docs/proactive-reach-plan.md).
//
// "A law is only alive while a gate enforces it." This suite holds THE REACH LAW: the nominator is
// pure and zero-AI, anchor-passed items lead the judgment queue, the preparation pass consumes the
// SAME module (there is no second ordering), the dedicated judgment sweep exists with its own
// budget and honest leftBehind accounting, and the judge reads a code-computed anchor fact.
//
// Zero AI, zero network: facts suffice (the census doctrine — assert the law on data and source).
// Run: npx tsx --env-file=.env.local scripts/smoke-reach.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  nominateForJudgment, orderForPreparation, anchorStatusOf, anchorPassedFact,
  type NominatorItem, type JudgmentAge,
} from '../lib/work/judgment-nominator';
import { stripDeixis, carriesDayWord } from '../lib/inbox/deixis';
import {
  quoteProvesContinuity, normalizeSubject, normalizeRfcId, pairKey, siblingSettledFact,
  CONVERSATION_IDENTITY_VERSION, type SiblingNomination,
} from '../lib/inbox/conversation-identity';
import { dateStatedInText, quoteProvesDate } from '../lib/utils/user-time';
import { meetingWhenLabel, prepTurnText, PREP_NOTHING } from '../lib/home/anticipation';
import { composeResolutionLine, composeRevisitLine } from '../lib/work/apply-verdict';
import {
  outcomeHistoryFact, outcomeRegisterFact, outcomeDigest, outcomeSigPart, speakableRows,
  OUTCOME_FACTS_VERSION, OUTCOME_WINDOW_DAYS, OUTCOME_MIN_N, type OutcomeFacts, type LaneStats,
} from '../lib/prepare/outcome-facts';

import {
  refreshUnderstandingForArrival, understandingClaimIsStale, servedClaimOf,
} from '../lib/inbox/refresh-understanding';
import { approvalLine, holdLine, deliveryPhrase } from '../lib/workflows/standing';
import { endAtBoundary } from '../lib/workflows/report-back';

const root = join(__dirname, '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TODAY = '2026-09-13';
const item = (key: string, o: Partial<NominatorItem> = {}): NominatorItem =>
  ({ key, anchor: null, activityAt: null, ...o });
const judged = (key: string, at: string | null): JudgmentAge => ({ key, judgedAt: at });
const order = (ns: ReturnType<typeof nominateForJudgment>) => ns.map((n) => n.item.key);

// ── R1 · THE NOMINATOR IS PURE AND ZERO-AI ──────────────────────────────────────────────────────
console.log('\nR1 · the nominator is pure, zero-AI, exported');
{
  const s = src('lib/work/judgment-nominator.ts');
  ok('no supabase client in the nominator', !/@supabase|SupabaseClient|createClient/.test(s));
  ok('no AI client / aiCall in the nominator', !/aiCall\(|getAIClient|openai|anthropic/i.test(s));
  ok('no imports at all (pure module)', !/^\s*import\s/m.test(s));
  ok('nominateForJudgment exported', typeof nominateForJudgment === 'function');
  ok('orderForPreparation exported', typeof orderForPreparation === 'function');
  ok('anchorPassedFact exported', typeof anchorPassedFact === 'function');
  // AGNOSTIC CLAUSE: nothing in the ordering may name a person, sender, vendor or language.
  ok('no hardcoded identity tokens', !/@[a-z0-9-]+\.(com|pt|de|ai)\b/i.test(s));
}

// ── R2 · THE ANCHOR TEST ────────────────────────────────────────────────────────────────────────
console.log('\nR2 · the anchor test (code-verifiable dates only)');
{
  ok('a past stated date is anchor-passed', anchorStatusOf(item('a', { anchor: '2026-09-11' }), TODAY).passed);
  ok('   …with the day count computed', anchorStatusOf(item('a', { anchor: '2026-09-11' }), TODAY).daysPast === 2);
  ok('today is NOT passed', !anchorStatusOf(item('a', { anchor: TODAY }), TODAY).passed);
  ok('a future date is NOT passed', !anchorStatusOf(item('a', { anchor: '2026-09-30' }), TODAY).passed);
  ok('no date is NOT passed', !anchorStatusOf(item('a'), TODAY).passed);
  ok('junk is NOT passed', !anchorStatusOf(item('a', { anchor: 'tomorrow' as string }), TODAY).passed);
  const meet = item('m', { meetingPassedAt: '2026-09-11T10:00:00Z', activityAt: '2026-09-10T09:00:00Z' });
  ok('a meeting that started after the item counts', anchorStatusOf(meet, TODAY).passed);
  ok('   …and is labelled as the meeting source', anchorStatusOf(meet, TODAY).source === 'meeting_started');
  const older = item('m2', { meetingPassedAt: '2026-09-01T10:00:00Z', activityAt: '2026-09-10T09:00:00Z' });
  ok('a meeting BEFORE the item is not its anchor', !anchorStatusOf(older, TODAY).passed);
  const stated = item('m3', { anchor: '2026-09-05', meetingPassedAt: '2026-09-11T10:00:00Z' });
  ok('the item\'s own stated date wins over the meeting signal', anchorStatusOf(stated, TODAY).source === 'stated_date');
}

// ── R3 · THE REACH ORDER ────────────────────────────────────────────────────────────────────────
console.log('\nR3 · the reach order — anchor-passed first, then least-recently-judged, then recency');
{
  const items = [
    item('inbox:live-never', { activityAt: '2026-09-12T00:00:00Z' }),                       // never judged
    item('inbox:anchor-fresh', { anchor: '2026-09-11', activityAt: '2026-09-10T00:00:00Z' }), // judged AFTER the anchor
    item('inbox:anchor-stale', { anchor: '2026-09-11', activityAt: '2026-09-10T00:00:00Z' }), // judged BEFORE the anchor
    item('inbox:old-judged', { activityAt: '2026-08-01T00:00:00Z' }),
    item('inbox:fresh-judged-a', { activityAt: '2026-09-12T00:00:00Z' }),
    item('inbox:fresh-judged-b', { activityAt: '2026-09-01T00:00:00Z' }),
  ];
  const ages = [
    judged('inbox:anchor-fresh', '2026-09-12T08:00:00Z'),
    judged('inbox:anchor-stale', '2026-09-08T08:00:00Z'),
    judged('inbox:old-judged', '2026-08-12T08:00:00Z'),
    judged('inbox:fresh-judged-a', '2026-09-12T08:00:00Z'),
    judged('inbox:fresh-judged-b', '2026-09-12T08:00:00Z'),
  ];
  const o = order(nominateForJudgment(items, ages, { todayStr: TODAY }));
  ok('both anchor-passed items lead', o[0].startsWith('inbox:anchor') && o[1].startsWith('inbox:anchor'), o.join(' > '));
  ok('the judgment that PREDATES the anchor leads its tier', o[0] === 'inbox:anchor-stale', o.join(' > '));
  ok('an anchor-passed item outranks a never-judged one', o.indexOf('inbox:anchor-fresh') < o.indexOf('inbox:live-never'), o.join(' > '));
  ok('never judged outranks the oldest judged', o.indexOf('inbox:live-never') < o.indexOf('inbox:old-judged'), o.join(' > '));
  ok('the older judgment outranks the fresher one', o.indexOf('inbox:old-judged') < o.indexOf('inbox:fresh-judged-a'), o.join(' > '));
  ok('activity recency breaks an equal-staleness tie', o.indexOf('inbox:fresh-judged-a') < o.indexOf('inbox:fresh-judged-b'), o.join(' > '));
  // NO SILENT CAPS (the deck-pool lesson): every candidate is nominated, ranks are 1..n, once each.
  const ns = nominateForJudgment(items, ages, { todayStr: TODAY });
  ok('every candidate is nominated exactly once', ns.length === items.length && new Set(order(ns)).size === items.length);
  ok('ranks are dense 1..n', ns.every((n, i) => n.rank === i + 1));
  ok('the order is stable across runs', order(nominateForJudgment(items, ages, { todayStr: TODAY })).join() === o.join());
  ok('every nomination carries an honest reason', ns.every((n) => n.reason.length > 0));
  ok('a never-judged nomination says so', ns.find((n) => n.item.key === 'inbox:live-never')!.reason.includes('never judged'));
  ok('an anchor-passed nomination names its date', ns[0].reason.includes('2026-09-11'));
}

// ── R4 · THE PREPARATION ORDER SHARES THE MODULE ────────────────────────────────────────────────
console.log('\nR4 · the pass consumes the nominator — one ordering, not two');
{
  const items = [
    item('inbox:heavy', { activityAt: '2026-09-12T00:00:00Z' }),
    item('inbox:anchor', { anchor: '2026-09-01', activityAt: '2026-09-10T00:00:00Z' }),
    item('inbox:unattempted', { activityAt: '2026-09-11T00:00:00Z' }),
  ];
  const weight = new Map([['inbox:heavy', 90], ['inbox:anchor', 10], ['inbox:unattempted', 5]]);
  const o = order(orderForPreparation(items, [], {
    todayStr: TODAY,
    attempted: (k) => k !== 'inbox:unattempted',
    weightOf: (k) => weight.get(k) ?? 0,
  }));
  ok('anchor-passed leads even the heaviest entity weight', o[0] === 'inbox:anchor', o.join(' > '));
  ok('never-attempted then leads (W2 discipline preserved)', o[1] === 'inbox:unattempted', o.join(' > '));
  ok('entity weight still orders the rest', o[2] === 'inbox:heavy', o.join(' > '));

  const p = src('lib/prepare/pass.ts');
  ok('the pass imports the one nominator', /from '@\/lib\/work\/judgment-nominator'/.test(p));
  ok('the pass calls orderForPreparation', /orderForPreparation\(/.test(p));
  ok('the pass has NO second comparator', !/const byPriority\s*=/.test(p));
  ok('the pass exports the shared candidate derivation', /export function judgmentCandidates/.test(p));
  ok('the pass exports the judgment-age reader', /export async function readJudgmentAges/.test(p));
  ok('the judgment ages are read PAGED (no 1000-row cap)', /fetchAllRows[\s\S]{0,400}kind', 'judgment'/.test(p));
}

// ── R5 · THE GUARANTEED BUDGET (its own cron, honest accounting) ────────────────────────────────
console.log('\nR5 · the judgment sweep — its own budget, honest leftBehind');
{
  const r = src('app/api/cron/judgment-sweep/route.ts');
  ok('the route is CRON_SECRET-gated', /CRON_SECRET/.test(r));
  ok('maxDuration is set to 300', /export const maxDuration = 300/.test(r));
  ok('a wall-clock guard stops it cleanly', /routeDeadline/.test(r));
  ok('it reports leftBehind', /leftBehind/.test(r));
  ok('it reports usersLeftBehind', /usersLeftBehind/.test(r));
  ok('it walks least-recently-served first', /orderLeastRecentlyServed/.test(r));
  ok('vercel.json schedules it', /\/api\/cron\/judgment-sweep/.test(src('vercel.json')));

  const s = src('lib/work/judgment-sweep.ts');
  ok('the sweep consumes nominateForJudgment', /nominateForJudgment\(/.test(s));
  ok('the sweep judges through the ONE judge', /judgeWork\(/.test(s));
  ok('the sweep settles through the ONE consequence door', /applyVerdictConsequences\(/.test(s));
  ok('REACH NEVER DRAFTS: no preparation is reachable from the sweep', !/prepareOneItem|runPreparationPass|generateReplyDraft|generateNudgeDraft/.test(s));
  ok('it counts what it left behind', /leftBehind = queue\.length/.test(s));
  ok('it shares the candidate derivation with the pass', /judgmentCandidates/.test(s));

  const u = src('lib/work/sweep-users.ts');
  ok('the rotation is ONE implementation', /export async function activeUserIds/.test(u) && /export async function orderLeastRecentlyServed/.test(u));
  ok('draft-sweep reads the same rotation', /orderLeastRecentlyServed/.test(src('app/api/cron/draft-sweep/route.ts')));
  ok('the sovereign tier stays active-eligible (meetings/items, not only connections)', /meeting_transcripts/.test(u) && /inbox_items/.test(u));
}

// ── R6 · THE JUDGE READS A CODE-COMPUTED ANCHOR FACT ────────────────────────────────────────────
console.log('\nR6 · the anchor fact is a FACT, not a disposition');
{
  const line = anchorPassedFact('2026-09-11', TODAY);
  ok('a passed date produces a fact line', line.includes('2026-09-11'));
  ok('   …stating how long ago, in days', /PASSED 2 days ago/.test(line));
  ok('   …declaring it was computed in code', /computed in code/.test(line));
  ok('   …leaving the disposition to the judge', /judge it, never assume either/.test(line));
  ok('   …and never auto-expiring anything', /still genuinely owed late/.test(line));
  ok('today produces NO line', anchorPassedFact(TODAY, TODAY) === '');
  ok('a future date produces NO line', anchorPassedFact('2026-10-01', TODAY) === '');
  ok('junk produces NO line', anchorPassedFact('sometime', TODAY) === '');
  ok('null produces NO line', anchorPassedFact(null, TODAY) === '');
  const j = src('lib/work/judge.ts');
  ok('the judge assembles the anchor fact', /anchorPassedFact\(dueDate, todayStr\)/.test(j));
  ok('the judge imports it from the one module', /from '@\/lib\/work\/judgment-nominator'/.test(j));
}

// ── R8 · THE ECHO FLOOR (LAW 5) ──────────────────────────────────────────────────────────────────
// Fixtures below are SYNTHETIC — invented tokens and subjects, never a real user's corpus. The law
// derives every marker from the user's own sent mail at runtime; a token written into lib/ would be
// an agnostic-clause violation, and R7e sweeps for exactly that.
console.log('\nR7 · THE ECHO FLOOR — the user\'s own outbound, recognized coming back');
{
  const e = require('../lib/inbox/campaign-echo') as typeof import('../lib/inbox/campaign-echo');
  const s = src('lib/inbox/campaign-echo.ts');

  // R8a — the derivation is deterministic, zero-AI, per-user, bounded.
  ok('no AI client anywhere in the derivation', !/aiCall\(|getAIClient|aiCreate|openai|anthropic/i.test(s));
  ok('the read is PAGED through fetchAllRows (no 1000-row cap)', /fetchAllRows</.test(s));
  ok('   …and bounded by an explicit maxRows', /maxRows: MAX_SENT_ROWS/.test(s));
  ok('the corpus is the USER\'S OWN sent mail', /is_from_user'?, true\)/.test(s) && /eq\('user_id', userId\)/.test(s));
  ok('   …within a bounded window', /SENT_WINDOW_DAYS/.test(s) && /gte\('received_at', since\)/.test(s));
  ok('cached day-keyed in item_plans (the house idiom)', /item_plans/.test(s) && /daySig/.test(s));
  ok('   …with a version in the cache key', /CAMPAIGN_SIGNATURE_VERSION/.test(s) && /\$\{CAMPAIGN_SIGNATURE_VERSION\}:\$\{todayStr\}/.test(s));

  // R8b — the derivation itself, on SYNTHETIC rows.
  const sent = (subject: string, thread: string, to: string[] = []) => ({ subject, thread_id: thread, to_addresses: to });
  const tokenRows = Array.from({ length: 6 }, (_, i) => sent(`Quick question ${i} | Z9QTK4X`, `t${i}`));
  const sig = e.deriveSignature(tokenRows);
  ok('a marker in ≥5 distinct subjects becomes a token', sig.tokens.includes('Z9QTK4X'), JSON.stringify(sig.tokens));
  ok('the same rows always yield the same signature', JSON.stringify(e.deriveSignature(tokenRows).tokens) === JSON.stringify(sig.tokens));
  const few = e.deriveSignature(tokenRows.slice(0, 3));
  ok('a marker below the bar is NOT a token', few.tokens.length === 0);
  const repeats = Array.from({ length: 8 }, (_, i) => sent('Quick question ZZZZZ', `t${i}`)).map((r) => ({ ...r, subject: 'Quick question ZZZZZ' }));
  ok('an all-letter shout is never a marker', e.deriveSignature(repeats).tokens.length === 0, JSON.stringify(e.deriveSignature(repeats).tokens));
  ok('   …because a marker must carry BOTH letters and digits', !e.isMarkerShaped('AAAAAA') && e.isMarkerShaped('A1AAAA'));
  // Templates need SPREAD, not repetition: one company's thread is an engagement, many are a blast.
  const oneCompany = Array.from({ length: 9 }, (_, i) => sent('quarterly planning sync agenda', `t${i}`, [`p${i}@onecompany.example`]));
  ok('a subject repeated inside ONE domain is NOT a template', e.deriveSignature(oneCompany).templates.length === 0);
  const manyCompanies = Array.from({ length: 9 }, (_, i) => sent('quarterly planning sync agenda', `t${i}`, [`p@c${i}.example`]));
  ok('the same subject across ≥8 domains IS a template', e.deriveSignature(manyCompanies).templates.length === 1);

  // R8c — the match, and the reply-prefix strip (inbound arrives as "Re: <template>").
  const live = e.deriveSignature([...tokenRows, ...manyCompanies]);
  ok('an inbound carrying the token matches', e.matchSubject('Re: Quick question 2 | Z9QTK4X', live).hit);
  ok('   …and names its marker', e.matchSubject('Re: Quick question 2 | Z9QTK4X', live).marker === 'Z9QTK4X');
  ok('an inbound echoing the template matches', e.matchSubject('RE: RE: Quarterly Planning Sync Agenda', live).hit);
  ok('unrelated mail does NOT match', !e.matchSubject('Re: contract review Thursday', live).hit);
  // FAIL-OPEN: no evidence, no demotion — ever.
  ok('an EMPTY signature matches nothing', !e.matchSubject('Re: Quick question | Z9QTK4X', e.EMPTY_SIGNATURE).hit);
  ok('a null signature matches nothing', !e.matchSubject('anything', null).hit);

  // R8d — the floor is a REFINER in the precedence chain, never unconditional.
  e.clearCampaignRegistry();
  const uid = 'user-synthetic-1';
  const item = (o: Record<string, unknown>) => ({ user_id: uid, source_data: { subject: 'Re: Quick question 2 | Z9QTK4X' }, ...o });
  ok('with NO primed signature the floor is inert', !e.isCampaignEcho(item({})));
  e.primeCampaignSignature(uid, live);
  ok('with the signature primed the echo is recognized', e.isCampaignEcho(item({})));
  ok('the user\'s own type_override OUTRANKS the floor', !e.isCampaignEcho(item({ type_override: 'needs_reply' })));
  ok('an explicit campaign_echo:false un-mark outranks it', !e.isCampaignEcho({ user_id: uid, source_data: { subject: 'Re: Quick question 2 | Z9QTK4X', campaign_echo: false } }));
  ok('the durable stamp works with NO signature at all', e.isCampaignEcho({ source_data: { subject: 'unknown', campaign_echo: true } }));
  ok('a non-echo item is untouched', !e.isCampaignEcho(item({ source_data: { subject: 'Re: contract review Thursday' } })));
  e.clearCampaignRegistry();

  // The chain SHAPE at the classify seam: the floor sits BELOW the two authoritative tiers
  // (type_override, a user rule's real verdict) and ABOVE the heuristic chain.
  const c = src('lib/inbox/classify-item.ts');
  ok('classify-item consults the one floor', /isCampaignEcho\(item\)/.test(c) && /from '\.\/campaign-echo'/.test(c));
  ok('   …AFTER the user\'s type_override', c.indexOf('item.type_override && OVERRIDABLE') < c.indexOf('if (isCampaignEcho(item)) return'));
  ok('   …AFTER the user\'s editable deterministic rules', c.indexOf('evaluateDeterministic(ruleEmail') < c.indexOf('if (isCampaignEcho(item)) return'));
  ok('   …BEFORE the AI-match verdict it exists to correct', c.indexOf('if (isCampaignEcho(item)) return') < c.indexOf('item.rule_type in LABEL_TO_TYPE'));
  ok('   …BEFORE the heuristic reply chain', c.indexOf('if (isCampaignEcho(item)) return') < c.indexOf('if (isNeedsReply(item))'));
  ok('POSTURED, NOT HIDDEN — the echo lands in the visible awareness lane', /if \(isCampaignEcho\(item\)\) return 'fyi'/.test(c));
  ok('   …never \'hidden\'', !/isCampaignEcho\(item\)\) return 'hidden'/.test(c));
  const n = src('lib/inbox/needs-reply.ts');
  ok('needs-reply consults it beside the automated-sender gate', /isCampaignEcho\(item\)/.test(n));
  const nd = src('lib/inbox/notice-demotion.ts');
  ok('the no-move law carries the echo fact (the BOTH-COPIES precedent)', /campaignEcho/.test(nd));
  ok('   …and the classify seam supplies it', /campaignEcho: isCampaignEcho\(item\)/.test(c));

  // R8e — THE AGNOSTIC SWEEP: no literal campaign marker may live in lib/.
  // A marker-shaped literal (5-10 chars, ALL CAPS, letters AND digits) in a string literal anywhere
  // under lib/ would be this account's data masquerading as a law.
  // Scoped to the law's own module and every seam that consults it — a planted token would live
  // HERE, and scoping keeps the assertion precise instead of fighting hex colours and Slack ids
  // elsewhere in lib/ (an allowlist rots; a scope does not).
  {
    const LAW_FILES = [
      'lib/inbox/campaign-echo.ts', 'lib/inbox/classify-item.ts', 'lib/inbox/needs-reply.ts',
      'lib/inbox/notice-demotion.ts', 'lib/inbox/automated.ts',
      'lib/entities/sources.ts', 'lib/entities/recognize.ts', 'lib/commitments/extract.ts',
    ];
    const offenders: string[] = [];
    for (const f of LAW_FILES) {
      for (const line of src(f).split('\n')) {
        for (const m of line.match(/['"`][^'"`]*['"`]/g) ?? []) {
          for (const tok of m.match(/\b[A-Z0-9]{5,10}\b/g) ?? []) {
            if (e.isMarkerShaped(tok)) offenders.push(`${f}: ${tok}`);
          }
        }
      }
    }
    ok('no literal campaign marker in the law or any of its seams', offenders.length === 0, offenders.slice(0, 5).join(' | '));
    ok('   …and the sweep covers every consult point', LAW_FILES.length === 8);
  }
  ok('the module names no vendor domain', !/@[a-z0-9-]+\.(com|net|io|ai|de|pt)\b/i.test(s));

  // R8f — the founding + minting guards.
  const rg = src('lib/entities/recognize.ts');
  ok('recognition never FOUNDS from an echo', /subjectIsCampaignEcho\(/.test(rg));
  ok('   …extending the existing noise guard, not replacing it', /if \(item\.noise \|\| echo\)/.test(rg));
  ok('   …with an honest recorded reason', /own outbound campaign echoing back/.test(rg));
  ok('the source mapper mirrors it on the noise flag', /isCampaignEcho\(/.test(src('lib/entities/sources.ts')));
  const ex = src('lib/commitments/extract.ts');
  ok('the extractor never MINTS from an echo', /subjectIsCampaignEcho\(client, userId, subject\)/.test(ex));
  ok('   …before the AI call', ex.indexOf('subjectIsCampaignEcho') < ex.indexOf('getAIClient(userId'));
  ok('   …received mail only (a send is not an echo)', /!isFromUser && await subjectIsCampaignEcho/.test(ex));

  // R8g — the retro sweep is guarded and repairs through undoable doors.
  const sw = src('scripts/sweep-campaign-echoes.ts');
  ok('the sweep is dry-run by default', /const APPLY = process\.argv\.includes\('--apply'\)/.test(sw));
  ok('   …and scopeable to one user', /--user/.test(sw));
  ok('the sweep derives the signature (never a hand-picked list)', /getCampaignSignature\(/.test(sw));
  ok('THE PINNING LAW holds — a tracked entity is never archived', /e\.tracked === true/.test(sw) && /pinnedSkipped/.test(sw));
  ok('entities are ARCHIVED (soft), never deleted', /status: 'archived'/.test(sw) && !/\.delete\(\)/.test(sw));
  ok('commitments close through the reversible door', /type: 'commitment_dismissed'/.test(sw));
  ok('   …which the restore vocabulary accepts', /commitment_dismissed/.test(src('lib/activity/restore.ts')));
  ok('items are POSTURED, never dismissed', /campaign_echo: true/.test(sw) && !/status: 'dismissed'[\s\S]{0,200}inbox_items/.test(sw));
  ok('every repair is activity-logged', /logActivity\(/.test(sw));
  ok('the user\'s own re-type is never overwritten', /!it\.type_override/.test(sw));
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// R7 · THE SERVED-WORDS LAW (proactive-reach LAW 3) — the deck never speaks a frozen snapshot.
//
// The census served "Confirm lunch meeting with <someone> tomorrow" on a Sunday about a lapsed
// Thursday. The law existed; it lived as a SITE LIST (one resolver, one of three write seams). These
// gates hold it as a STRUCTURE: ONE resolver at EVERY write seam, ONE zero-AI serve guard over the
// label, ONE multilingual day-word table nobody may fork, and a stated-date floor that is no longer
// English-only (layer 1 deterministic, layer 2 reasoned quote-then-verify with CODE disposing).
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nR7 · THE SERVED-WORDS LAW — one resolver, three write seams, one serve guard');
{
  const dx = src('lib/inbox/deixis.ts');
  // ── THE SITE-LIST DECAY GUARD: one resolver, enumerated seams. ────────────────────────────────
  ok('the resolver lives in ONE shared seam', /export async function resolveDeixisInDescriptions/.test(dx));
  ok('   …with a single-string door for label seams', /export async function resolveDeixisText/.test(dx));
  ok('the commitments module no longer OWNS it (re-export only)',
    /export \{ DEICTIC_RE, resolveDeixisInDescriptions \} from '@\/lib\/inbox\/deixis'/.test(src('lib/commitments/extract.ts'))
    && !/^export async function resolveDeixisInDescriptions/m.test(src('lib/commitments/extract.ts')));
  // SEAM 1 — commitment descriptions (the historical one).
  ok('SEAM 1/3 · commitment descriptions resolve at write',
    /list = await resolveDeixisInDescriptions\(client, userId, list, receivedAt/.test(src('lib/commitments/extract.ts')));
  // SEAM 2 — understanding.ask (the deck's FIRST label).
  {
    const ep = src('lib/ai/email-processor.ts');
    ok('SEAM 2/3 · understanding.ask resolves at write, anchored to the email’s own date',
      /resolveDeixisText\(supabase, email\.user_id!, u\.ask, refISO\)/.test(ep));
    ok('   …and the ask is AUTHORED absolute in ANY language (reasoned-first)',
      /THE DEIXIS LAW — WRITE DATES ABSOLUTELY/.test(ep) && /in ANY language/.test(ep));
  }
  // SEAM 3 — work_title, at every writer (email + both meeting action-item writers).
  {
    const ep = src('lib/ai/email-processor.ts');
    const bm = src('lib/integrations/meeting-bot/bot-manager.ts');
    ok('SEAM 3/3a · the email work_title resolves at write',
      /resolveDeixisText\(supabase, email\.user_id!, workTitle, refForTitle\)/.test(ep));
    ok('SEAM 3/3b · meeting action items resolve before becoming work_title (live path)',
      /resolveActionItemDeixis\(supabase, userId, insights\.actionItems, startTime\)/.test(bm));
    ok('SEAM 3/3c · …and on the reprocess path too (no writer left outside the law)',
      /resolveActionItemDeixis\(supabase, userId, actionItemsRaw, transcript\.start_time/.test(bm));
    ok('   …both through the ONE shared resolver', /from '@\/lib\/inbox\/deixis'/.test(bm));
    // The enumeration itself: every `work_title:` writer of a MACHINE-AUTHORED label is accounted
    // for. Subject-line fallbacks are the SENDER's words (never ours to rewrite) — the serve guard
    // owns those. If this count moves, a new writer appeared and must join the law.
    const machineTitleWriters = (bm.match(/work_title: item\.action/g) ?? []).length;
    ok('   …the meeting work_title writers are exactly the two the law covers', machineTitleWriters === 2,
      `found ${machineTitleWriters}`);
  }

  // ── THE SERVE GUARD: deterministic, zero-AI, at the label seam. ───────────────────────────────
  const route = src('app/api/home/brief/route.ts');
  ok('the serve guard is imported at the brief route', /import \{ stripDeixis \} from '@\/lib\/inbox\/deixis'/.test(route));
  // RE-POINTED, NOT WEAKENED (THE LABEL FOLLOWS THE PRESENT): the precedence is unchanged and the
  // strip still wraps it — the ask it strips now arrives through the freshness reader, so a claim
  // that no longer speaks the item's newest message never reaches the guard at all.
  ok('   …and wraps the ask→subject precedence (the precedence itself unchanged)',
    /stripDeixis\(claim\.ask \|\| \(subj \|\| ''\)\.trim\(\)/.test(route));
  ok('   …the reply lane’s label', /ask: stripDeixis\(r\.ask\)/.test(route));
  ok('   …the commitment lane’s label', /description: stripDeixis\(c\.description\)/.test(route));
  ok('   …the priority card’s label', /title: stripDeixis\(p\.title\)/.test(route));
  ok('the guard module is ZERO-AI and client-safe below the resolver',
    !/getAIClient|aiCreate|supabase/i.test(dx.split('// ── THE REASONED RESOLVER')[0]));
  ok('the guard never blocks the serve (it is synchronous)', /export function stripDeixis/.test(dx));

  // ── ONE TABLE, SHARED — never four copies (THE AGNOSTIC CLAUSE). ──────────────────────────────
  ok('there is ONE day-word table, exported', /export const DAY_WORDS/.test(dx));
  ok('   …covering EN · PT · DE · FR', /\ben:\s*\{/.test(dx) && /\bpt:\s*\{/.test(dx) && /\bde:\s*\{/.test(dx) && /\bfr:\s*\{/.test(dx));
  ok('   …and every regex is DERIVED from it, not hand-written',
    /const DAY_WORD_BODY = /.test(dx) && /new RegExp\(`\$\{L\}\$\{DAY_WORD_BODY\}\$\{R\}`/.test(dx));
  ok('   …with unicode boundaries (an ASCII \\b never matches "amanhã")', /\\\\p\{L\}/.test(dx));
  ok('no consumer forks the table (the guard + detector are the only doors)',
    !/tomorrow\|today|amanh/i.test(route) && !/tomorrow\|today/i.test(src('lib/home/calm.ts')));
}

console.log('\nR7b · the serve guard, behaviourally — a day-word can never render in a served label');
{
  // A LIVE fixture per corpus language, in the shape the deck actually serves. Each must come back
  // free of day-words AND still say something (the guard is never destructive).
  const labels: Array<[string, string]> = [
    ['en', 'Confirm lunch meeting with Ava tomorrow'],
    ['en', 'Send the meeting link for Thursday 11h call'],
    ['en', 'Share the revised deck next week'],
    ['pt', 'Confirmar o almoço com a equipa amanhã'],
    ['pt', 'Enviar a proposta na quinta-feira'],
    ['de', 'Termin am Donnerstag bestätigen'],
    ['de', 'Die Unterlagen morgen schicken'],
    ['fr', 'Confirmer le créneau de jeudi 11h'],
    ['fr', 'Envoyer le lien avant demain'],
  ];
  for (const [lang, raw] of labels) {
    const out = stripDeixis(raw);
    ok(`[${lang}] no day-word survives the serve · "${raw}" → "${out}"`, !carriesDayWord(out));
    ok(`[${lang}]    …and the label still says something`, out.trim().length >= 3 && /[\p{L}]/u.test(out));
  }
  // NEVER DESTRUCTIVE, NEVER OVER-EAGER: a label with no day-word is returned byte-identical, and a
  // word that only LOOKS like a weekday in another sense is left alone (the ordinal trap: Portuguese
  // "segunda" is both "Monday" and "second" — the table carries only the unambiguous "-feira" form).
  const untouched = [
    'Pay the renewal invoice',
    'Review the Q4 budget proposal',
    'Enviar a segunda proposta ao cliente',
    'Review the Monday.com export',
  ];
  for (const u of untouched) ok(`a day-word-free label is served verbatim · "${u}"`, stripDeixis(u) === u);
  ok('the guard is idempotent (serving twice changes nothing)',
    stripDeixis(stripDeixis('Confirm lunch meeting with Ava tomorrow')) === stripDeixis('Confirm lunch meeting with Ava tomorrow'));
  ok('a null/empty label never throws', stripDeixis(null) === '' && stripDeixis(undefined) === '');
}

console.log('\nR7c · THE STATED-DATE FLOOR is no longer English-only (LAW 3, owner amendment)');
{
  // LAYER 1 — deterministic. The English renderings P27 pinned still verify (never weakened), and
  // the corpus languages now verify too (found live: a French "jeudi" item had its expired
  // disposition silently DROPPED because the floor could only render en-US).
  ok('[en] ISO still verifies', dateStatedInText('direction: you_owe · due 2026-07-25', '2026-07-25'));
  ok('[en] prose month still verifies', dateStatedInText('the review is on July 25 at noon', '2026-07-25'));
  ok('[en] a weekday still verifies', dateStatedInText('please send it by Thursday', '2026-07-30'));
  ok('[fr] a French weekday verifies', dateStatedInText('Call jeudi à 11h', '2026-09-10'));
  ok('[fr] a French written date verifies', dateStatedInText('on se voit le 11 septembre à 11h', '2026-09-11'));
  ok('[pt] a Portuguese weekday verifies', dateStatedInText('podemos falar na quinta-feira', '2026-09-10'));
  ok('[pt] a Portuguese written date verifies', dateStatedInText('reunião a 11 de setembro', '2026-09-11'));
  ok('[de] a German weekday verifies', dateStatedInText('Termin am Donnerstag um 11 Uhr', '2026-09-10'));
  ok('[de] a German written date verifies', dateStatedInText('Termin am 11. September', '2026-09-11'));
  ok('[de] a German numeric date verifies', dateStatedInText('Besprechung am 11.09. um 11 Uhr', '2026-09-11'));
  // THE ASYMMETRY IS UNTOUCHED — P27's adversarial cases stay green.
  ok('a fabricated date still never verifies', !dateStatedInText('Be at the workshop room at 20:00 — 2026-07-29', '2026-07-28'));
  ok('an undated ask still never verifies', !dateStatedInText('an undated open ask', '2026-07-01'));
  ok('a DIFFERENT weekday never verifies', !dateStatedInText('Call jeudi à 11h', '2026-09-11'));
  ok('the locale list is generated, not a hand-authored month table',
    /const DATE_LOCALES = \['en-US', 'pt-PT', 'de-DE', 'fr-FR'\]/.test(src('lib/utils/user-time.ts'))
    && !/january|janvier|januar|janeiro/i.test(src('lib/utils/user-time.ts')));
}

console.log('\nR7d · LAYER 2 — quote-then-verify: the model proposes, CODE disposes');
{
  const ut = src('lib/utils/user-time.ts');
  ok('the reasoned layer exists', /export async function dateStatedInTextVerified/.test(ut));
  ok('   …and runs the free layer FIRST', /if \(dateStatedInText\(src, iso\)\) return true;/.test(ut));
  ok('   …on the cheap classification tier', /getAIClient\(userId, 'classification', client\)/.test(ut));
  ok('   …asking for a VERBATIM span, never a yes/no', /QUOTING the exact contiguous span/.test(ut));
  ok('   …and caches the verdict per (text, date)', /kind: 'date_stated'/.test(ut));
  // THE STRUCTURAL ASYMMETRY: the ONLY path to true runs through the code verifier.
  const body = ut.slice(ut.indexOf('export async function dateStatedInTextVerified'));
  const trueAssignments = (body.match(/(?<!let )stated = [^;]+;/g) ?? []);
  ok('the ONLY assignment of a positive verdict goes through quoteProvesDate',
    trueAssignments.length === 1 && /quoteProvesDate\(src, quote, iso\)/.test(trueAssignments[0]),
    trueAssignments.join(' | '));
  ok('a call failure returns false and caches NOTHING (failure is not evidence)',
    /catch \{ return false; \} \/\/ a failure is NOT evidence/.test(ut));

  // CODE'S HALF, behaviourally — the fixture P27 exists for: a hallucinated date cannot be quoted
  // into existence, because a quote must be a VERBATIM substring carrying the date's own digits.
  const text = 'Bonjour, on se voit le 11 septembre à 11h pour le point trimestriel.';
  ok('a real verbatim span with the day + month proves the date',
    quoteProvesDate(text, 'le 11 septembre', '2026-09-11'));
  ok('a numeric span proves it too', quoteProvesDate('Besprechung am 11.09.2026', '11.09.2026', '2026-09-11'));
  ok('a HALLUCINATED span (not in the text) proves nothing',
    !quoteProvesDate(text, 'le 28 août', '2026-08-28'));
  ok('a real span for the WRONG day proves nothing', !quoteProvesDate(text, 'le 11 septembre', '2026-09-12'));
  ok('a real span for the WRONG month proves nothing', !quoteProvesDate(text, 'le 11 septembre', '2026-11-11'));
  ok('a span with no day digits proves nothing', !quoteProvesDate(text, 'on se voit', '2026-09-11'));
  ok('an empty span proves nothing', !quoteProvesDate(text, '', '2026-09-11'));
  ok('a junk ISO proves nothing', !quoteProvesDate(text, 'le 11 septembre', 'sometime'));
  // The judge's expired branch consults BOTH layers, in order.
  const j = src('lib/work/judge.ts');
  ok('the judge keeps layer 1 as the free first check', /if \(dateStatedInText\(ctx\.itemText, basis\)\) out\.resolution = 'expired';/.test(j));
  ok('   …and falls through to the verified layer only on a miss',
    /else if \(verifyDate && await verifyDate\(ctx\.itemText, basis\)\) out\.resolution = 'expired';/.test(j));
  ok('   …with the verifier INJECTED (coerceVerdict never reaches for a client)',
    /coerceVerdict\(res\.json, roster, \{ todayStr, nowHHMM: nowL\.hhmm, itemText \},/.test(j)
    && /dateStatedInTextVerified\(client, userId, text, iso\)/.test(j));
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// R8 · LAW 4 — ONE CONVERSATION, ONE OBLIGATION (settlement crosses providers).
//
// The census's proof case: one human exchange with one counterparty split across the user's two
// mailboxes (they were told mid-thread to write to the other address). Every resolution door keys
// on thread_id, so settling one copy structurally could not settle the other — one was settled with
// a textbook verdict, the other stood as a top whisper for five more days.
//
// These gates hold the four things that make the law safe rather than merely clever: it is
// PROVIDER-BLIND (a third mail source needs zero edits here), the reasoned key's only path to "yes"
// runs through a CODE verifier, settlement spreads ASYMMETRICALLY (structural cascades, reasoned
// only nominates, reactivation never travels), and the nomination reaches LAW 1's queue as a record.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nR8 · LAW 4 — one conversation, one obligation');
{
  const ci = src('lib/inbox/conversation-identity.ts');

  // R8a — PROVIDER-BLIND BY CONSTRUCTION (owner: "if we add more providers it also works").
  // Identity may only come from message-level facts every mail source yields. A provider name or a
  // thread-id format read anywhere in this module is the violation.
  // Swept over the CODE, comments stripped: the prose may (and must) explain the class in English;
  // the executable law may not know that mail sources have names.
  const ciCode = ci.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const PROVIDER_WORDS = /\b(gmail|outlook|microsoft|googleapis|imap|o365|office365)\b/i;
  ok('the executable law names no provider', !PROVIDER_WORDS.test(ciCode), (ciCode.match(PROVIDER_WORDS) ?? []).join());
  ok('   …and reads no provider column', !/\bprovider\b/i.test(ciCode));
  ok('identity comes from the RFC ids the sync already stores',
    /message_id/.test(ci) && /in_reply_to/.test(ci) && /references_ids/.test(ci));
  ok('   …the participants, through the ONE person identity', /from '@\/lib\/projects\/identity'/.test(ci) && /sameAttendee\(/.test(ci));
  ok('   …and the subject, through the ONE distinctive-token primitive', /namesOverlap\(/.test(ci));
  ok('no thread-id FORMAT is parsed anywhere', !/thread_id[^\n]{0,40}(startsWith|match\(|slice\()/.test(ci));
  // The reply/forward prefix is stripped BY SHAPE — a prefix vocabulary is a language list.
  ok('the subject prefix strip carries no prefix vocabulary', !/\bRe\b\s*\|\s*|['"`](re|fwd|tr|aw|wg|enc)['"`]/i.test(ci.split('export const normalizeSubject')[1].slice(0, 400)));
  ok('   …and it strips every locale\'s form by shape', normalizeSubject('Re: RE: TR: Le point poste') === 'Le point poste'
    && normalizeSubject('AW: WG: Der Termin') === 'Der Termin' && normalizeSubject('RE[2]: Encaminhar isto') === 'Encaminhar isto');
  ok('   …and leaves a colon-free subject verbatim', normalizeSubject('Point équipe Ava et Noa') === 'Point équipe Ava et Noa');
  ok('an RFC id compares case- and bracket-insensitively',
    normalizeRfcId('<ABC@Host.Example>') === normalizeRfcId('abc@host.example'));

  // R8b — THE REASONED KEY: the model proposes, CODE disposes (the quote-then-verify idiom).
  const A = 'Bonjour, je vous propose lundi après-midi ou jeudi prochain.';
  const B = 'Merci pour la relance. C\'est mieux d\'utiliser cette adresse e-mail pour me contacter.';
  ok('a verbatim span of the CANDIDATE proves continuity',
    quoteProvesContinuity(B, "utiliser cette adresse e-mail pour me contacter"));
  ok('   …tolerating diacritics and whitespace folding',
    quoteProvesContinuity(B, "  UTILISER   CETTE ADRESSE E-MAIL pour me contacter "));
  ok('a HALLUCINATED span proves nothing', !quoteProvesContinuity(B, 'je vous confirme le virement de mardi'));
  // THE FOUND-LIVE CLASS (first fidelity run): verifying against EITHER thread let one line of the
  // SOURCE thread admit four unrelated neighbours. The candidate's own words must carry it.
  ok('a span that lives only in the OTHER thread proves nothing',
    !quoteProvesContinuity(B, 'je vous propose lundi après-midi') && quoteProvesContinuity(A, 'je vous propose lundi après-midi'));
  ok('a too-short span proves nothing', !quoteProvesContinuity(B, 'merci'));
  ok('a re-authored paragraph (over the cap) proves nothing', !quoteProvesContinuity(B + 'x'.repeat(400), 'x'.repeat(210)));
  ok('a digits-only span proves nothing', !quoteProvesContinuity('11 09 2026 11 09 2026', '11 09 2026 11'));
  ok('an empty span proves nothing', !quoteProvesContinuity(B, ''));

  // THE STRUCTURAL ASYMMETRY: the ONLY assignment of a positive same-conversation verdict goes
  // through the verifier (the dateStatedInTextVerified gate's own shape).
  const jb = ci.slice(ci.indexOf('export async function judgeSameConversation'), ci.indexOf('export async function findSiblingThreads'));
  const provenAssignments = jb.match(/const proven = [^;]+;/g) ?? [];
  ok('the ONLY path to same=true runs through quoteProvesContinuity',
    provenAssignments.length === 1 && /quoteProvesContinuity\(b\.verbatimSource, quote\)/.test(provenAssignments[0]),
    provenAssignments.join(' | '));
  ok('   …and it is demanded of the model as a VERBATIM span of thread B', /quote one exact contiguous span/.test(jb) && /THREAD B/.test(jb));
  ok('   …with an outage cached NOWHERE (failure is not evidence)', /An outage is not evidence/.test(jb));

  // R8c — THE CACHE: versioned + order-normalized (a pair is a pair, whichever side asked).
  ok('the pair key is order-normalized', pairKey('b', 'a') === pairKey('a', 'b'));
  ok('   …and carries the law\'s version', pairKey('a', 'b').includes(String(CONVERSATION_IDENTITY_VERSION)));
  ok('the version moved when the disposal changed', CONVERSATION_IDENTITY_VERSION >= 2);
  ok('the verdict cache is version-gated on read', /t\.v === CONVERSATION_IDENTITY_VERSION/.test(ci));
  ok('   …and lives in the house idiom (item_plans)', /kind: 'conversation_pair'/.test(ci));

  // R8d — THE ASYMMETRY IN CODE: structural cascades, everything else nominates.
  ok('the ONLY direct-settle path demands a STRUCTURAL bridge fact',
    /const mayCascade = sib\.key === 'rfc_bridge' && !moved && !opts\.nominateOnly;/.test(ci));
  ok('   …and the freshness floor outranks even that (new words are new work)',
    /const moved = !!sib\.lastInboundAt && sib\.lastInboundAt > settledAt;/.test(ci));
  ok('a reasoned sibling can never be settled outright',
    !/sib\.key === 'reasoned'[\s\S]{0,200}status: 'completed'/.test(ci));
  ok('COMMITMENTS ARE NEVER CASCADED — the fulfillment law owns their death',
    /COMMITMENTS ARE ALWAYS NOMINATED/.test(ci)
    && !/commitments'\)[\s\S]{0,400}status: 'done'/.test(ci));
  ok('a cascade settles through the same UNDOABLE door', /type: 'marked_done'/.test(ci) && /logActivity\(/.test(ci));
  ok('   …and settles the item\'s asks with it', /settleAsksForItem/.test(ci));
  ok('the scan runs at most ONCE per settle', /kind: 'conversation_cascade'/.test(ci) && /t\.settledAt === settledAt\) return EMPTY;/.test(ci));
  ok('every read is bounded', /MAX_THREAD_MSGS/.test(ci) && /MAX_BRIDGE_IDS/.test(ci) && /MAX_FUZZY_CANDIDATES/.test(ci) && /MAX_CANDIDATE_ROWS/.test(ci));
  ok('the reasoned key is paid only after the deterministic bar',
    /if \(!f \|\| !shareCounterparty\(facts, f\)\) continue;/.test(ci));

  // ── R8d2 · THE WIDENED CANDIDATE GATE (found live: one engagement, one counterparty, two threads
  // 56 days apart — the second leg opened under a name of its own, and the single 45-day
  // subject-overlap bar put the reasoned key permanently out of reach. A counterparty who renames
  // the subject mid-engagement structurally evaded the law).
  //
  // The widening is of CANDIDACY ONLY. These gates hold exactly that: the tier exists and is
  // bounded, it ranks BEHIND the subject-overlap tier (adds, never displaces), it still demands the
  // same counterparty, and — the whole safety story — the DISPOSAL is untouched, so the worst a
  // widened false positive can cost is one judgment revisit, never a settlement.
  ok('TIER 2 exists — same counterparty, temporally adjacent, NO subject demanded',
    /const ADJACENCY_DAYS = 60;/.test(ci)
    && /\} else if \(withinWindow\(facts, f, ADJACENCY_DAYS\)\) \{/.test(ci));
  ok('   …and tier 1 keeps its own, tighter window (the widening never loosened it)',
    /const WINDOW_DAYS = 45;/.test(ci)
    && /if \(withinWindow\(facts, f, WINDOW_DAYS\) && subjectsOverlap\(facts, f\)\) \{/.test(ci));
  ok('   …the subject-overlap tier RANKS FIRST (tier 2 only adds behind it)',
    /for \(const f of \[\.\.\.tier1, \.\.\.tier2\]\) \{/.test(ci)
    && ci.indexOf('const tier1: ThreadFacts[]') < ci.indexOf('for (const f of [...tier1, ...tier2])'));
  ok('   …tier 2 is capped, newest-first', /const MAX_ADJACENT_CANDIDATES = 8;/.test(ci)
    && /tier2\.length < MAX_ADJACENT_CANDIDATES/.test(ci)
    && /\.sort\(\(x, y\) => y\[1\]\.localeCompare\(x\[1\]\)\)\.slice\(0, MAX_CANDIDATE_SCANS\)/.test(ci));
  ok('   …the fact reads while ranking are bounded too', /const MAX_CANDIDATE_SCANS = 24;/.test(ci));
  ok('   …and the bounded participant read is ORDERED (a cap without an order is a lottery)',
    /\.order\('received_at', \{ ascending: false \}\)\.limit\(MAX_CANDIDATE_ROWS\);/.test(ci));
  ok('   …and the reasoned calls are bounded ACROSS both tiers',
    /const MAX_REASONED_CALLS = 10;/.test(ci) && /const budget = opts\?\.maxReasoned \?\? MAX_REASONED_CALLS;/.test(ci));
  // THE DISPOSAL IS UNCHANGED — the tier a candidate came from is never consulted after candidacy.
  const fs2 = ci.slice(ci.indexOf('const tier1: ThreadFacts[]'), ci.indexOf('// ═', ci.indexOf('const tier1: ThreadFacts[]')));
  ok('a widened candidate is disposed by the SAME judge, with no tier branch',
    (fs2.match(/judgeSameConversation\(/g) ?? []).length === 1 && !/tier2[\s\S]{0,120}same: true/.test(fs2));
  ok('   …and every reasoned sibling is still keyed \'reasoned\' (so it can only ever NOMINATE)',
    !/key: 'rfc_bridge'/.test(fs2) && /key: 'reasoned'/.test(fs2));
  // THE CACHE PREVENTS RE-JUDGMENT — and costs the budget nothing, which is what makes a widened
  // gate affordable to re-run over a whole account.
  ok('the pair cache is consulted BEFORE any spend',
    ci.indexOf(".eq('kind', 'conversation_pair')") > 0
    && ci.indexOf(".eq('kind', 'conversation_pair')") < ci.indexOf("const { aiCall } = await import"));
  ok('   …a cache hit costs the reasoned budget nothing', /if \(!v\.cached\) spent\+\+;/.test(ci) && /cached: true/.test(ci));
  ok('   …and an exhausted budget leaves a pair UNDECIDED, never guessed',
    /if \(opts\?\.cacheOnly\) return \{ same: false[^\n]*'reasoned budget exhausted'/.test(ci)
    && /\{ cacheOnly: spent >= budget \}/.test(ci));

  // ── R8d3 · THE QUOTE CONTRACT MUST BE SATISFIABLE (found live on the widened tier's first real
  // pair, and silently true of EVERY reasoned verdict before it): the model answered "yes" with a
  // 400-character quote, the 220-token budget truncated the JSON mid-fence, the parse returned null,
  // and the coercion read that as a refusal and CACHED it. A mute key wearing the shape of a law —
  // the honesty-floor class, in this module. Three floors now, all code-side.
  ok('an UNREADABLE completion is not a "no"',
    /if \(!res\.json\) return \{ same: false[^\n]*'same-conversation verdict unreadable', cached: false \};/.test(ci));
  ok('   …and, like an outage, is never cached (it returns before the upsert)',
    ci.indexOf('verdict unreadable') > 0 && ci.indexOf('verdict unreadable') < ci.indexOf("kind: 'conversation_pair', entity_id: key"));
  ok('the budget can carry a verdict that carries a quote', /maxTokens: 700,/.test(ci));
  ok('   …and the span the model is asked for fits what the verifier will accept',
    /at most 20 words/.test(ci) && /a longer one cannot be \` \+\n\s*\`verified and will be thrown away/.test(ci));
  ok('   …with OUR excerpt marker named as ours, never as part of a span', /is our cut, never \` \+/.test(ci));
  // THE TYPOGRAPHY FOLD — transport noise, admitting no new meaning (a model retypes ’ as ').
  ok('a curly apostrophe and a straight one are the same span',
    quoteProvesContinuity('merci d’envoyer l’invitation', "merci d'envoyer l'invitation"));
  ok('   …as are an en-dash and a non-breaking space',
    quoteProvesContinuity('le pilote – phase un commence', 'le pilote - phase un commence'));
  ok('   …and the fold still admits no new WORDS', !quoteProvesContinuity('merci d’envoyer', 'merci de renvoyer'));

  // R8e — THE DOORS. Every settle fires the scan; reactivation never cascades.
  const ror = src('lib/inbox/resolve-on-reply.ts');
  ok('DOOR 1/4 · the reply resolver fires the scan', /cascadeConversationSettlement\(client, userId/.test(ror));
  ok('   …only when something actually settled', ror.indexOf('if (out.resolvedItems || out.resolvedCommitments) {\n      try {') > 0);
  ok('   …non-fatally', /catch \{ \/\* the cascade is an enhancement/.test(ror));
  const ff = src('lib/commitments/fulfillment.ts');
  ok('DOOR 2/4 · the fulfillment close fires it on a REAL close', /if \(closed\) \{[\s\S]{0,400}cascadeConversationSettlement/.test(ff));
  ok('   …never on promised/unclear', ff.indexOf('cascadeConversationSettlement') < ff.indexOf("verdict.verdict === 'promised'"));
  const av = src('lib/work/apply-verdict.ts');
  ok('DOOR 3/4 · the verdict\'s resolution seam fires it', /cascadeConversationSettlement\(client, userId/.test(av));
  ok('   …inside the resolved branch only', av.indexOf('if (out.resolved) {') < av.indexOf('cascadeConversationSettlement'));
  const rr = src('lib/inbox/reactivate-on-reply.ts');
  ok('DOOR 4/4 · the reactivation door fires ONLY its settle-shaped branch',
    rr.indexOf('closure === true') > 0 && rr.indexOf('closure === true') < rr.indexOf('cascadeConversationSettlement('));
  ok('   …and even then only to NOMINATE (reactivation never spreads a settlement)',
    /nominateOnly: true/.test(rr) && (rr.match(/cascadeConversationSettlement\(/g) ?? []).length === 1);
  ok('   …a REOPEN travels nowhere', rr.indexOf('cascadeConversationSettlement') < rr.indexOf('const priorWs = item.work_state'));

  // R8f — THE SEAM INTO LAW 1's QUEUE (additive; the existing order is untouched without a nomination).
  const nomAt = '2026-09-13T09:00:00Z';
  const base = [item('inbox:plain', { activityAt: '2026-09-12T00:00:00Z' }),
    item('inbox:anchor', { anchor: '2026-09-01', activityAt: '2026-09-12T00:00:00Z' }),
    item('inbox:sibling', { activityAt: '2026-09-12T00:00:00Z', nominatedAt: nomAt })];
  const ages = [judged('inbox:plain', '2026-08-01T00:00:00Z'), judged('inbox:anchor', '2026-08-01T00:00:00Z'),
    judged('inbox:sibling', '2026-09-12T08:00:00Z')];
  const o = order(nominateForJudgment(base, ages, { todayStr: TODAY }));
  ok('a sibling-nominated item leads the judgment queue — even past an anchor', o[0] === 'inbox:sibling', o.join(' > '));
  ok('   …and says why', nominateForJudgment(base, ages, { todayStr: TODAY })[0].reason.includes('settled elsewhere'));
  // SELF-CLEARING: once the judge has seen the news, the nomination stops outranking anything.
  const after = nominateForJudgment(base, [...ages.slice(0, 2), judged('inbox:sibling', '2026-09-13T10:00:00Z')], { todayStr: TODAY });
  ok('   …and stops leading once a judgment POSTDATES it', after[0].item.key !== 'inbox:sibling', order(after).join(' > '));
  ok('with no nomination the order is exactly what it was',
    order(nominateForJudgment(base.map(({ nominatedAt, ...i }) => i), ages, { todayStr: TODAY }))[0] === 'inbox:anchor');
  const sw = src('lib/work/judgment-sweep.ts');
  ok('the sweep reads the nomination RECORD', /readSiblingNominations\(admin, userId\)/.test(sw));
  ok('   …through the ONE nominator, additively', /nominatedAt: siblingNoms\.get\(base\.key\)\?\.at \?\? null/.test(sw));
  ok('   …and reports the count honestly', /siblingNominated: number/.test(sw));

  // R8g — THE JUDGE READS A FACT, NEVER A DISPOSITION (the anchor fact's own grammar).
  const nom: SiblingNomination = { v: CONVERSATION_IDENTITY_VERSION, key: 'inbox:x', siblingThreadId: 't',
    siblingKey: 'rfc_bridge', evidence: 'shared message id abc@host', settledAt: '2026-09-08T13:18:05.193Z',
    via: 'you replied', at: nomAt };
  const fact = siblingSettledFact(nom);
  ok('the fact names the settlement date', fact.includes('2026-09-08'));
  ok('   …and how it was established', /quote the same message id/.test(fact));
  ok('   …and leaves the disposition to the judge', /judge that on its own merits/.test(fact));
  ok('   …explicitly as a fact, not a verdict', /not a verdict/.test(fact));
  ok('no nomination produces NO line', siblingSettledFact(null) === '');
  const j = src('lib/work/judge.ts');
  ok('the judge assembles the sibling fact', /siblingSettledFact\(siblingNom\)/.test(j));
  ok('   …beside the anchor fact, from the ONE module', /from '@\/lib\/inbox\/conversation-identity'/.test(j));
  ok('   …and the fact RIDES THE SIG (a settle after today\'s verdict must re-judge)',
    /\$\{siblingNom \? `:sib\$\{siblingNom\.at\}` : ''\}/.test(j));
}

// ── R9 · LAW 7 — THE OUTCOME LOOP ───────────────────────────────────────────────────────────────
console.log('\nR9 · LAW 7 — the outcome loop: the user\'s own verdicts become FACTS, never a rule');
{
  const s = src('lib/prepare/outcome-facts.ts');

  // R9a — THE AGGREGATION IS DETERMINISTIC, BOUNDED, CACHED.
  ok('the aggregation calls no AI', !/aiCall\(|getAIClient|aiCreate|openai|anthropic/i.test(s));
  ok('   …reads a BOUNDED window', /OUTCOME_WINDOW_DAYS\s*=\s*\d+/.test(s) && /\.gte\('created_at', since\)/.test(s));
  ok('   …with a row cap, never a corpus scan', /MAX_ROWS\s*=\s*\d+/.test(s) && /\.limit\(MAX_ROWS\)/.test(s));
  ok('   …cached the house way (item_plans, one row, keyed by the user\'s own day)',
    /kind: 'outcome_facts'/.test(s) && /entity_id: 'user'/.test(s) && /stored\.day === day/.test(s));
  ok('   …and reuses the EXISTING sender predicate, never a new one',
    /import \{ isAutomatedSenderStrong \}/.test(s) && !/no-?reply|unsubscribe|mailer-daemon/i.test(s));
  // AGNOSTIC CLAUSE: every number derives from this user's rows — no account, vendor or language is named.
  ok('no hardcoded identity tokens anywhere in the module', !/@[a-z0-9-]+\.(com|pt|de|ai)\b/i.test(s));
  ok('no hand-tuned per-account constant (only the window + the floor)',
    (s.match(/^const [A-Z_]+ = \d+/gm) ?? []).length <= 2);

  // R9b — THE N-FLOOR, BEHAVIOURALLY. Under the floor: silence, not a hedge.
  const facts = (rows: Array<Partial<LaneStats>>): OutcomeFacts => ({
    v: OUTCOME_FACTS_VERSION, day: TODAY, windowDays: OUTCOME_WINDOW_DAYS, minN: OUTCOME_MIN_N,
    observed: rows.reduce((n, r) => n + (r.n ?? 0), 0),
    rows: rows.map((r) => ({ lane: 'reply', klass: 'any', accepted: 0, edited: 0, discarded: 0, n: 0, medianEditShare: null, ...r })) as LaneStats[],
  });
  const thin = facts([{ lane: 'reply', klass: 'any', discarded: 2, n: 2 }]);
  ok('a lane under the floor is NOT speakable', speakableRows(thin).length === 0);
  ok('   …the judge fact is ABSENT (silence, never a hedged sentence)', outcomeHistoryFact(thin, { klass: 'human' }) === '');
  ok('   …the drafter fact is ABSENT too', outcomeRegisterFact(thin) === '');
  ok('   …and it moves NO sig (an unspoken fact must not cost a judgment)', outcomeSigPart(thin) === '');
  ok('an empty ledger says nothing at all', outcomeHistoryFact(facts([]), {}) === '' && outcomeSigPart(null) === '');
  ok('   …and null facts never throw', outcomeHistoryFact(null, {}) === '' && outcomeRegisterFact(null) === '');
  const thick = facts([{ lane: 'reply', klass: 'any', accepted: 1, edited: 1, discarded: 4, n: 6, medianEditShare: 0.4 }]);
  ok('at the floor the lane speaks', outcomeHistoryFact(thick, {}).includes('of the last 6 replies we drafted'));
  ok('   …stating every outcome, in counts', /sent 1 as written, edited 1/.test(outcomeHistoryFact(thick, {})));
  ok('   …and the measured edit share', /rewriting about 40% of the text/.test(outcomeHistoryFact(thick, {})));

  // R9c — A FACT, NOT A DISPOSITION (the anchor/sibling-fact grammar).
  const blk = outcomeHistoryFact(thick, {});
  ok('the block declares itself FACTS, not a verdict', /FACTS, not a verdict/.test(blk));
  ok('   …and leaves the meaning to the judge', /decide for yourself what they mean/.test(blk));
  ok('   …it never instructs a skip', !/\b(do not prepare|skip|stop preparing|never prepare)\b/i.test(blk));

  // R9d — THE CLASS NARROWING (derived structurally; the more specific row wins only when it is
  // itself a pattern, else the lane across every counterparty stands).
  const mixed = facts([
    { lane: 'reply', klass: 'any', accepted: 4, discarded: 4, n: 8 },
    { lane: 'reply', klass: 'automated', discarded: 4, n: 4 },
    { lane: 'reply', klass: 'human', accepted: 2, n: 2 },
  ]);
  ok('an automated-sender item hears its OWN class', outcomeHistoryFact(mixed, { klass: 'automated' }).includes('to automated senders'));
  ok('   …a human-sender item falls back to the lane (its class is under the floor)',
    !outcomeHistoryFact(mixed, { klass: 'human' }).includes('to real people')
    && outcomeHistoryFact(mixed, { klass: 'human' }).includes('of the last 8 replies'));
  ok('   …and a commitment (no sender) hears the lane too', outcomeHistoryFact(mixed, { klass: 'unknown' }).includes('of the last 8 replies'));

  // R9e — THE DIGEST COVERS EXACTLY WHAT IS SPOKEN.
  ok('the digest names the speakable rows', outcomeDigest(mixed) === 'reply.any:4/0/4,reply.automated:0/0/4');
  ok('   …and omits the under-floor row', !outcomeDigest(mixed).includes('human'));
  ok('a shifted history changes the digest',
    outcomeDigest(facts([{ lane: 'reply', klass: 'any', accepted: 5, discarded: 4, n: 9 }])) !== outcomeDigest(thick));
  ok('   …and an unchanged one is stable', outcomeDigest(thick) === outcomeDigest(facts([{ lane: 'reply', klass: 'any', accepted: 1, edited: 1, discarded: 4, n: 6, medianEditShare: 0.4 }])));
  ok('the sig part is short and prefixed', /^:oc[0-9a-z]+$/.test(outcomeSigPart(thick)));

  // R9f — THE JUDGE CONSUMES IT AS A FACT, WITH THE DIGEST IN THE SIG.
  const j = src('lib/work/judge.ts');
  ok('the judge reads the ONE aggregation module', /from '@\/lib\/prepare\/outcome-facts'/.test(j));
  ok('   …assembles the fact beside the anchor + sibling facts', /outcomeHistoryFact\(outcomeFacts, \{ klass: outcomeKlass \}\)/.test(j));
  ok('   …derives the class from the EXISTING sender predicate', /isAutomatedSenderStrong\(whoEmail, who, title\)/.test(j));
  ok('   …and the facts RIDE THE SIG (a shifted history re-judges today)', /\$\{outcomeSigPart\(outcomeFacts\)\}/.test(j));
  ok('   …a facts addition, NOT a law change (no JUDGE_VERSION bump in this wave)',
    /Facts ride the day-keyed sig|needs no JUDGE_VERSION bump/.test(j));
  ok('   …and an unreadable ledger never breaks a judgment', /readOutcomeFacts\(client, userId, todayStr\)\.catch\(\(\) => null\)/.test(j));

  // R9g — THE DRAFTER FACT (measured only — the ledger records edit share, never length).
  const d = src('lib/inbox/draft-reply.ts');
  ok('the drafter reads the same module', /outcomeRegisterFact/.test(d) && /@\/lib\/prepare\/outcome-facts/.test(d));
  ok('   …places the fact in the prompt', /\$\{registerFact \? registerFact \+ '\\n' : ''\}/.test(d));
  ok('   …non-fatally', /catch \{ return ''; \}/.test(d));
  const reg = outcomeRegisterFact(thick);
  ok('the drafter fact is measured, not an instruction', /a fact about their habit, not an instruction/.test(reg));
  ok('   …speaks the real edit share', /rewrite about 40% of it/.test(reg));
  ok('   …and claims NOTHING about length (the ledger records none)', !/\b(shorter|longer|length|brief|concise)\b/i.test(reg));

  // R9h — NO DETERMINISTIC OUTCOME GATE ANYWHERE. The judge reasons with the numbers; no code path
  // skips, demotes or suppresses preparation on an outcome count (the bolted-fix the doctrine bans).
  const consumers = ['lib/prepare/pass.ts', 'lib/prepare/requirements.ts', 'lib/work/judge.ts',
    'lib/work/apply-verdict.ts', 'lib/home/dedupe-deck.ts', 'lib/inbox/draft-reply.ts'];
  const gateShaped = consumers.filter((p) => {
    const t = src(p);
    return /(discarded|accepted|editShare|edit_share)\s*(>=?|<=?|>|<)\s*\d/.test(t)
      || /if\s*\([^)]*outcome[A-Za-z]*\.(discarded|accepted|edited|n)\b/.test(t);
  });
  ok('no consumer branches on an outcome COUNT', gateShaped.length === 0, gateShaped.join(', '));
  ok('the prepare pass holds no outcome gate at all', !/outcome-facts|outcomeHistoryFact|outcomeDigest/.test(src('lib/prepare/pass.ts')));
  // (comments stripped — the module DISCUSSES the banned rule in its header; it must not CODE it.)
  const sCode = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the aggregation module itself decides nothing', !/\bskip\b|\bsuppress\b|shouldPrepare|allowPrepare/i.test(sCode));
}

// ── R10 · THE RECEIPT-GRAMMAR CENSUS (W4, batch 1 — the four classes found on live turns) ───────
console.log('\nR10 · the receipt grammar — one clock, clean silence, deltas not events, no raw reason');
{
  // R10a — ONE CLOCK PER SURFACE (census #1: the header said 16:00 while the prose said 14:00, and
  // the model invented "confirm the correct time" to reconcile OUR bug).
  const a = src('lib/home/anticipation.ts');
  ok('the meeting time is resolved ONCE, by an exported pure helper', typeof meetingWhenLabel === 'function');
  ok('   …in the USER\'s zone, from the one clock module', /userTimezone\(client, userId\)/.test(a) && /@\/lib\/utils\/user-time/.test(a));
  ok('   …never the calendar row\'s own timezone', !/ev\.timezone/.test(a));
  ok('   …and it is computed exactly once per meeting', (a.match(/meetingWhenLabel\(/g) ?? []).length === 2); // the definition + the one call
  ok('the header renders that same value', /text,\s*$/m.test(a) && /prepTurnText\(ev\.title, when, res\.json\?\.brief\)/.test(a));
  ok('   …and the prompt states it as a settled fact', /THE MEETING'S TIME IS SETTLED: \$\{when\}/.test(a));
  ok('   …carrying the zone it was resolved into', /\$\{tz\} — the user's own timezone/.test(a));
  const stable = meetingWhenLabel('2026-09-14T15:00:00Z', 'Europe/Lisbon');
  ok('the label is a real local rendering', /\d{2}:\d{2}/.test(stable) && stable === meetingWhenLabel('2026-09-14T15:00:00Z', 'Europe/Lisbon'));
  ok('   …and two zones genuinely differ (the bug\'s whole shape)',
    meetingWhenLabel('2026-09-14T15:00:00Z', 'Europe/Lisbon') !== meetingWhenLabel('2026-09-14T15:00:00Z', 'Asia/Tokyo'));
  ok('a junk zone degrades, never throws', !!meetingWhenLabel('2026-09-14T15:00:00Z', 'Not/AZone'));
  ok('THE NO-CONFIRM RULE is in the prompt', /never write a line asking anyone to confirm, check\s*` \+\s*`or verify/.test(a) || /confirm, check|verify the meeting's time/.test(a));

  // R10b — CLEAN SILENCE: nothing to prepare → NOTHING written.
  ok('the composer has an explicit NOTHING sentinel', PREP_NOTHING === 'NOTHING' && a.includes('${PREP_NOTHING}'));
  ok('the NOTHING answer yields NO turn text', prepTurnText('Weekly sync', 'Mon 15 Sep, 16:00', PREP_NOTHING) === null);
  ok('   …however the model punctuates it', prepTurnText('x', 'y', ' "NOTHING." ') === null && prepTurnText('x', 'y', 'nothing') === null);
  ok('   …an empty answer too', prepTurnText('x', 'y', '') === null && prepTurnText('x', 'y', null) === null);
  ok('a real prep still speaks', (prepTurnText('Board review', 'Mon 15 Sep, 16:00', 'They owe the deck.') ?? '').includes('They owe the deck.'));
  ok('   …with the meeting and its ONE time in the header',
    (prepTurnText('Board review', 'Mon 15 Sep, 16:00', 'x') ?? '').startsWith('Prep for "Board review" (Mon 15 Sep, 16:00):'));
  const silentBlock = (a.match(/if \(!text\) \{[\s\S]*?\n        \}/) ?? [])[0] ?? '';
  ok('the pass writes no turn on the silent path',
    !!silentBlock && /continue;/.test(silentBlock) && !/writeRoomTurn/.test(silentBlock));
  ok('   …and still records the fire (silence is not re-spent every run)',
    /silent: true[\s\S]{0,200}?\}\,\s*\}\);/.test(a));
  // THE PROCESS PREAMBLE IS GONE — it explained the machinery, on all 30 live turns.
  const aCode = a.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');
  ok('the fixed because-preamble is deleted (the module may discuss it; it must not SPEAK it)',
    !/because this meeting is on your calendar/.test(aCode));

  // R10c — DELTAS NOT EVENTS: a drain speaks once per room per day.
  const v = src('lib/work/apply-verdict.ts');
  const e = (title: string, expired = false) => ({ title, expired, href: `/item/${title}` });
  ok('one resolution keeps its own sentence', composeResolutionLine([e('Invoice')]).startsWith('Marked "Invoice" done'));
  ok('   …and an expired one its own', composeResolutionLine([e('Invite', true)]).startsWith('Filed "Invite"'));
  ok('two become a COUNT, never two lines', composeResolutionLine([e('a'), e('b')]) === 'Marked 2 items done — they had already settled themselves — undo from Activity.');
  ok('   …six likewise', composeResolutionLine([e('a'), e('b'), e('c'), e('d'), e('e'), e('f')]).startsWith('Marked 6 items done'));
  ok('   …all-expired speaks its own word', composeResolutionLine([e('a', true), e('b', true)]).startsWith('Filed 2 items that were out of date'));
  ok('   …a mixed drain is honest about it', composeResolutionLine([e('a', true), e('b')]).startsWith('Settled 2 items that had already resolved themselves'));
  ok('every form keeps the undo door', [[e('a')], [e('a'), e('b')], [e('a', true), e('b')]].every((rows) => /undo from Activity\./i.test(composeResolutionLine(rows))));
  ok('nothing resolved says nothing', composeResolutionLine([]) === '');
  ok('the coalesce key is per ROOM per DAY, not per item', /dedupeKey: `verdict-resolve:\$\{day\}`/.test(v));
  ok('   …the day is the USER\'s day', /localNow\(await userTimezone\(client, userId\)\)\.dateStr/.test(v));
  ok('   …and the turn UPDATES IN PLACE (one keyed writer, the dedupe idiom)',
    (v.match(/dedupeKey: `verdict-resolve:/g) ?? []).length === 1);
  ok('the roll-up\'s members live in the store, never re-parsed from the sentence',
    /kind: ROLL_KIND/.test(v) && /tasks: \{ entries:/.test(v) && !/text\.match|parseInt\(.*text/.test(v));
  ok('   …deduped by the item\'s own door', /e\.href !== entry\.href/.test(v));
  // BEHAVIOURAL: the same room, twice in one day, yields ONE line — the roll composes from the
  // accumulated entries, exactly as the writer feeds it.
  const first = composeResolutionLine([e('a')]);
  const second = composeResolutionLine([e('a'), e('b')]);
  ok('a second resolution REPLACES the first line rather than adding one', first !== second && !second.includes('"a"'));
  ok('a settled item\'s own narrations ARCHIVE with it', /archiveItemNarrations\(client, userId, input, roomKey\)/.test(v));
  ok('   …by key, at the resolution seam', /`prep:\$\{input\.kind\}:\$\{input\.id\}`/.test(v) && /`revisit:\$\{input\.kind\}:\$\{input\.id\}`/.test(v));
  ok('   …archiving, never deleting (pre-migration degrades)', /archived_at: new Date\(\)\.toISOString\(\)/.test(v) && /if \(error\) \{\s*await client\.from\('room_turns'\)\.delete\(\)/.test(v));

  // R10d — THE REASON NEVER PIPES RAW.
  ok('the park line is composed from fields', typeof composeRevisitLine === 'function'
    && composeRevisitLine('Renewal', '2026-09-20') === 'Set "Renewal" aside until 2026-09-20. Say the word if you want it now.');
  ok('   …naming who it waits on when the item names one',
    composeRevisitLine('Renewal', '2026-09-20', 'Acme').includes('— waiting on Acme.'));
  ok('   …and staying silent when it does not', !composeRevisitLine('Renewal', '2026-09-20', '  ').includes('waiting on'));
  {
    // Word-boundary clipped, never mid-word: every fragment that had to be cut ends on a WHOLE word
    // of the text it came from (the C5 class — "…owed by the us. I'll bring it now…").
    const subject = 'A very long subject that will certainly run past the composed line ceiling and then some more';
    const line = composeRevisitLine(subject, '2026-09-20', 'Someone with a rather long name indeed');
    const vocab = new Set(`${subject} Set aside until waiting on Someone with a rather long name indeed Say the word if you want it now`.toLowerCase().split(/\s+/));
    const cutWords = [...line.matchAll(/([\p{L}\p{N}']+)…/gu)].map((m) => m[1].toLowerCase());
    ok('   …word-boundary clipped, never mid-word', cutWords.length > 0 && cutWords.every((w) => vocab.has(w)), line);
    ok('   …and within the composed line\'s ceiling', line.length <= 140, String(line.length));
  }
  ok('the judge\'s reason never reaches a room turn',
    !/revisit\.reason/.test(v) && (v.match(/verdict\.reason/g) ?? []).length === 2);
  ok('   …and both surviving uses are the RECORD, clipped whole', (v.match(/reason: clip\(verdict\.reason, 300\)/g) ?? []).length === 2);
  ok('   …the park now leaves its own auditable record', /type: 'work_parked'/.test(v));
  ok('no raw character slice of any prose remains in the module',
    !/\.slice\(\s*\d+\s*\)/.test(v.replace(/\/\/.*$/gm, '')) && !/clip\([^)]*\)\.slice\(/.test(v));

  // R10e — THE REASSIGNMENT LINE FOLDS.
  const h = src('lib/workflows/handoffs.ts');
  const reassignKey = (h.match(/dedupeKey: `(prep:handoff-reassigned-away[^`]*)`/) ?? [])[1] ?? '';
  ok('the moved-away line is keyed', !!reassignKey);
  ok('   …into a narration class the room\'s fold RETIRES unconditionally', /^(prep:|meeting-prep:|anticipate:)/.test(reassignKey));
  const rail = src('components/home/item-rail.tsx');
  const foldClass = (rail.match(/\/\^\(prep:\|meeting-prep:\|anticipate:\)\//) ?? [])[0] ?? '';
  ok('   …and that fold class still exists at the render (the key is aligned to a real rule)', !!foldClass);
  ok('   …it stays a MUTED EVENT LINE (no author, no component — the one-narrator grammar)',
    /role: 'system',\s*\n\s*text: `This moved to \$\{newName\}/.test(h) && !/author:/.test(h.slice(h.indexOf('This moved to') - 400, h.indexOf('This moved to') + 400)));
}

// ── R11 · THE RECEIPT GRAMMAR IN THE WORKFLOW LANE (census fixes 6+7+8) ─────────────────────────
// THE RUN'S NARRATION IS THE REPORT-BACK · a receipt ends at a boundary · urgency is a word, never
// casing, and every ask says what happens when the person acts.
console.log('\nR11 · the workflow receipts — the composed report, the boundary, the quiet ask');
{
  const stand = src('lib/workflows/standing.ts');
  const run = src('lib/workflows/run-workflow.ts');
  const rb = src('lib/workflows/report-back.ts');
  // Comments DISCUSS the dead writers and the retired wording by name; the gates read CODE.
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const standCode = strip(stand), rbCode = strip(rb);

  // R11a — THE NARRATION IS THE REPORT-BACK (it was a contentless weekly template: 45 identical
  // "X produced "Y" — this run is ready to review." turns while the composed voice had no surface).
  ok('narrateStandingRun takes the run\'s composed report', /report\?: string \| null;/.test(stand));
  ok('   …and narrates it (the template survives only as the fallback)',
    /text: report \|\| `\$\{first\} produced/.test(stand));
  ok('   …clipped at a WORD BOUNDARY (the house primitive, never mid-word)',
    /const report = clip\(String\(run\.report \?\? ''\), NARRATION_MAX\);/.test(stand));
  ok('   …wearing its author only when it IS first-person speech (the one-narrator law)',
    /\.\.\.\(report \? \{ author: \{ kind: 'coworker'/.test(stand));
  ok('the run tail hands its OWN composed report over — ONE composition per run',
    /workerName: worker\?\.name \?\? 'Your coworker', report: reportText,/.test(run));
  ok('   …and composes nothing twice (one generateReportBack call site in the run)',
    (run.match(/generateReportBack\(/g) ?? []).length === 1);
  ok('   …and standing.ts never builds a second composer of its own',
    !/generateReportBack|getAIClient|aiCreate/.test(standCode));

  // R11b — THE BOUNDARY (the stored reports on the live account end "…Next one runs Wednesday at
  // 08:00. Let me " — the dead 280-char summary writer AND a completion budget a verbose model
  // exhausts).
  ok('no 280-char report summary writer survives anywhere',
    !/summary: \w*[Rr]eport\w*\.slice\(0, ?280\)/.test(strip(run)) && !/\.slice\(0, ?280\)/.test(rbCode));
  ok('the report budget is a real ceiling (≥400)', /max_tokens: (4\d\d|[5-9]\d\d|\d{4,})/.test(rb));
  ok('a length-truncated completion is trimmed back to a boundary',
    /finish_reason === 'length' \? endAtBoundary\(text\)/.test(rb));
  {
    const cut = 'Just wrapped the briefing. Rhine water levels are hitting transport costs. Let me';
    const trimmed = endAtBoundary(cut);
    ok('   …ending on the last finished sentence', trimmed.endsWith('transport costs.'), trimmed);
    ok('   …never mid-word', !/\b(Let|me)\s*$/.test(trimmed));
    const noStop = 'A single unfinished clause running on and on and on and never once stopping anywhere at all';
    ok('   …and with no sentence end at all it cuts at a word break and MARKS the cut',
      endAtBoundary(noStop).endsWith('…') && !endAtBoundary(noStop).includes('anywher '), endAtBoundary(noStop));
    ok('   …a finished report is returned untouched', endAtBoundary('All done — it is in your Documents.') === 'All done — it is in your Documents.');
  }

  // R11c — URGENCY IS A WORD, NEVER CASING. Structural: no shouted word in any narration string.
  {
    const code = standCode;
    // Acronyms are names, not shouting — and FEEDBACK is the dated marker appended to
    // worker_instructions (a PROMPT field the model reads, never a line a person is served).
    const ALLOW = new Set(['SQL', 'AHK', 'AI', 'URL', 'PDF', 'DM', 'FEEDBACK']);
    const shouted: string[] = [];
    for (const m of code.matchAll(/`([^`\\]*)`|'([^'\\]*)'|"([^"\\]*)"/g)) {
      const lit = m[1] ?? m[2] ?? m[3] ?? '';
      for (const w of lit.match(/\b[A-Z]{3,}\b/g) ?? []) if (!ALLOW.has(w)) shouted.push(w);
    }
    ok('no ALL-CAPS chrome in any narration string', shouted.length === 0, shouted.join(', '));
  }

  // R11d — THE CONSEQUENCE IS DERIVED FROM THE OUTPUT HOME (behavioural — never invented).
  {
    const wf = (output_config: unknown): never =>
      ({ id: 'w', user_id: 'u', name: 'Weekly market brief', status: 'active', trigger: { type: 'schedule' }, next_run_at: null, output_config }) as never;
    const email = approvalLine(wf({ destination: 'email', email_to: ['ops@acme.test'] }));
    ok('an email home says who it goes to', email.includes('your approval emails it to ops@acme.test.'), email);
    ok('   …and never shouts', !/[A-Z]{3,}/.test(email.replace('Weekly market brief', '')), email);
    const slack = approvalLine(wf({ destination: 'slack', slack_channel: '#ops' }));
    ok('a slack home names the channel', slack.includes('posts it to #ops'), slack);
    const doc = approvalLine(wf({ destination: 'document' }));
    ok('a document home says where it is filed', doc.includes('files it in your Documents'), doc);
    ok('an unknown home degrades to the honest generic, never a destination',
      approvalLine(wf(null)).includes('your approval delivers it.'), approvalLine(wf(null)));
    ok('the user\'s own gate instruction rides verbatim, as its own sentence',
      approvalLine(wf({ destination: 'document' }), 'Check the tender values').endsWith('Check the tender values.'));
    const held = holdLine(wf({ destination: 'email', email_to: ['a@acme.test', 'b@acme.test'] }), 'no figure without a source');
    ok('the hold says the rule, then what clearing it does',
      held.includes('is held by your delivery check — no figure without a source.')
      && held.includes('Clear it and it emails it to a@acme.test and b@acme.test; until then nothing goes out.'), held);
    ok('   …with more than two recipients it counts them instead of listing',
      deliveryPhrase(wf({ destination: 'email', email_to: ['a@x.test', 'b@x.test', 'c@x.test'] })) === 'emails it to 3 recipients');
  }

  // R11e — THE INPUT ASK: the station's own words, then what lands when it arrives (never process).
  ok('the input ask says what the input makes happen',
    /is waiting on one thing from you: \$\{ask\.ask\} — send it and the run finishes and \$\{deliveryPhrase\(wf\)\}/.test(stand));
  ok('   …and the old process-narration is gone', !/ran as far as it can/.test(standCode));
  ok('the approval + hold lines are composed in ONE place each (no forked copies)',
    (stand.match(/text: approvalLine\(wf, ask\.instruction\),/g) ?? []).length === 2
    && (stand.match(/text: holdLine\(wf, ask\.ruleLine\),/g) ?? []).length === 2);
}

// ── R12 · THE NOISE FLOOR — noise is never prepared (census fix #3) ──────────────────────────────
// The census found 35 of 64 live `prep:*` narrations anchored on rows every posture law had already
// put in the awareness lane: "Clara drafted the reply on 'Generic outreach email'". The prepare pass
// builds candidates from the SPINE, which never passes through classifyItem — so LAW 5's floor was
// installed at a seam this lane does not look at. These gates hold the floor AND its boundary: it
// refuses to SPEND, it never judges, and it never forks the predicates it reuses.
console.log('\nR12 · THE NOISE FLOOR — noise is never prepared, and the floor is not a second judge');
{
  const nf = src('lib/prepare/noise-floor.ts');
  const pass_ = src('lib/prepare/pass.ts');
  const {
    noiseOf, NOT_NOISE,
  } = require('../lib/prepare/noise-floor') as typeof import('../lib/prepare/noise-floor');
  const echo = require('../lib/inbox/campaign-echo') as typeof import('../lib/inbox/campaign-echo');

  // (a) ONE IMPLEMENTATION, REUSED — a fork here is how the deck and the engine would come to
  //     disagree about what noise is.
  ok('the floor reuses the echo law, never a copy', /isCampaignEcho/.test(nf) && !/MARKER_CANDIDATE|deriveSignature\(/.test(nf));
  ok('   …and the deck\'s own notice law', /noticeIsDemoted/.test(nf) && !/isNoMoveNotice\(\{/.test(nf));
  ok('zero AI on the floor', !/aiCall\(|getAIClient/.test(nf));
  // AGNOSTIC CLAUSE: no sender, vendor, token or language may appear in a law.
  ok('no hardcoded identity tokens', !/@[a-z0-9-]+\.(com|pt|de|ai)\b/i.test(nf));

  // (b) IT IS A SPEND FLOOR, NOT A JUDGE — it must sit BEFORE the judge consult (so the refusal is
  //     also a cost refusal) and it must not resolve, re-posture or write anything.
  ok('the pass consults the floor', /itemIsNoise\(admin, userId, w\.entityId\)/.test(pass_));
  ok('   …BEFORE it spends on the judge', pass_.indexOf('itemIsNoise(admin, userId, w.entityId)') < pass_.indexOf("await import('@/lib/work/judge')"));
  ok('   …and refuses by RETURNING none with an honest reason (never a resolution)',
    /if \(n\.noise\) return \{ did: 'none', reason: n\.reason/.test(pass_));
  ok('the floor itself writes nothing', !/\.update\(|\.upsert\(|\.insert\(|\.delete\(/.test(nf));
  ok('   …and never touches status or posture', !/status:|rule_type:|type_override:/.test(nf.replace(/select\([^)]*\)/g, '')));

  // (c) THE BEHAVIOUR, on fixtures — the census's own shapes.
  const uid = 'u-noise';
  echo.clearCampaignRegistry();
  const row = (o: Record<string, unknown> = {}) => ({ user_id: uid, work_title: 'Coffee?', source_data: { subject: 'Coffee? | M7ZT9Y4 7MSZREM' }, ...o });
  ok('FAIL-OPEN: with no signature in hand the floor is inert', !noiseOf(row() as never).noise);
  echo.primeCampaignSignature(uid, { tokens: ['7MSZREM'], templates: [], sentRead: 600, derivedAt: new Date().toISOString(), version: echo.CAMPAIGN_SIGNATURE_VERSION });
  const v = noiseOf(row() as never);
  ok('the user\'s own campaign coming back is refused', v.noise && v.via === 'echo');
  ok('   …with a spoken reason, never a silent skip', !!v.reason && v.reason.length > 10);
  ok('A HUMAN DECISION OUTRANKS THE FLOOR (type_override)', !noiseOf(row({ type_override: 'needs_reply' }) as never).noise);
  ok('   …and an explicit campaign_echo:false un-mark', !noiseOf(row({ source_data: { subject: 'Coffee? | 7MSZREM', campaign_echo: false } }) as never).noise);
  ok('ordinary human mail is untouched', !noiseOf(row({ source_data: { subject: 'Contract review — Thursday?' } }) as never).noise);
  const notice = noiseOf({ user_id: uid, work_title: 'Portal notice', source_data: { subject: 'Your listing had a response', from_address: 'no-reply@portal.test', understanding: { mailKind: 'notification', ownership: 'none', relevance: 'awareness', role: 'bystander' } } } as never);
  ok('a bulk/no-move notice is refused too', notice.noise && notice.via === 'notice');
  ok('   …but an owed obligation from an automated sender is NOT (the notice law\'s own carve-out)',
    !noiseOf({ user_id: uid, work_title: 'Payment failed', source_data: { subject: 'Your payment failed', from_address: 'no-reply@billing.test', understanding: { mailKind: 'notification', ownership: 'you_owe', relevance: 'action', role: 'addressed' } } } as never).noise);
  ok('a broken row never breaks a preparation', NOT_NOISE.noise === false && !noiseOf(null as never).noise);
  echo.clearCampaignRegistry();
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R-LABEL · THE LABEL FOLLOWS THE PRESENT (LAW 3's watermark half)
//
// The judge and the room brief already speak a thread's newest inbound; the DECK LABEL did not.
// `understanding.ask` was computed once, at the founding message's ingest, and every later seam
// preserved it — so a row could say "Send pricing offer — overdue" months after the offer was sent.
// Two halves are gated here: the arrival re-derivation exists at EVERY seam that leaves an existing
// pending item (a seam list is how this class survived four times — so the census is a gate), and
// the serve floor degrades an unprovable claim to nothing rather than to something wrong.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nRL · THE LABEL FOLLOWS THE PRESENT — the arrival re-derivation + the serve floor');
void (async () => {
  const rf = src('lib/inbox/refresh-understanding.ts');
  const sync = src('lib/email-sync/sync-emails.ts');
  const react = src('lib/inbox/reactivate-on-reply.ts');
  const brief = src('app/api/home/brief/route.ts');

  // (a) ONE IMPLEMENTATION, AGNOSTIC.
  ok('the law lives in one module', /export async function refreshUnderstandingForArrival/.test(rf));
  ok('   …re-deriving through the SAME understanding pass, never a private prompt',
    /computeUnderstanding/.test(rf) && !/aiCreate\(|messages: \[/.test(rf));
  ok('no hardcoded identity tokens', !/@[a-z0-9-]+\.(com|pt|de|ai)\b/i.test(rf));
  // The serve half runs on every deck load — it may never reach a network, a client or a model.
  // (Comments are stripped first: the module's header NAMES the pass it is deliberately not calling.)
  const rfCode = rf.replace(/\/\*[\s\S]*?\*\/|(^|\n)\s*\/\/.*/g, '$1');
  const serveHalf = rfCode.slice(0, rfCode.indexOf('export type RefreshOutcome'));
  ok('the serve floor is pure + zero-AI',
    !/aiCall\(|getAIClient|computeUnderstanding|await |\bfrom\(/.test(serveHalf));

  // (b) THE SEAM CENSUS — every sync branch that leaves an EXISTING PENDING item without a Phase-2
  //     recompute must re-derive. These are the three `continue`/fast paths plus the reopen door.
  const seams = sync.split('refreshUnderstandingForArrival').length - 1;
  ok('the sync wires the re-derivation at its three item-touching-but-not-reclassifying seams', seams >= 3, `found ${seams}`);
  ok('   …the already-stored backfill branch', /orphanCheck\.status === 'pending'[\s\S]{0,400}refreshUnderstandingForArrival/.test(sync));
  ok('   …the raced-insert branch', /orphanCheck2\.status === 'pending'[\s\S]{0,400}refreshUnderstandingForArrival/.test(sync));
  ok('   …the fyi/noise fast path', /fastExisting[\s\S]{0,1200}refreshUnderstandingForArrival/.test(sync));
  ok('the reopen door re-derives on the message that resurrected the item',
    /refreshUnderstandingForArrival/.test(react));
  ok('the full-reclassification path STAMPS which message its claim speaks for',
    /understandingStamp\(processed\.understanding/.test(sync));
  ok('   …and a failed recompute keeps the PRIOR stamp with the prior claim',
    /carryUnderstandingStamp\(existingInboxItem/.test(sync));
  ok('every preserve-on-write rebuild carries the stamp too',
    (sync.split('carryUnderstandingStamp').length - 1) >= 3);

  // (c) THE BOUNDS — behaviour, on a client that would throw if it were ever reached.
  const boom = new Proxy({}, { get() { throw new Error('the refresh touched the database on a skip path'); } });
  const claim = { role: 'addressed', relevance: 'action', language: 'en', ask: 'Send the offer' };
  const sd = (o: Record<string, unknown> = {}) => ({ message_id: 'm2', received_at: '2026-09-10T00:00:00Z', understanding: claim, ...o });
  const run = (p: Record<string, unknown>) => refreshUnderstandingForArrival({
    userId: 'u', client: boom as never,
    message: { message_id: 'm2', received_at: '2026-09-10T00:00:00Z', body: 'x' },
    ...p,
  } as never);
  ok('never on the user\'s own reply', await run({ item: { id: 'i', status: 'pending', source_data: sd() }, isFromUser: true }) === 'skipped:own-reply');
  ok('never on a settled item', await run({ item: { id: 'i', status: 'completed', source_data: sd() } }) === 'skipped:settled');
  ok('never on a row that makes no claim (no spend where no law applies)',
    await run({ item: { id: 'i', status: 'pending', source_data: { message_id: 'm2' } } }) === 'skipped:no-claim');
  ok('IDEMPOTENT by message id — the same inbound never re-burns',
    await run({ item: { id: 'i', status: 'pending', source_data: sd({ understanding_from: 'm2' }) } }) === 'skipped:already-current');
  ok('a re-synced OLDER message never rewrites the label backwards',
    await refreshUnderstandingForArrival({
      userId: 'u', client: boom as never,
      item: { id: 'i', status: 'pending', source_data: sd({ understanding_from: 'm9', understanding_at: '2026-09-10T00:00:00Z' }) },
      message: { message_id: 'm1', received_at: '2026-08-01T00:00:00Z', body: 'x' },
    } as never) === 'skipped:older-message');

  // (d) THE SERVE FLOOR — deterministic, and the ASYMMETRY is the point.
  const OLD = '2026-09-01T00:00:00Z', NEW = '2026-09-10T00:00:00Z';
  const now = new Date('2026-09-14T00:00:00Z');
  ok('a claim naming the message we serve is fresh',
    !understandingClaimIsStale({ message_id: 'm2', received_at: NEW, understanding_from: 'm2', understanding_at: NEW }, now));
  ok('a claim naming an OLDER message is stale',
    understandingClaimIsStale({ message_id: 'm2', received_at: NEW, understanding_from: 'm1', understanding_at: OLD }, now));
  ok('   …but not within the grace window (an in-flight refresh is not a lie yet)',
    !understandingClaimIsStale({ message_id: 'm2', received_at: '2026-09-13T23:00:00Z', understanding_from: 'm1', understanding_at: OLD }, now));
  ok('an UNSTAMPED legacy row is never degraded (unprovable ≠ wrong)',
    !understandingClaimIsStale({ message_id: 'm2', received_at: NEW, understanding: claim }, now));
  const fresh = servedClaimOf({ message_id: 'm2', received_at: NEW, understanding_from: 'm2' }, { ...claim, deadline: '2026-09-20' } as never, now);
  ok('a fresh claim serves its ask AND its date', fresh.ask === 'Send the offer' && fresh.deadline === '2026-09-20' && !fresh.stale);
  const gone = servedClaimOf({ message_id: 'm2', received_at: NEW, understanding_from: 'm1', understanding_at: OLD }, { ...claim, deadline: '2026-07-22' } as never, now);
  ok('a stale claim serves NEITHER — the ask and the date fall together', gone.ask === null && gone.deadline === null && gone.stale);

  // (e) THE ROUTE SERVES THROUGH THE FLOOR — the stale deadline is what printed "overdue".
  ok('the deck\'s ask→title precedence runs through servedClaimOf', /const claim = servedClaimOf\(sd, u, now\)/.test(brief));
  ok('   …and the notice row\'s date comes from the same reader', /dueDate: claim\.deadline/.test(brief));
  ok('   …with no raw understanding ask/deadline served anywhere', !/\bu\.ask\b|\(u\.deadline/.test(brief));

  // (f) THE REPAIR RUNS THE REAL PATH.
  const sweep = src('scripts/sweep-stale-labels.ts');
  ok('the backfill re-derives through the live function, not a copy',
    /refreshUnderstandingForArrival/.test(sweep) && !/computeUnderstanding/.test(sweep));
  ok('   …selects by the shared predicate, never by hand', /claimNeedsRepair/.test(sweep));
  ok('   …is dry-run by default and refuses to run unscoped',
    /--apply/.test(sweep) && /Refusing to run unscoped/.test(sweep));
  ok('   …and pages its listing (the 1000-row cap)', /fetchAllRows/.test(sweep));

  console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-reach: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
