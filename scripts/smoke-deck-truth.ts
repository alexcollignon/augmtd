// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK TRUTH GATE (permanent — proactive-reach LAW 6, docs/proactive-reach-plan.md).
//
// THE STANDING SENTENCE: nothing the machine surfaces may be false about time, done-ness, or who is
// asking. This suite is the reason that class can never again be found first by the owner.
//
// It exists because of a specific, humiliating morning (Sep 13): Laws 1/2/3/5 all landed, every
// suite went green, and THE SERVED HOME DID NOT MOVE. Green gates over a wrong page means the gates
// were asserting plumbing. So this one asserts THE SERVING TRUTH — it builds the deck through the
// very modules the brief route serves through (`lib/home/deck-floors`, `lib/home/serve-labels`) and
// runs them against the REAL world: the probe host, and the reference account READ-ONLY.
//
// The two structural halves it guards, both born the same morning, both the same class (a law
// enforced at N seams misses the N+1th):
//   • THE LABEL CHOKE — every deck label leaves the server through ONE guard.
//   • THE DECK FLOORS — the lane-entry law lives in ONE module; the route has no private copy.
// …plus the client half, which is why the page stood still even where the server was right:
//   • THE OPEN IS AN OPEN — the no-mutation freeze may not govern a mount's first landing, and the
//     hydrate cache may not hold the frozen render (freeze debt made the freeze permanent).
//
// SCOPE, stated honestly: the data checks assert what the SERVING path can guarantee — that no row
// the deck admits contradicts the judge, the echo floor or the clock. Whether every past-anchored
// row has been REACHED by the judge at all is LAW 1's budget and `scripts/smoke-reach.ts`'s gate;
// this suite REPORTS that number rather than asserting it, so the two laws stay distinguishable.
//
// Zero AI, zero writes. Run: npx tsx --env-file=.env.local scripts/smoke-deck-truth.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { classifyItem } from '../lib/inbox/classify-item';
import { getCampaignSignature, isCampaignEcho, type CampaignSignature } from '../lib/inbox/campaign-echo';
import {
  rePromotesToDeck, noticeIsDemoted, deckEligible, readJudgedNone, anchorOf, verdictDemotes,
  DECK_POOL_LIMIT, ACTION_NOTICE_LIMIT, REPLY_LIMIT,
  type DeckFloors, type DeckItem,
} from '../lib/home/deck-floors';
import { guardDeckLabels, servedLabelsOf, DECK_LABEL_FIELDS } from '../lib/home/serve-labels';
import { carriesDayWord } from '../lib/inbox/deixis';
// THE LABEL FOLLOWS THE PRESENT (LAW 3's watermark half) — the same reader the brief route serves
// through, so the gate and the page cannot disagree about what may still be spoken.
import { understandingClaimIsStale, servedClaimOf, claimNeedsRepair } from '../lib/inbox/refresh-understanding';
import { readSiblingNominations } from '../lib/inbox/conversation-identity';
import type { DoItem } from '../lib/home/agenda';

const root = join(__dirname, '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TODAY = new Date().toISOString().slice(0, 10);

// The reference account (read-only) — the one the census walked. Resolved by PREFIX so no personal
// identifier lives in the suite; absent → the check simply reports "not present".
const REFERENCE_PREFIX = '08fe4449';

// The bounds are READ from the one module the route reads them from — never mirrored as a number
// here (a mirrored bound drifts the day someone raises one of them).

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── D1 · THE LABEL CHOKE EXISTS AND IS THE BOUNDARY ─────────────────────────────────────────────
console.log('\nD1 · the serve-label choke is THE boundary (LAW 3 as a structure)');
{
  const r = src('app/api/home/brief/route.ts');
  ok('the response passes through guardDeckLabels',
    /return NextResponse\.json\(guardDeckLabels\(\{/.test(r));
  ok('the route imports the choke from the ONE module',
    /import \{ guardDeckLabels \} from '@\/lib\/home\/serve-labels'/.test(r));
  const s = src('lib/home/serve-labels.ts');
  ok('the field table is explicit and non-empty', Object.keys(DECK_LABEL_FIELDS).length >= 6);
  ok('the guard is pure (no fetch / no AI / no clock)',
    !/@supabase|getAIClient|aiCreate|Date\.now\(/.test(s));
  // IDENTITY IS NEVER STRIPPED — a surname or a product may legitimately BE a day-word.
  const identity = ['who', 'name', 'label', 'from', 'primary', 'counterparty', 'title'];
  const stripped = new Set(Object.entries(DECK_LABEL_FIELDS).flatMap(([lane, fs]) => fs.map((f) => `${lane}.${f}`)));
  ok('no identity field is in the strip table',
    !Object.entries(DECK_LABEL_FIELDS).some(([lane, fs]) => fs.some((f) => identity.includes(f) && lane !== 'priorities')),
    [...stripped].filter((k) => identity.some((i) => k.endsWith(`.${i}`))).join(', '));
  // The guard is TOTAL: a lane nobody remembered to strip upstream still cannot serve a day-word.
  const dirty = { actionNotices: [{ itemId: 'x', summary: 'Send the link for Thursday 11h call' }],
    commitments: [{ id: 'c', description: 'Confirm lunch tomorrow' }],
    slippingDeals: [{ key: 'k', label: 'Monday Motors', summary: 'Quiet since next week' }] };
  const clean = guardDeckLabels(dirty as any);
  ok('a dirty payload comes out clean', !servedLabelsOf(clean).some((l) => carriesDayWord(l.text)));
  ok('   …and an IDENTITY field is left exactly as it was',
    (clean as any).slippingDeals[0].label === 'Monday Motors');
}

// ── D2 · THE LANE-ENTRY LAW HAS ONE HOME ────────────────────────────────────────────────────────
console.log('\nD2 · the deck floors are the route\'s only lane-entry law');
{
  const r = src('app/api/home/brief/route.ts');
  ok('the route composes candidates via rePromotesToDeck',
    /\.filter\(\(x\) => rePromotesToDeck\(/.test(r));
  ok('the route demotes notices via noticeIsDemoted',
    /const noticeDemoted = noticeIsDemoted\(/.test(r));
  ok('the route has no private re-promote copy',
    !/u\.role === 'addressed' \|\| u\.ownership === 'you_owe'/.test(r));
  // NO SILENT CAP: the judge's word must reach every candidate, not the first 300 of them.
  ok('the judgment consult is uncapped (readJudgedNone, chunked)',
    /await readJudgedNone\(supabase, user\.id, emailCandidates\.map/.test(r)
    && !/candIds\.slice\(0, ?\d+\)/.test(r));
  const f = src('lib/home/deck-floors.ts');
  ok('the floors are zero-AI', !/getAIClient|aiCreate|aiCall\(/.test(f));
  ok('the echo floor sits ABOVE the re-promote door', /if \(floors\.isEcho\(it\)\) return false;/.test(f));
  ok('a dispositioned none demotes too (no `!v.resolution` carve-out)',
    !/work === 'none' && !v\.resolution/.test(f) && verdictDemotes({ work: 'none', resolution: 'expired' }));
  ok('the you_owe shelter is bound to the SENDER floor that justifies it',
    /const sheltered = youOweAction && senderIsAutomated\(it\)/.test(f));
  ok('the gate mirrors the route\'s deck pool (bound + filter + order)',
    r.includes(".order('last_activity_at', { ascending: false, nullsFirst: false }).limit(DECK_POOL_LIMIT)")
    && r.includes("work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)"));
  ok('the echo signature is primed before the classify pass',
    r.indexOf('getCampaignSignature(supabase, user.id)') > 0
    && r.indexOf('getCampaignSignature(supabase, user.id)') < r.indexOf('posture: classifyItem('));
}

// ── D3 · THE OPEN IS AN OPEN (the client half) ──────────────────────────────────────────────────
console.log('\nD3 · the no-mutation freeze governs an open, never a cache');
{
  const h = src('components/home/home-view.tsx');
  ok('the mount\'s FIRST landing is never frozen',
    /const isFirstLanding = firstLandingRef\.current;/.test(h)
    && /mergeBrief\(briefRef\.current, b, background && !userCaused && !isFirstLanding\)/.test(h));
  ok('the hydrate cache holds the RAW payload', /saveServedBrief\(b as Brief\)/.test(h));
  ok('   …and nothing writes the merged brief back into it',
    !/saveLS\('aug-home-brief-v1', brief\)/.test(h));
  ok('the cache still has exactly ONE writer',
    (h.match(/saveLS\('aug-home-brief-v1'/g) ?? []).length === 1);
  ok('the freshness floor on the hydrate read stands',
    /loadLS<Brief>\('aug-home-brief-v1', \{ maxAgeMs: 15 \* 60_000 \}\)/.test(h));
}

// ── THE WORLD ───────────────────────────────────────────────────────────────────────────────────
async function auditAccount(label: string, userId: string) {
  console.log(`\nD4 · THE STANDING SENTENCE on the world — ${label}`);
  let sig: CampaignSignature | null = null;
  try { sig = await getCampaignSignature(sb, userId); } catch { /* inert */ }

  // THE ROUTE'S OWN POOL, mirrored exactly — same filter, same order, same bound. The mirror is
  // pinned by a source assertion in D2 so it cannot drift: a gate reading a WIDER pool than the
  // route would invent violations the deck never had, and a narrower one would miss real ones.
  const { data: poolRows } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data, source')
    .eq('user_id', userId).eq('status', 'pending')
    .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
    .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(DECK_POOL_LIMIT);
  const rows = (poolRows ?? []) as any[];
  const emails = rows.filter((r) => r.source !== 'meeting' && r.source !== 'commitment');
  ok(`the deck pool is not saturated (${rows.length} < ${DECK_POOL_LIMIT})`, rows.length < DECK_POOL_LIMIT);
  console.log(`     (${rows.length} in pool · ${emails.length} mail rows)`);

  const judgedNone = await readJudgedNone(sb, userId, emails.map((e) => e.id));
  const floors: DeckFloors = { judgedNone, isEcho: (it) => isCampaignEcho(it as never, sig) };

  // The deck's own admissions, derived through the SERVING modules — never a second derivation.
  const admitted = emails
    .map((it) => ({ it: it as DeckItem, posture: classifyItem(it as never, []) }))
    .filter((x) => deckEligible(x.it, x.posture, floors));

  // (1) THE JUDGE'S WORD — a row the brain closed may not lead the deck.
  const contradicts = admitted.filter((x) => judgedNone.has(x.it.id));
  ok(`no admitted row carries a demoting judgment (${admitted.length} admitted)`,
    contradicts.length === 0, contradicts.slice(0, 5).map((x) => x.it.id.slice(0, 8)).join(', '));

  // (2) THE ECHO FLOOR — the user's own outbound coming back never earns a seat.
  const echoes = admitted.filter((x) => floors.isEcho(x.it));
  ok('no campaign echo is admitted', echoes.length === 0,
    echoes.slice(0, 5).map((x) => x.it.id.slice(0, 8)).join(', '));

  // (3) THE CLOCK — a past anchor may stand only while the judge has not closed it. An overdue
  //     invoice IS still owed; an ended meeting is not (the judge's own July law).
  const past = admitted.filter((x) => { const a = anchorOf(x.it); return !!a && a < TODAY; });
  const pastClosed = past.filter((x) => judgedNone.has(x.it.id));
  ok(`no past-anchored row stands against its own judgment (${past.length} past-anchored)`,
    pastClosed.length === 0, pastClosed.slice(0, 5).map((x) => x.it.id.slice(0, 8)).join(', '));
  const unjudgedPast = past.filter((x) => !judgedNone.has(x.it.id));
  console.log(`     · LAW 1 reach surface: ${unjudgedPast.length} past-anchored rows the judge has not closed (reported, see smoke-reach)`);

  // (4) THE SERVED WORDS — the choke cleans the real corpus, not a fixture.
  const payload = guardDeckLabels({
    actionNotices: admitted.map((x) => ({ itemId: x.it.id, summary: (x.it.source_data?.understanding?.ask as string) || x.it.work_title || '' })),
    commitments: (await sb.from('commitments').select('id, description').eq('user_id', userId).eq('status', 'open').limit(400)).data ?? [],
  } as any);
  const dirtyLabels = servedLabelsOf(payload).filter((l) => carriesDayWord(l.text));
  ok('no served deck label carries a day-word', dirtyLabels.length === 0,
    dirtyLabels.slice(0, 4).map((l) => `${l.lane}.${l.field}: ${JSON.stringify(l.text)}`).join(' | '));

  // (4b) LAW 4's REACH SURFACE — a whisper whose SAME CONVERSATION was settled on another thread,
  //      whose own judgment has not yet seen that news. Settlement spread as far as the law allows
  //      (a structural, unmoved sibling cascades outright); what remains here is the NOMINATED tail,
  //      waiting for its turn in LAW 1's queue. REPORTED, never asserted — like the past-anchored
  //      remainder above, this is the sweep's budget, not the serving path's truthfulness.
  {
    const noms = await readSiblingNominations(sb, userId);
    let lagging = 0;
    if (noms.size && admitted.length) {
      const keys = admitted.map((x) => `inbox:${x.it.id}`).filter((k) => noms.has(k));
      if (keys.length) {
        const { data: judged } = await sb.from('item_plans').select('entity_id, updated_at')
          .eq('user_id', userId).eq('kind', 'judgment').in('entity_id', keys);
        const judgedAt = new Map((judged ?? []).map((r: any) => [String(r.entity_id), String(r.updated_at ?? '')]));
        lagging = keys.filter((k) => (judgedAt.get(k) ?? '') < String(noms.get(k)!.at)).length;
      }
    }
    console.log(`     · LAW 4 reach surface: ${noms.size} standing sibling nomination(s); ${lagging} admitted row(s) still judged before that news (reported, see smoke-reach R8)`);
  }

  // (5) THE DOOR'S NUMBER IS REAL — no lane is silently saturated by its own safety bound.
  const notices = admitted.filter((x) => (x.it.source_data?.understanding?.relevance) === 'action');
  ok(`the action-notice lane is not saturated (${notices.length} < ${ACTION_NOTICE_LIMIT})`, notices.length < ACTION_NOTICE_LIMIT);
  const replies = admitted.length - notices.length;
  ok(`the reply lane is not saturated (${replies} < ${REPLY_LIMIT})`, replies < REPLY_LIMIT);

  // (6) THE LABEL FOLLOWS THE PRESENT — no admitted row may speak a claim its own thread has moved
  //     past. Found live (Sep 14): a row read "<person> — Send pricing offer … — overdue" from an
  //     `understanding.ask` derived at the FOUNDING message's ingest, with the stale `deadline`
  //     under it printing the "overdue". Two halves, asserted where each is provable:
  //       • STALE (stamped, naming an older message than the row now carries) is a VIOLATION — the
  //         serve floor exists precisely so this can never reach a label.
  //       • LEGACY (unstamped, unprovable) is REPORTED, not failed: those heal through
  //         scripts/sweep-stale-labels.ts, and failing on them would assert the repair's backlog
  //         rather than the law (the same line LAW 1's reach number is held to above).
  {
    const stale = admitted.filter((x) => understandingClaimIsStale(x.it.source_data));
    ok(`no admitted row serves a claim older than its own newest message (${stale.length} stale)`,
      stale.length === 0,
      stale.slice(0, 3).map((x) => `${x.it.id.slice(0, 8)} "${x.it.source_data?.understanding?.ask ?? ''}"`).join(' · '));
    const legacy = admitted.filter((x) => claimNeedsRepair(x.it) === 'legacy');
    console.log(`     · ${legacy.length} admitted row(s) carry an UNSTAMPED claim whose provenance cannot be checked (reported; heal with scripts/sweep-stale-labels.ts)`);
    // And the serve floor is actually consulted for both halves of the claim, not just the words.
    const oneStale = { message_id: 'm2', received_at: '2020-01-01T00:00:00Z', understanding_from: 'm1', understanding_at: '2019-01-01T00:00:00Z' };
    const served = servedClaimOf(oneStale, { role: 'addressed', relevance: 'action', language: 'en', ask: 'x', deadline: '2019-02-02' } as never);
    ok('a stale claim can serve neither its ask nor its date', served.ask === null && served.deadline === null);
  }
}

// ── D5 · THE DERIVED-SPEECH FLOOR — a whisper speaks derived speech or it doesn't whisper ────────
// Found live (census fix #9): the Home served "📣 New for you! Exploring Sherry - Lisbon 🎫" AS THE
// MACHINE'S OWN SENTENCE — `whisperSentence` falls back to the raw subject when `understanding.ask`
// is null, so a marketer's copy was published in the harness's voice beside a derived receipt word.
// Pure fixtures: the law is a SHAPE (chrome is chrome in every language), so no account is needed.
function whisperFloorGates() {
  console.log('\nD5 · THE DERIVED-SPEECH FLOOR — the whisper\'s sentence is the machine\'s own words');
  const {
    whisperSentence, isDerivedSpeech, neutralizeChrome, speechRank, pickWhispers, sortDoorRows,
  } = require('../lib/home/calm') as typeof import('../lib/home/calm');
  const src_ = src('lib/home/calm.ts');
  const row = (o: Partial<DoItem>): DoItem =>
    // people-facing by default, so the calm-chore cap never confounds the speech-rank fixtures
    ({ source: 'reply', key: `k${Math.random()}`, entityId: 'e', href: '', ask: '', ...o });

  ok('the floor is deterministic — no AI reaches the serve path', !/aiCall\(|getAIClient/.test(src_));
  // THE AGNOSTIC CLAUSE: a shape, never a vocabulary — no vendor, word list or language anywhere.
  const code_ = src_.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('   …and it is a SHAPE, not a word list', !/unsubscribe|newsletter|promo|sale|oferta/i.test(code_));

  ok('a marketing subject is NOT derived speech', !isDerivedSpeech('📣 New for you! Exploring Sherry - Lisbon 🎫'));
  ok('a judged ask IS derived speech', isDerivedSpeech('Confirm whether Thursday 14:00 still works'));
  ok('shouted punctuation is chrome too', !isDerivedSpeech('Last chance!! 40% off'));
  ok('THE ROW STILL SEATS — it speaks a neutral title, never nothing',
    whisperSentence(row({ primary: 'Exploring', ask: '📣 New for you! Exploring Sherry - Lisbon 🎫' }))
      === 'Exploring — New for you! Exploring Sherry - Lisbon');
  ok('   …and the raw chrome never serves as a sentence',
    !/📣|🎫/.test(whisperSentence(row({ ask: '📣 New for you! Exploring Sherry - Lisbon 🎫' }))));
  ok('NOTHING IS ADDED, ONLY CHROME REMOVED — a sign is not decoration',
    neutralizeChrome('-40% em Roupa + Envio por 1€ 🚚') === '-40% em Roupa + Envio por 1€');
  ok('   …and a name keeps its own marks (©®™ are part of the name, not chrome)',
    isDerivedSpeech('This Month at GHOST®') && neutralizeChrome('This Month at GHOST®') === 'This Month at GHOST®');
  ok('   …a derived sentence passes through verbatim',
    whisperSentence(row({ primary: 'Sandra', ask: 'Confirm the Thursday slot' })) === 'Sandra — Confirm the Thursday slot');
  ok('an emptied line falls back to the ladder, never to blank',
    whisperSentence(row({ primary: 'Acme', ask: '🎫🎫' })) === 'Acme');

  // THE SORT KEY, in both bands it governs.
  const derived = row({ key: 'derived', ask: 'Send the signed contract back' });
  const quoted = row({ key: 'quoted', ask: '🔥 Big news inside' });
  ok('speechRank: derived speech ranks ahead', speechRank(derived) === 0 && speechRank(quoted) === 1);
  ok('   …the fold seats derived speech first within a band',
    pickWhispers([quoted, derived], 2).map((i) => i.key).join(',') === 'derived,quoted');
  ok('   …and the door orders it the same way (one law, both bands)',
    sortDoorRows([quoted, derived], (r) => r).map((i) => i.key).join(',') === 'derived,quoted');
  ok('   …but a FIRE still outranks everything (the seated-fire law is untouched)',
    pickWhispers([derived, row({ key: 'fire', ask: '🔥 Overdue notice', overdue: true })], 2)[0].key === 'fire');
}

async function main() {
  whisperFloorGates();
  const probe = await resolveProbeUser(sb);
  await auditAccount('the probe host', probe);

  const { data: profs } = await sb.from('profiles').select('id').limit(500);
  const ref = (profs ?? []).map((p) => p.id as string).find((id) => id.startsWith(REFERENCE_PREFIX));
  if (ref) await auditAccount('the reference account (read-only)', ref);
  else console.log('\nD4 · reference account not present in this database — skipped');

  console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-deck-truth: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
