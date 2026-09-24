// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE QUALITY GATE — Q1 · THE SELF-RECOGNITION FLOOR (docs/attention-plan.md PART III).
//
// "A law is only alive while a gate enforces it." This suite holds the Q1 laws:
//
//   SQ1 · THE FLOOR IS STRUCTURAL AND ONE-HOMED — one predicate, one home
//         (lib/inbox/self-echo), consulted by the judge, the commitment extractor, the deck's
//         counting seam and the notice law. A second implementation is the site-list decay.
//   SQ2 · THE FLOOR ON THE WORLD — on live accounts, not one served needs-you row carries one of
//         the user's OWN coworkers as its sender, asserted through the modules the deck serves
//         through (classifyItem → deckEligible), never a re-derivation.
//   SQ3 · THE VOICE COLLAPSES — when the narrated actor IS the speaker, the composed opening
//         speaks first person; a counterparty who happens to share the given name does not.
//   SQ4 · CLAIM ONLY WHAT RENDERS — "drafted a reply below" cannot survive composition when
//         nothing is prepared; a claim that WAS the whole position degrades honestly.
//   SQ5 · THE SWEEP IS GUARDED — dry-run by default, --apply to write, paged reads,
//         archive-not-delete, through the undoable door.
//   SQ6 · THE SEAT CONTRACT (Q4) — a seat is finished preparation, not a ranking: a self-authored
//         row and a row that failed proof-of-life never rank; a prepared row outranks a
//         needs-shaping row at equal urgency; the seat word comes from the machine's own
//         vocabulary, typed nowhere else.
//   SQ7 · A DECISION SHOWS ITS OBJECT (Q5) — the card resolves its object from the door's own
//         prepared artifacts and renders it; with none it says so and recommends NOTHING.
//   SQ8 · A CTA REVIEWS WORK DONE (Q6) — an unstaged move composes the CoS's offer, never a
//         primary button; the code floor sits AFTER the model at both seams.
//   SQ9 · THE GROUNDING SPEAKER (Q1's source half) — assembleRoomGrounding takes the speaker and
//         renders a self-authored ask in the first person, so every consumer inherits the collapse.
//
// …and the Sep 18 morning walk ("only surfacing 2 items… held quiet is still a massive list, with
// no way of dismissing any, or mark done, as we had… not helpful at any stage"):
//   SQ10 · VERBS ON EVERY ROW — a surface that lists work offers the deck's OWN deeds through the
//          deck's OWN doors (mail → the inbox routes, a commitment → the commitments route), the
//          existing undo, and never a second mutation path or a verb the row cannot keep.
//   SQ11 · THE FILL — the list runs on rather than starving at two rows: the server's own
//          held-back order, resolved against rows the brief already carries, capped by the calm
//          module's own five, and riding ONE list with ONE door line at its bottom (no header,
//          no divider, no second section — owner, Sep 18: "this split approach not sure looks good").
//   SQ18 · THE DOOR OPENS AT ONCE (owner, live Sep 18: "not opening" — 20–30s of "Reading the
//          account…" over a bare list before card one). The deck mounts on rows the client ALREADY
//          holds and is EXTENDED in place when the full read lands (append-only, never a reorder);
//          it never states a total it has not been handed; and the ledger paints warm off both
//          cache layers the house doctrine already owns — the server's stored last-good
//          (item_plans, converged in after(), busted by the reader's own deed) and the stamped
//          localStorage hydrate that demands freshness.
//   SQ19 · THE DECK, RESHAPED (Q9v2 — owner walk, Sep 18 afternoon: "hard to follow, empty real
//          estate"). The frame owns the verbs (two big pills above a stack whose card holds nothing
//          verb-shaped), the deck takes the room (the prose folds, reachable, and returns on Close),
//          and the card is the thing itself — the thread's tail through the EXISTING door, lazily,
//          cached, prefetched one ahead, clipped by the one clipper — under a reply slot that
//          SPEAKS through the item's own conversation door and never sends.
//   SQ21 · THE OPENING CONTRACT, clauses 2+3 (docs/threads-plan.md — the Sep 19 walk): the opening
//          says each fact ONCE, leaves no pointer whose antecedent isn't in its own text, names a
//          person at most once per sentence, states the absence of renderable work as a FACT, and
//          refuses to serve a composition still narrating the speaker by name.
//   SQ12 · THE GREETING STOPS AT THE GREETING — a line under it was built deterministically,
//          walked live and REMOVED ("the top clara line should be removed"); the gate asserts the
//          absence on both sides, composer and render, so a restoration is a decision not a drift.
//
// Zero AI, zero writes. Run: set -a; source .env.local; set +a; npx tsx scripts/smoke-quality.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { classifyItem } from '../lib/inbox/classify-item';
import { getCampaignSignature, isCampaignEcho, type CampaignSignature } from '../lib/inbox/campaign-echo';
import { deckEligible, type DeckFloors, type DeckItem } from '../lib/home/deck-floors';
import { isVisibleObligationRow } from '../lib/home/dedupe-deck';
import { isNoMoveNotice } from '../lib/inbox/notice-demotion';
import {
  isOwnCoworkerSender, itemIsSelfEcho, ownCoworkerLocals, COWORKER_EMAIL_LOCALS, SELF_ECHO_REASON,
} from '../lib/inbox/self-echo';
import {
  collapseSelfVoice, namesSelfInThirdPerson, enforceRenderedClaims, OFFER_INSTEAD,
} from '../lib/room/self-voice';
import {
  dropRestatements, stripDanglingRefs, nameOncePerSentence,
} from '../lib/room/opening-discipline';
import { GENERIC_WORK_WORDS } from '../lib/entities/recognize';
import {
  seatVerdict, rankAttention, aliveByContract, provedAliveOf, whyNowOf, rowNeedsShaping,
  ATTENTION_BUDGET, type AttentionRow, bandOf, classifyHeld, whyHeldOf,
} from '../lib/home/attention';
import { NEEDS_SHAPING_WORD, SEAT_WORDS, STATE_WORDS } from '../lib/work/machine';
import { resolveDecisionObject, mayRecommend, NO_DECISION_OBJECT_LINE } from '../lib/room/decision-object';
import { enforceCtaLaw, moveIsStaged, shapingOffer, shapingSay } from '../lib/room/cta-law';
import { askAttribution } from '../lib/room/grounding';
import { JUDGE_VERSION } from '../lib/work/surface-registry';
import { ROOM_BRIEF_VERSION } from '../lib/room/brief';
import { COWORKER_EMAIL_DOMAIN, EMAIL_LOCAL_BY_ROLE } from '../lib/integrations/registry';
import {
  TRIAGE_KEYS, TRIAGE_VERBS, triageReceipt, laterOptions, threadTail, initialOf, verbsOfRank,
  TRIAGE_MESSAGE_CHARS, TRIAGE_TAIL_MESSAGES, TRIAGE_STEER_KIND,
} from '../lib/triage/words';
import { EXCERPT_MARK } from '../lib/utils/clip-for-prompt';
import { mergeQueue, queueCount } from '../lib/triage/queue';
import { initialWaitingShape } from '../lib/triage/view-shape';
import { DECISION_CARD_H, DECISION_ACTIONS_H } from '../components/triage/decision-frame';
import type { DoItem } from '../lib/home/agenda';

const root = join(__dirname, '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const REFERENCE_PREFIX = '08fe4449';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DOM = String(COWORKER_EMAIL_DOMAIN);
const aCoworker = `${Object.values(EMAIL_LOCAL_BY_ROLE)[0]}@${DOM}`;

// ── SQ1 · THE FLOOR IS STRUCTURAL AND ONE-HOMED ─────────────────────────────────────────────────
function sq1() {
  console.log('\nSQ1 · THE FLOOR — one predicate, one home, consulted at every seam');
  ok('the floor recognizes a coworker address', isOwnCoworkerSender(aCoworker));
  ok('   …in a display form too', isOwnCoworkerSender(`Clara · your assistant <${aCoworker}>`));
  ok('   …and sub-addressed sends', isOwnCoworkerSender(aCoworker.replace('@', '+run17@')));
  ok('every role local-part the address producer can emit is recognized',
    Object.values(EMAIL_LOCAL_BY_ROLE).every((l) => isOwnCoworkerSender(`${l}@${DOM}`)));
  ok('   …and the unmapped-role fallback local', isOwnCoworkerSender(`team@${DOM}`));

  // ⚠️ THE DOMAIN IS NOT THE KEY: the coworker domain is shared across tenants and carries other
  // senders. A stranger on it is a real counterparty and must stay one.
  ok('a NON-role sender on the same domain is NOT floored', !isOwnCoworkerSender(`someone.else@${DOM}`));
  ok('a coworker local on ANOTHER domain is NOT floored', !isOwnCoworkerSender(`${Object.values(EMAIL_LOCAL_BY_ROLE)[0]}@acme.com`));
  ok('an empty/garbage sender is never floored',
    !isOwnCoworkerSender(null) && !isOwnCoworkerSender('') && !isOwnCoworkerSender('not-an-address'));

  const echoItem = { source_data: { from_address: aCoworker, subject: 'Approve the shortlist' } };
  const realItem = { source_data: { from_address: 'sam@acme.com', subject: 'Approve the shortlist' } };
  ok('the item reader finds the sender where a row keeps it', itemIsSelfEcho(echoItem) && !itemIsSelfEcho(realItem));

  // ONE HOME, N consultations — a second copy of this predicate is the decay this gate exists for.
  const homes: Array<[string, string]> = [
    ['the judge', 'lib/work/judge.ts'],
    ['the commitment extractor', 'lib/commitments/extract.ts'],
    ['the deck counting seam', 'lib/home/dedupe-deck.ts'],
    ['the notice law', 'lib/inbox/notice-demotion.ts'],
  ];
  for (const [label, file] of homes) {
    ok(`${label} imports the floor`, /from '@\/lib\/inbox\/self-echo'/.test(src(file)), file);
  }
  const forks = ['lib/work/judge.ts', 'lib/commitments/extract.ts', 'lib/home/dedupe-deck.ts', 'lib/home/deck-floors.ts']
    .filter((f) => src(f).includes(DOM));
  ok('no consumer re-derives the coworker domain for itself', forks.length === 0, forks.join(', '));

  // THE NOTICE LAW inherits it by DEFAULT — a floor every caller has to remember to pass is a
  // site list, so the law derives the fact from the sender it already holds.
  ok('the notice law floors a coworker sender with no flag passed',
    isNoMoveNotice({ u: null, fromEmail: aCoworker, fromName: 'Clara', subject: 'Approve the shortlist', workState: 'decision_required' }));
  ok('   …and still does NOT floor a real human sender',
    !isNoMoveNotice({ u: null, fromEmail: 'sam@acme.com', fromName: 'Sam', subject: 'Approve the shortlist', workState: 'action_required' }));

  // THE COUNTING SEAM (P3's own predicate): a pointer never occupies an obligation row, and never
  // becomes the surface a real commitment folds behind.
  ok('a self-echo row is not a visible obligation row',
    !isVisibleObligationRow({ ...echoItem, work_state: 'decision_required', rule_type: 'needs_reply' }));
  ok('   …while the same row from a real counterparty is',
    isVisibleObligationRow({ ...realItem, work_state: 'decision_required', rule_type: 'needs_reply' }));
  ok('   …and the user\'s own re-type still outranks the floor',
    isVisibleObligationRow({ ...echoItem, type_override: 'needs_reply' }));

  // THE JUDGE — structural, before any AI, with the one shared reason.
  const j = src('lib/work/judge.ts');
  ok('the judge floors it BEFORE the notice law and before any AI',
    j.indexOf('isOwnCoworkerSender(whoEmail') > 0 && j.indexOf('isOwnCoworkerSender(whoEmail') < j.indexOf('isNoMoveNotice({'));
  ok('   …judging `none` with no disposition (a pointer is neither expired nor answered)',
    /fallbackVerdict\(SELF_ECHO_REASON\)/.test(j) && SELF_ECHO_REASON.length > 0);
  ok('   …narrowed to THIS user\'s roster', /ownCoworkerLocals\(client, userId\)/.test(j));
  ok('JUDGE_VERSION carries the law', JUDGE_VERSION >= 19 && /19: THE SELF-RECOGNITION FLOOR/.test(src('lib/work/surface-registry.ts')));

  // THE EXTRACTOR — structural, before the AI call.
  const e = src('lib/commitments/extract.ts');
  ok('the extractor refuses to mint from a coworker\'s mail',
    /if \(!isFromUser && isOwnCoworkerSender\(counterparty\)\) return 0;/.test(e));
  ok('   …before the AI call', e.indexOf('isOwnCoworkerSender(counterparty)') < e.indexOf('const perspective'));

  // The registry set itself is derived, never hand-listed per role.
  ok('the recognizer set is derived from the address producer',
    Object.values(EMAIL_LOCAL_BY_ROLE).every((l) => COWORKER_EMAIL_LOCALS.has(l)));
}

// ── SQ2 · THE FLOOR ON THE WORLD ────────────────────────────────────────────────────────────────
async function sq2(label: string, userId: string) {
  console.log(`\nSQ2 · THE FLOOR ON THE WORLD — ${label}`);
  let sig: CampaignSignature | null = null;
  try { sig = await getCampaignSignature(sb, userId); } catch { /* inert */ }
  const locals = await ownCoworkerLocals(sb, userId);

  const { data: poolRows } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data, source, last_activity_at, created_at')
    .eq('user_id', userId).eq('status', 'pending').neq('source', 'commitment')
    .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(800);
  const rows = (poolRows ?? []) as any[];

  const judgedNone = new Set<string>();
  {
    const ids = rows.map((r) => `inbox:${r.id}`);
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', 'judgment').in('entity_id', ids.slice(i, i + 150));
      for (const jr of (data ?? []) as any[]) {
        if (jr.tasks?.verdict?.work === 'none') judgedNone.add(String(jr.entity_id).replace(/^inbox:/, ''));
      }
    }
  }
  const floors: DeckFloors = { judgedNone, isEcho: (it) => isCampaignEcho(it as never, sig) };
  const eligible = rows
    .map((it) => ({ it: it as DeckItem, posture: classifyItem(it as never, []) }))
    .filter((x) => deckEligible(x.it, x.posture, floors));

  const selfEchoes = rows.filter((r) => itemIsSelfEcho(r, locals));
  const leaked = eligible.filter((x) => itemIsSelfEcho(x.it, locals) && !x.it.type_override);
  console.log(`     (${rows.length} pending · ${selfEchoes.length} from our own coworkers · ${eligible.length} deck-eligible)`);
  ok('not one deck-eligible row carries one of the user\'s own coworkers as its sender',
    leaked.length === 0,
    leaked.slice(0, 5).map((x) => `${(x.it.source_data as any)?.from_address}: ${x.it.work_title}`).join(' | '));
  ok('   …and none of them counts as a visible obligation row',
    selfEchoes.filter((r) => !r.type_override).every((r) => !isVisibleObligationRow(r)));
}

// ── SQ3 · THE VOICE COLLAPSES ───────────────────────────────────────────────────────────────────
function sq3() {
  console.log('\nSQ3 · THE VOICE COLLAPSES — the speaker never narrates itself in the third person');
  const S = 'Clara';
  ok('"Clara is asking you…" becomes first person',
    collapseSelfVoice('Clara is asking you to approve the shortlist.', S) === "I'm asking you to approve the shortlist.");
  ok('   …and the verb agrees across an adverb',
    collapseSelfVoice('Clara still needs the job spec.', S) === 'I still need the job spec.');
  ok('   …possessives collapse too',
    collapseSelfVoice("The client is waiting on Clara's draft.", S) === 'The client is waiting on my draft.');
  ok('   …and a future tense contracts naturally',
    collapseSelfVoice('Clara will send it once you approve.', S) === "I'll send it once you approve.");
  ok('   …object position takes "me", never "I"',
    collapseSelfVoice('Send the spec to Clara.', S) === 'Send the spec to me.');

  // THE NAME TEST: a counterparty who shares the given name is a DIFFERENT person.
  const mixed = 'Sam Clara replied on Tuesday and Clara Jones is copied.';
  ok('a counterparty sharing the given name is left alone', collapseSelfVoice(mixed, S) === mixed);
  ok('ANOTHER coworker is still named normally',
    collapseSelfVoice('Max drafted the briefing.', S) === 'Max drafted the briefing.');
  ok('the speaker\'s own untouched first person is not mauled',
    collapseSelfVoice('I always check the thread first.', S) === 'I always check the thread first.');
  ok('an unnamed speaker leaves the text exactly as composed',
    collapseSelfVoice('Clara is asking you.', null) === 'Clara is asking you.');
  ok('the detector agrees with the rewriter',
    namesSelfInThirdPerson('Clara is asking you.', S) && !namesSelfInThirdPerson('I am asking you.', S));

  // The composer must actually RUN both halves — the prompt AND the code.
  const b = src('lib/room/brief.ts');
  ok('the composer knows who it is (the CoS seat, never a hardcoded name)',
    /resolveCosSeat/.test(b) && !/'Clara'/.test(b.replace(/\/\/.*/g, '').replace(/`[^`]*`/g, '')));
  ok('   …carries the rule in the prompt', /SELF_VOICE_RULE/.test(b) && /RENDERED_CLAIM_RULE/.test(b));
  ok('   …and enforces it in code after the call', /collapseSelfVoice\(composed, speaker\)/.test(b));
  ok('ROOM_BRIEF_VERSION carries the law so every cached opening re-authors',
    ROOM_BRIEF_VERSION >= 12 && /THE VOICE COLLAPSES/.test(b));
}

// ── SQ4 · CLAIM ONLY WHAT RENDERS ───────────────────────────────────────────────────────────────
function sq4() {
  console.log('\nSQ4 · CLAIM ONLY WHAT RENDERS — a narration may claim only what renders beside it');
  const none = { hasPrepared: false, hasDecision: false, hasAsk: false };
  const a = enforceRenderedClaims('I drafted a reply below. The client is waiting.', none);
  ok('a draft claim with nothing prepared is dropped', a.text === 'The client is waiting.' && a.dropped.length === 1);
  const b = enforceRenderedClaims('I drafted a reply below.', none);
  ok('   …and when the claim WAS the whole position it degrades to the honest offer', b.text === OFFER_INSTEAD);
  const c = enforceRenderedClaims('A decision is laid out below.', none);
  ok('a decision claim with no decision card composes nothing rather than a lie', c.text === '' && c.dropped.length === 1);

  ok('the same sentence SURVIVES when the artifact really renders',
    enforceRenderedClaims('I drafted a reply below.', { ...none, hasPrepared: true }).dropped.length === 0);
  ok('   …and a decision claim survives a rendered decision card',
    enforceRenderedClaims('A decision is laid out below.', { ...none, hasDecision: true }).dropped.length === 0);
  ok('a decision claim is NOT satisfied by a mere prepared draft',
    enforceRenderedClaims('A decision is laid out below.', { ...none, hasPrepared: true }).dropped.length === 1);
  ok('prose that claims nothing about the page is never touched',
    enforceRenderedClaims('Nothing needs you on this today.', none).dropped.length === 0);

  // The facts must come from the PAGE, not from hope: the ask count is read AFTER the editor's
  // settle, and the prepared fact off the board's own prepared column.
  const b2 = src('lib/room/brief.ts');
  ok('the composer derives hasPrepared from the board\'s prepared column',
    /const hasPrepared = g\.board\.some\(\(b\) => b\.prepared\.length > 0\)/.test(b2));
  ok('   …and hasAsk from the asks that SURVIVED the editor',
    /hasAsk: liveAsks\.length > mooted/.test(b2));
  // ⟲ RE-POINTED (Sep 23, W3.5 room first paint): composeAndStore's return type is now
  // `Promise<RoomResponse | null>` (a caller-checkable degrade signal), so the empty-text guard
  // spells its refusal `return null;` rather than a bare `return;` — the law itself (a
  // fully-degraded brief never overwrites last-good) is unchanged; only the return shape moved.
  // ⟲ RE-POINTED (Sep 23, W8.4 THE ROOM SPEAKS TRUE): the degrade is now REMEMBERED for its sig
  // (refuseForSig stamps only `refusedSig` — last-good text untouched) before the same `return null`.
  ok('   …and a fully-degraded brief never overwrites last-good',
    /if \(!text\) \{ await refuseForSig\(client, userId, roomKey, sig\); return null; \}/.test(b2)
    && /\{ \.\.\.t, refusedSig: sig \}/.test(b2));
}

// ── SQ5 · THE SWEEP IS GUARDED ──────────────────────────────────────────────────────────────────
function sq5() {
  console.log('\nSQ5 · THE SWEEP — guarded, dry-run by default, archive-not-delete');
  const s = src('scripts/sweep-self-echoes.ts');
  ok('dry-run is the default; writing needs --apply', /const APPLY = process\.argv\.includes\('--apply'\)/.test(s) && /if \(APPLY\)/.test(s));
  ok('   …and it can be scoped to one user', /--user/.test(s));
  ok('reads are PAGED (the 1000-row cap would split a cluster)', /fetchAllRows/.test(s));
  ok('nothing is deleted — items are dismissed, commitments dismissed', !/\.delete\(\)/.test(s) && /status: 'dismissed'/.test(s));
  ok('every closure goes through the UNDOABLE door',
    /type: 'dismissed'/.test(s) && /entityType: 'inbox_item'/.test(s) && /type: 'commitment_dismissed'/.test(s));
  ok('the user\'s own re-type is never swept', /if \(r\.type_override\) continue;/.test(s));
  ok('it consults the ONE floor, never its own sender list',
    /from '\.\.\/lib\/inbox\/self-echo'/.test(s) && !s.includes(DOM));
  ok('A DELIVERY IS NOT A POINTER — the period guard and the standing-ask guard both stand',
    /namesDifferentPeriod/.test(s) && /standsAsAsk/.test(s));
}


// ── SQ6 · THE SEAT CONTRACT (Q4) ────────────────────────────────────────────────────────────────
function sq6() {
  console.log('\nSQ6 · THE SEAT CONTRACT — five seats for finished preparation, not five rankings');
  const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
    key: 'k', entityId: 'e', source: 'reply', whyNow: '', ...over,
  });

  // (a) REAL COUNTERPARTY — the Q1 floor's verdict, handed in. A pointer never takes a seat.
  const self = seatVerdict(row({ entityId: 'self', selfAuthored: true, prepared: 'draft' }));
  ok('a self-authored row never seats, however prepared it is', !self.seated && self.refusal === 'self');

  // (b) ALIVE — three-valued by contract: only a computed false unseats.
  ok('a row that failed proof-of-life never seats',
    !seatVerdict(row({ provedAlive: false })).seated);
  ok('   …a MISSING proof-of-life fact defaults to alive (the coordination contract)',
    aliveByContract(undefined) && aliveByContract(null) && seatVerdict(row({})).seated);
  ok('   …and the reader returns null for an absent stamp, false only for a stated one',
    provedAliveOf(null) === null && provedAliveOf({}) === null
    && provedAliveOf({ proof_of_life: 'quiet' }) === false
    && provedAliveOf({ proof_of_life: { alive: true } }) === true);

  // (c) PREPARED — never unseats; it changes what the row WEARS.
  const bare = seatVerdict(row({}));
  ok('a real, alive row with nothing staged still seats — wearing "needs shaping"',
    bare.seated && bare.needsShaping);
  ok('   …and a staged row does not wear it', !seatVerdict(row({ prepared: 'draft' })).needsShaping);

  // THE BUDGET + THE PREFERENCE, at the one choke.
  const rows: AttentionRow[] = [
    row({ key: 'a', entityId: 'a' }),                                   // alive, unstaged
    row({ key: 'b', entityId: 'b', prepared: 'draft' }),                // alive, staged
    row({ key: 'c', entityId: 'c', selfAuthored: true }),               // ourselves
    row({ key: 'd', entityId: 'd', provedAlive: false }),               // went quiet
  ];
  const r = rankAttention(rows, ATTENTION_BUDGET);
  ok('the refused rows are HELD, never dropped — nothing leaves the ledger\'s reach',
    r.served.length + r.held.length === rows.length && r.refused.length === 2);
  ok('   …and neither ourselves nor a dead row is served',
    !r.served.some((x) => x.entityId === 'c' || x.entityId === 'd'));
  ok('A PREPARED ROW OUTRANKS A NEEDS-SHAPING ROW at equal urgency',
    r.served[0].entityId === 'b' && r.served[1].entityId === 'a');
  ok('   …and urgency still wins across the preference (adjacency leads)',
    rankAttention([row({ key: 'x', entityId: 'x', prepared: 'draft' }),
      row({ key: 'y', entityId: 'y', calendarAdjacent: true })], 5).served[0].entityId === 'y');
  ok('the budget is still five and still cuts here',
    ATTENTION_BUDGET === 5
    && rankAttention(Array.from({ length: 9 }, (_, i) => row({ key: `n${i}`, entityId: `n${i}` }))).served.length === 5);

  // THE WORD IS THE MACHINE'S — declared once, spoken by the served clause, typed in no surface.
  ok('the seat word lives in the machine\'s vocabulary', SEAT_WORDS.needs_shaping === NEEDS_SHAPING_WORD);
  ok('   …and it is not a lifecycle word wearing a costume',
    !Object.values(STATE_WORDS).includes(NEEDS_SHAPING_WORD));
  ok('the served why-now wears it when nothing is staged',
    whyNowOf({ source: 'reply', needsShaping: true }).includes(NEEDS_SHAPING_WORD));
  ok('   …and never when a receipt was earned',
    !whyNowOf({ source: 'reply', needsShaping: false, prepared: 'draft' }).includes(NEEDS_SHAPING_WORD));
  const att = src('lib/home/attention.ts');
  ok('the attention layer reads the word, never types it',
    /from '@\/lib\/work\/machine'/.test(att)
    && (att.match(/'needs shaping'/g) ?? []).length === 0);
  const surfaces = ['components/home/home-view.tsx', 'components/home/item-rail.tsx', 'components/home/held-quiet.tsx'];
  ok('   …and no surface types it either',
    surfaces.every((f) => !src(f).includes('needs shaping')));

  // THE TESTS RUN AT THE ONE SERVING CHOKE — never in a client, never twice.
  const route = src('app/api/home/brief/route.ts');
  ok('the brief route runs the seat tests at the budget\'s own choke',
    /seatVerdict/.test(route) && /rankAttention\(ordered, ATTENTION_BUDGET\)/.test(route));
  ok('   …it reuses the Q1 floor for the counterparty test, never a second sender read',
    /itemIsSelfEcho/.test(route) && /self-echo/.test(route));
  ok('   …and reads proof-of-life through the one contract reader', /provedAliveOf/.test(route));
  ok('the contract is stated where it is consumed (a named optional field, alive by default)',
    /provedAlive\?: boolean \| null/.test(att) && /aliveByContract/.test(att));
}

// ── SQ7 · A DECISION SHOWS ITS OBJECT (Q5) ──────────────────────────────────────────────────────
function sq7() {
  console.log('\nSQ7 · A DECISION SHOWS ITS OBJECT — nothing asks for approval without the thing');
  const body = 'Shortlisted five candidates against the rubric, with the scores and the two rejections explained.';
  const brief = { id: 'b1', kind: 'deliverable', title: 'Which way?', content: body, decision: { options: [1, 2] } };
  const deliverable = { id: 'd1', kind: 'deliverable', title: 'The shortlist', content: body, by: 'A coworker' };

  const obj = resolveDecisionObject([brief, deliverable]);
  ok('the object resolves from the door\'s own prepared artifacts', obj?.id === 'd1' && obj?.title === 'The shortlist');
  ok('   …carrying its producer and a taste, never the whole document',
    obj?.by === 'A coworker' && !!obj?.preview && obj!.preview!.length <= 420);
  ok('THE DECISION BRIEF IS NEVER THE OBJECT — it is the reasoning about it',
    resolveDecisionObject([brief]) === null);
  ok('a send-shaped draft is the DEED, not the object under it',
    resolveDecisionObject([{ id: 'r', kind: 'reply_draft', content: body }]) === null);
  ok('a title with no body and no file is not an object to review',
    resolveDecisionObject([{ id: 'x', kind: 'deliverable', title: 'The shortlist', content: '' }]) === null);
  ok('   …but a staged FILE is', !!resolveDecisionObject([{ id: 'f', kind: 'deliverable', attachment: { filename: 'shortlist.pdf' } }]));
  ok('nothing resolves → null, and the honest sentence exists to be spoken',
    resolveDecisionObject([]) === null && resolveDecisionObject(null) === null
    && /nothing is attached to review/i.test(NO_DECISION_OBJECT_LINE));

  // THE STRUCTURAL HALF: approving sight-unseen is never the recommended path.
  ok('with no object, NOTHING may be recommended', !mayRecommend(null) && mayRecommend(resolveDecisionObject([deliverable])));
  // RE-POINTED (W3-C, Sep 22 — docs/component-map.md §2 item 7): the hand-drawn
  // components/work/decision-card.tsx became a KIT KIND behind ONE host. The three laws below are
  // unchanged; they are simply asserted at the seam that now owns each — the HOST resolves the
  // object and the recommendation rule, the KIT renders the head and the honest line.
  const card = src('components/home/decision-card.tsx');
  const kitCard = src('components/thread/thread-cards.tsx');
  ok('the ONE card renders the object as its head',
    /spec\.object\.title/.test(card) && /spec\.object\.preview/.test(card)
    && /\{card\.objectNode/.test(kitCard));
  ok('   …says so honestly when there is none',
    /NO_DECISION_OBJECT_LINE/.test(card) && /card\.quietLine/.test(kitCard));
  ok('   …and marks no option primary without it',
    /const recommends = mayRecommend\(spec\.object\);/.test(card)
    && /const rec = recommends && isRec\(o\.label, spec\.recommendation\);/.test(card)
    // the kit marks ONLY what the host handed it — it holds no recommendation rule of its own
    && !/mayRecommend\(/.test(kitCard));

  // BOTH MOUNTS: the deep-dive's own rail and the room's rail (the reported payload).
  const detail = src('components/home/item-detail.tsx');
  const rail = src('components/home/item-rail.tsx');
  const room = src('components/entities/entity-room.tsx');
  ok('the door resolves the object from the SAME prepared array its cards read',
    /resolveDecisionObject\(view\?\.prepared \?\? null\)/.test(detail));
  ok('   …it travels on the reported decision, so the room\'s rail mounts ask + object together',
    /object: DecisionObject \| null/.test(detail) && /\.\.\.focusDecision/.test(room));
  ok('   …and the rail hands it to the one card',
    /spec=\{decision\}/.test(rail) && /<DecisionCard/.test(rail));
  ok('the object\'s deed is REVIEW, through a door that already exists (no second renderer)',
    /onOpenObject: \(\) => openDrawerAt\('prepared'\)/.test(detail));
}

// ── SQ8 · A CTA REVIEWS WORK DONE (Q6) ──────────────────────────────────────────────────────────
function sq8() {
  console.log('\nSQ8 · A CTA REVIEWS WORK DONE — a primary button never commands work to start');
  const todo = { label: 'Confirm Sep 14 call status, send material, lock call time', ref: 'inbox:1' };

  const unstaged = enforceCtaLaw(todo, { targetPrepared: false });
  ok('an unstaged move is DEMOTED — never a primary action',
    unstaged.demoted && unstaged.move?.offer === true);
  ok('   …and it survives as the CoS\'s offer, in the first person, ending in the user\'s word',
    !!unstaged.offerText && /^I can /.test(unstaged.offerText!) && /say the word/i.test(unstaged.offerText!));
  const staged = enforceCtaLaw(todo, { targetPrepared: true });
  ok('a move whose object IS staged stands as the primary', !staged.demoted && !staged.move?.offer);
  ok('   …and a mounted card counts as staged (a move with no bound ref still has one object)',
    moveIsStaged({ targetPrepared: false, cardMounted: true }));
  ok('no move passes through as no CTA', enforceCtaLaw(null, { targetPrepared: true }).move === null);
  ok('the sayable form is a complete instruction, never a bare label',
    /^Prepare what's needed to /.test(shapingSay('Confirm the time')) && shapingSay('Confirm the time').length > 40);
  ok('the offer reads the move\'s own words back', shapingOffer('Confirm the time').includes('confirm the time'));

  // BOTH SEAMS: the composer's floor sits AFTER the model, and the pre-compose fallback is floored
  // at the render (it never passed a composer at all).
  const b = src('lib/room/brief.ts');
  ok('the composer carries the rule in the prompt',
    /A MOVE REVIEWS WORK DONE, IT NEVER COMMANDS WORK TO START/.test(b));
  ok('   …and the CODE FLOOR runs after the call, on the board\'s own prepared column',
    /enforceCtaLaw/.test(b) && /targetPrepared: \(entry\?\.prepared\.length \?\? 0\) > 0/.test(b)
    && b.indexOf('enforceCtaLaw') > b.indexOf('const composed = String(res.json?.brief'));
  ok('   …carried by ROOM_BRIEF_VERSION so every cached move re-authors',
    ROOM_BRIEF_VERSION >= 13 && /A CTA REVIEWS WORK DONE/.test(b));
  const rail = src('components/home/item-rail.tsx');
  ok('the room renders an offer move as a LINE, never a button',
    /resp\?\.move && !resp\.move\.offer/.test(rail) && /\{ctaOffer && <p/.test(rail));
  // ⟲ RE-POINTED (Sep 23, W3.5 room first paint, registry precedence #1): the pre-compose "Next: …"
  // fallback CTA this gate asserted a floor on is not merely re-shaped — it was RETIRED. The rail's
  // own comment names it: "THE PRE-COMPOSE FALLBACK (…) IS DEAD (W3.5 (a); registry precedence #1):
  // it never passed a composer, its target was the room itself, and it stood as an inert CTA under
  // the reader. The seat carries a composed move or none." A retired CTA needs no floor of its own
  // — the stronger form of the law is that it cannot render AT ALL, so `ent.nextMove` may still be
  // read as plain fallback ASK CONTEXT (never a CTA target) but `enforceCtaLaw`/`fallbackMove` must
  // not exist for it.
  ok('   …and the pre-compose "Next: …" CTA is RETIRED outright, not merely re-floored',
    !/fallbackMove/.test(rail)
    && !/enforceCtaLaw\(\{ label: `Next: /.test(rail)
    && /No pre-compose fallback card/.test(rail));
  ok('ONE implementation of the law — the surfaces import it, never restate it',
    /from '@\/lib\/room\/cta-law'/.test(rail) && /lib\/room\/cta-law/.test(b));
}

// ── SQ9 · THE GROUNDING SPEAKER (Q1's source half) ──────────────────────────────────────────────
async function sq9() {
  console.log('\nSQ9 · THE GROUNDING SPEAKER — a self-authored ask is first person AT THE SOURCE');
  ok('the speaker\'s own ask renders first person',
    /YOUR OWN ask/.test(askAttribution('Clara', 'Clara')) && !/Clara asks/.test(askAttribution('Clara', 'Clara')));
  ok('   …matched on the given name, as the seats are named',
    /YOUR OWN ask/.test(askAttribution('Clara Mendes', 'Clara')));
  ok('another coworker is still named normally', askAttribution('Max', 'Clara') === 'Max asks');
  ok('an unknown asker keeps the team voice', askAttribution(null, 'Clara') === 'the team asks');
  ok('no speaker in hand renders exactly as before', askAttribution('Clara', null) === 'Clara asks');

  const g = src('lib/room/grounding.ts');
  ok('the assembly TAKES the speaker (optional — every existing caller compiles unchanged)',
    /scope: RoomScope, opts: GroundingOptions = \{\}/.test(g) && /speaker\?: string \| null/.test(g));
  ok('   …and the asks section renders through the one attribution', /askAttribution\(a\.who, speaker\)/.test(g));
  ok('the responder hands its resolved seat to the grounding',
    /assembleRoomGrounding\(client, userId, \{ kind: 'entity', entityId \}, \{ speaker \}\)/.test(src('lib/room/brief.ts')));
  ok('the post-hoc collapse survives as the BELT, not the fix',
    /collapseSelfVoice\(composed, speaker\)/.test(src('lib/room/brief.ts')));

  // LIVE: a room carrying a self-authored ask must not render "<CoS name> asks" anywhere.
  const { data: rows } = await sb.from('room_turns')
    .select('user_id, room_key, author, component')
    .not('component', 'is', null).is('archived_at', null).limit(400);
  const selfAsk = ((rows ?? []) as any[]).find((r) => r?.author?.name
    && r?.component?.key === 'input_checklist' && (r.component?.state?.items ?? []).length);
  if (!selfAsk) { console.log('  · no live ask with a named author in this database — live half skipped'); return; }
  const { assembleRoomGrounding } = await import('../lib/room/grounding');
  const speaker = String(selfAsk.author.name);
  const page = await assembleRoomGrounding(sb as any, selfAsk.user_id as string,
    selfAsk.room_key.includes(':')
      ? { kind: 'item', itemKind: selfAsk.room_key.split(':')[0] === 'inbox' ? 'inbox' : 'commitment', itemId: selfAsk.room_key.split(':')[1] }
      : { kind: 'entity', entityId: selfAsk.room_key as string },
    { speaker });
  const asksBlock = (page.text.split('OPEN ASKS TO THE USER')[1] ?? '').split('\n\n')[0];
  ok(`live: the page never says "${speaker.split(' ')[0]} asks" in ${speaker.split(' ')[0]}'s own reading`,
    !asksBlock.includes(`${speaker} asks`), asksBlock.slice(0, 120));
}

// ── SQ10 · VERBS ON EVERY ROW (the missing deed rail) ───────────────────────────────────────────
// "held quiet is still a massive list, with no way of dismissing any, or mark done, as we had"
// (owner walk, Sep 18). The law: a surface that lists work offers the deck's OWN deeds, through the
// deck's OWN doors — never a second mutation path, never a verb a row cannot keep.
function sq10() {
  console.log('\nSQ10 · VERBS ON EVERY ROW — the deed rail, on the deck\'s own doors');
  const lens = src('components/home/held-quiet.tsx');
  const row = src('components/work/work-row.tsx');
  const home = src('components/home/home-view.tsx');

  ok('the ledger row mounts the ROW KIT, not a private cluster',
    /from '@\/components\/work\/work-row'/.test(lens)
    && /useRowActions\(item, \{/.test(lens)
    && /<RowControls item=\{item\} busy=\{busy\} done=\{done\} drop=\{drop\}/.test(lens)
    && /<RowHoverRail>/.test(lens));
  ok('   …so the rail speaks Done · Dismiss · the filing door, in words',
    /label="Done"/.test(row) && /label="Dismiss"/.test(row) && /label="Add to project"/.test(row));
  ok('   …and the row still opens, and still hands the thing back',
    /onClick=\{open\}/.test(lens) && /Bring forward/.test(lens));

  // EACH SOURCE ROUTES TO ITS OWN DOOR — asserted on the ONE implementation both surfaces share.
  ok('a mail row settles through the inbox doors',
    /fetch\(`\/api\/inbox\/\$\{item\.entityId\}\/\$\{kind\}`/.test(row)
    && /'complete' \| 'dismiss'/.test(row));
  ok('a commitment row settles through the commitments door',
    /fetch\(`\/api\/commitments\/\$\{id\}`, \{ method: 'PATCH'/.test(row)
    && /const isCommit = item\.source === 'commitment';/.test(row));
  // (RE-POINTED Sep 18: the Home now also hands the lens its WARM held mail rows, so the handed
  //  row's kind union widened past commitment|deal — the law is unchanged and the assertion is the
  //  same one: every row carries the kind whose door its verbs must reach.)
  ok('the ledger hands each row its OWN kind (mail members read as mail, deck rows keep theirs)',
    /source: 'reply', key: m\.itemId, entityId: m\.itemId/.test(lens)
    && /source: r\.source as DoSource/.test(lens)
    && /source: 'commitment' \| 'deal' \| 'reply' \| 'notice';/.test(lens)
    && /source: it\.source as DeckHeldRow\['source'\],/.test(home));
  ok('a deal wears NO verb it cannot keep (no per-row door exists for it)',
    /const actionable = item\.source !== 'deal';/.test(lens)
    && /readonly=\{!actionable\}/.test(lens));

  ok('NO NEW MUTATION ENDPOINT is named by the ledger',
    !/\/api\/items\/|\/api\/home\/dismiss|\/api\/deeds\/commit/.test(lens)
    // the only endpoints it names are the deed PREVIEW door and its own account
    && (lens.match(/fetch\('\/api\/[^']+'/g) ?? []).every((f) => /deeds\/prepare|home\/held/.test(f)));
  ok('the undo rides the EXISTING restore toast, and a restore re-reads the account',
    /showUndoToast\(\{ message, entityType, entityId, onUndo: \(\) => onRestored\?\.\(\) \}\)/.test(lens)
    && /from '@\/lib\/activity\/undo-toast'/.test(lens));
  ok('the deed is OPTIMISTIC — the row leaves before the server answers',
    /if \(removed\) return null;/.test(lens) && /exitCls\(exiting\)/.test(lens));

  // THE HOME'S WHISPERS KEPT THEIRS (the calm vocabulary: hover only, no colour until hover).
  ok('the Home\'s whisper rows still carry the same rail',
    /<RowHoverRail>\s*\n\s*<RowControls item=\{item\} busy=\{busy\} done=\{done\} drop=\{drop\} \/>/.test(home));
  ok('   …revealed on hover only, and never in colour at rest',
    /opacity-0 translate-x-1 transition-\[opacity,transform\][\s\S]{0,200}group-hover:opacity-100/.test(row)
    && /text-neutral-400 \$\{hoverTone\}/.test(row));
  ok('   …in the 11px control voice the calm page speaks',
    /text-\[11px\] font-medium leading-none/.test(row));
}

// ── SQ11 · THE FILL (2 rows must not read as emptiness — and must not read as TWO LISTS) ────────
function sq11() {
  console.log('\nSQ11 · THE FILL — one list, one door, served only, re-ranked nowhere');
  const home = src('components/home/home-view.tsx');

  ok('the fill reads the SERVED held-back list, in the server\'s own order',
    /\(b\?\.attention\?\.heldBack \?\? \[\]\)\.map\(\(id\) => itemByAtom\.get\(id\)\)/.test(home));
  ok('   …resolved against rows this brief ALREADY carries — no refetch of its own',
    (() => {
      const i = home.indexOf('const NEXT_UP_MAX');
      const seg = home.slice(i, i + 900);
      return i > 0 && !/fetch\(/.test(seg);
    })());
  ok('   …and re-ranked nowhere (no sort, no rank read, no urgency key in the fill)',
    (() => {
      const i = home.indexOf('const NEXT_UP_MAX');
      const seg = home.slice(i, i + 900);
      return i > 0 && !/\.sort\(|attentionRank|\.rank|overdue|dueDate/.test(seg);
    })());
  // THE CAP IS THE DENSITY LAW'S OWN NUMBER — the client reads it, it never invents a second one.
  ok('the fill runs to the calm module\'s own five, never past it',
    /const NEXT_UP_MAX = Math\.max\(0, CALM_MAX_WHISPERS - whispers\.length\);/.test(home)
    && /\.slice\(0, NEXT_UP_MAX\)/.test(home)
    && (home.match(/NEXT_UP_MAX/g) ?? []).length === 2);
  ok('   …and the client still expresses no budget of its own',
    !/ATTENTION_BUDGET/.test(home) && !/= 3;|= 5;/.test(home.slice(home.indexOf('const NEXT_UP_MAX'), home.indexOf('const NEXT_UP_MAX') + 200)));
  ok('   …and never repeats a row already seated above it',
    /\.filter\(\(i\) => !whisperKeys\.has\(i\.key\)\)/.test(home));

  // ONE LIST, NOT TWO (owner, Sep 18: "this split approach not sure looks good").
  ok('the fill rides the SAME list in the SAME grammar — one row component, one container',
    /const nextUp: Whisper\[\] = nextUpItems\.map\(\(i\) => toWhisper\(i\)\);/.test(home)
    && /nextUp\.map\(\(w\) => \(\s*\n\s*<WhisperLine/.test(home)
    && (home.match(/<WhisperLine/g) ?? []).length === 2);
  ok('   …with NO header, NO divider and NO section of its own between the seats and the fill',
    (() => {
      const a = home.indexOf('{whispers.map((w) => (');
      const b = home.indexOf('{nextUp.map((w) => (');
      const seg = home.slice(a, b);
      return a > 0 && b > a && !/<Header|<h2|border-t|uppercase|<section/.test(seg) && !/<CalmDoor/.test(seg);
    })());
  ok('the door line is the list\'s SINGLE entry, at its BOTTOM, with its words unchanged',
    (() => {
      const rows = home.indexOf('{nextUp.map(');
      const door = home.indexOf('<CalmDoor');
      return rows > 0 && door > rows
        && (home.match(/<CalmDoor\b/g) ?? []).length === 1
        && /When you're ready · \$\{waiting\} →/.test(home)
        && /handled quietly/.test(home);
    })());
  ok('the fallback is the door\'s OWN list, never a second client ranking',
    /: Array\.from\(restRows, \(r\) => r\.item\)/.test(home)
    // …and the wall it replaced stays gone: the door's list is never RE-RENDERED behind the fold.
    && !/restRows\.map\(/.test(home));
}

// ── SQ12 · THE GREETING STOPS AT THE GREETING (owner, Sep 18) ───────────────────────────────────
// A line under the greeting was asked for, built deterministically, walked live, and REMOVED ("the
// top clara line should be removed"). The gate asserts the ABSENCE on both sides — no composer, no
// render — so the next restoration has to be a decision rather than a drift. It is the Sep 13 law,
// re-earned against its own strongest counter-example: the honest version was not wanted either.
function sq12() {
  console.log('\nSQ12 · THE GREETING STOPS AT THE GREETING — no line under it, no composer for one');
  const home = src('components/home/home-view.tsx');
  const words = src('lib/home/held-words.ts');
  const calm = src('lib/home/calm.ts');

  ok('no line renders under the greeting',
    !/<ChiefLine|<CosLine|<CalmSentence/.test(home)
    && !/sentence=\{/.test(home));
  ok('   …and the greeting itself still stops at the date and the greeting',
    (() => {
      const i = home.indexOf('function CalmGreeting(');
      const seg = home.slice(i, home.indexOf('/** ONE WHISPERED LINE'));
      return i > 0 && /<h1 /.test(seg) && !/<p className="text-\[13px\]/.test(seg);
    })());
  ok('   …no face is mounted at that seat either',
    !/useCosSeat/.test(home) && !/<WorkerFace/.test(home));
  ok('the composer is DELETED, not parked — no corpse for the next reader to re-mount',
    !/homeLine|HomeLineFacts/.test(words) && !/homeLine/.test(home)
    && !/(export )?(function|const) (cosSentence|deriveCalmSentence|calmFactsFrom)\b/.test(calm));
  ok('   …and BOTH homes state why, so the removal is a decision on the record',
    /PROPOSED AND RETIRED THE SAME MORNING/.test(words)
    && /the top clara line should be removed/.test(home)
    && /THE CoS SENTENCE — RETIRED \(owner call, Sep 13\)/.test(calm));
  ok('the ledger\'s OWN sentences are untouched by the removal (a different seat, a different law)',
    /export function heldIntro\(/.test(words) && /export function heldReceipts\(/.test(words)
    && !/getAIClient|aiCall\(|aiCreate|fetch\(/.test(words));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q9 · THE TRIAGE DECK (docs/attention-plan.md PART III — owner, Sep 18: "tinder for the middle
// band"). Five gates, one per law the deck stands on.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── SQ13 · A SECOND RENDER, NEVER A SECOND DERIVATION ───────────────────────────────────────────
// "The deck is a MODE over the served Waiting band, never a new derivation: same rows, second
// render." A deck that fetched or re-ranked would be a second answer to "what is waiting", and the
// first time it disagreed with the ledger the account would be lying on one of the two screens.
function sq13() {
  console.log('\nSQ13 · THE DECK IS A SECOND RENDER — served rows, served order, no list of its own');
  const deck = src('components/triage/triage-deck.tsx');
  const lens = src('components/home/held-quiet.tsx');

  ok('the deck RECEIVES its rows — it holds no fetch for a list and no state for one',
    /rows: TriageRow\[\]/.test(deck)
    && !/\/api\/home\/held/.test(deck)
    && !/useHeldLedger|useEffect\([^)]*fetch/.test(deck));
  ok('   …and re-ranks nothing: no sort, no rank read, no urgency key anywhere in it',
    !/\.sort\(|attentionRank|rankAttention|\.filter\(\(r\) =>/.test(deck));
  // ⟲ RE-POINTED (W8.3 — ONE COUNT): the cursor walks the deck's OWN stack — the handed array,
  // merged append-only while the account is read and settled to it once complete (rows at and
  // behind the cursor never move). Same order, one cursor, one index.
  ok('   …it walks the array in the order it was handed (one cursor, one index)',
    /const row = stack\[cursor\] \?\? null;/.test(deck) && /setCursor\(\(c\) => c \+ 1\)/.test(deck)
    && /complete \? settleQueue\(stackRef\.current, rows, cursor\) : mergeQueue\(stackRef\.current, rows\)/.test(deck));
  ok('the lens hands the deck the SAME array it lists, built once',
    /rows=\{waitingRows\.map\(\(r\) => r\.triage\)\}/.test(lens)
    && (lens.match(/const waitingRows/g) ?? []).length === 1);
  ok('the card\'s own essentials are SERVED on the band row, not fetched per card',
    /from: string \| null;/.test(src('lib/home/attention.ts'))
    && /excerpt: string \| null;/.test(src('lib/home/attention.ts'))
    && /prepared: 'reply_draft'/.test(src('lib/home/attention.ts')));
  ok('   …and the excerpt rides THE ONE CLIPPER (boundary + the honest marker)',
    /clipForPrompt\(body, HELD_EXCERPT_CHARS\)/.test(src('lib/home/attention.ts'))
    && /from '@\/lib\/utils\/clip-for-prompt'/.test(src('lib/home/attention.ts')));
  // (RE-POINTED Sep 18, STRICTER: the warm stack opens before the ledger lands, so the day may come
  //  from the BRIEF as well — both are the server's own clock, and the deck still owns none.)
  ok('the deck owns no clock — its day is SERVED',
    /today: string;/.test(deck) && !/new Date\(\)\.toISOString/.test(deck)
    && /today: todayISO,/.test(src('lib/deeds/held-cache.ts'))
    && /today: todayStr/.test(src('app/api/home/brief/route.ts'))
    && /const deckDay = ledger\?\.today \?\? servedDay \?\? null;/.test(lens)
    && /const deckShown = deckMode && !!deckDay;/.test(lens));
}

// ── SQ14 · EVERY VERB IS AN EXISTING DOOR ───────────────────────────────────────────────────────
// The deck is fast. Speed is only safe when nothing fast can invent a mutation: each verb routes
// through the door that already owned it, which is also what keeps the outcome log, the activity
// ledger and the undo toast whole without one writer added here.
function sq14() {
  console.log('\nSQ14 · EVERY VERB ROUTES THROUGH A DOOR THAT ALREADY EXISTED');
  const deck = src('components/triage/triage-deck.tsx');
  const row = src('components/work/work-row.tsx');
  const later = src('app/api/items/later/route.ts');
  const judge = src('lib/work/judge.ts');

  // (RE-POINTED for Q9v2: ↓ NEVER is retired as an arrow — the archive deed is ← DISMISS, and the
  //  posture tail rides it. Same door, same hook, same undo; one fewer direction to hold.)
  ok('→ DONE and ← DISMISS are the ROW KIT\'s own deeds (the inbox / commitments doors)',
    /from '@\/components\/work\/work-row'/.test(deck)
    && /useRowActions\(row\.item, \{/.test(deck)
    && /fetch\(`\/api\/inbox\/\$\{item\.entityId\}\/\$\{kind\}`/.test(row));
  // RE-POINTED (Sep 21, STRICTER — the reply slot is parked by owner call): the item's own
  // conversation door went with it, so the deck now names TWO endpoints, both of them its own
  // verbs' (the park and the posture tail). The law is unchanged and the surface reaches less.
  ok('   …so the deck names NO mutation endpoint of its own but the two its verbs needed',
    (() => {
      const calls = deck.match(/fetch\('\/api\/[^']+'/g) ?? [];
      return calls.length === 2
        && calls.every((c) => /items\/later|postures\/from-item/.test(c))
        && !/fetch\('\/api\/items\/steer'/.test(deck);
    })());
  // RE-POINTED (Sep 19, THE OPENING CONTRACT clause 1): the THREAD read left this file — the same
  // tail now serves a decision's object, a room's opening and an ask, so the loader lives in
  // lib/inbox/thread-door.ts and the deck is one of its callers (two caches of one door are two
  // answers to one question). What the deck still fetches by template literal is the stored draft.
  // RE-POINTED (Sep 21, STRICTER): the stored-draft read went with the reply slot, so the deck
  // holds NO template-literal fetch at all — the tail reads through the ONE thread-door module and
  // nothing else in this file opens a door by string.
  ok('   …and it holds no template-literal fetch at all (the tail reads through the ONE thread-door module)',
    (deck.match(/fetch\(`\/api\/[^`]+`/g) ?? []).length === 0
    // ⟲ RE-POINTED (Sep 22, W3.6): the deck also reads a handed commitment's founding thread through
    // the SAME door (`loadThreadDoor`); the law is "the ONE door module", not an exact import list.
    && /import \{[^}]*\bloadThreadTail\b[^}]*\bpeekThreadDoor\b[^}]*\} from '@\/lib\/inbox\/thread-door'/.test(deck));
  ok('   …and the outcome fact still writes itself at the ONE resolver, unchanged',
    /logPreparedOutcome|logPendingOutcomes/.test(src('lib/tools/item-actions.ts')) // W3.2: the two-way writer
    && !/logPreparedOutcome|learning_signals/.test(deck) && !/learning_signals/.test(later));
  ok('Z undoes through the EXISTING restore, and the toast is the house toast',
    /restoreEntity\(/.test(deck) && /from '@\/lib\/activity\/restore'/.test(deck)
    && /showUndoToast\(\{ message, entityType, entityId/.test(deck));
  ok('   …and it never claims a reversal it did not perform (a keep / a park are not restore-shaped)',
    /if \(last\.undoable\) \{/.test(deck) && /fire\('later', false\)/.test(deck)
    && /fire\('keep', false\)/.test(deck));
  // Q9v2 · THE UNDO IS ALSO A PILL — the keyboard is not the only way back for a reader using a
  // mouse, and it exists ONLY while there is something to undo (never a dead affordance).
  ok('   …and Undo is a pill that appears only when there is something to undo',
    /const \[undoDepth, setUndoDepth\] = useState\(0\);/.test(deck)
    && /canUndo=\{undoDepth > 0\}/.test(deck)
    && /\{canUndo && \(/.test(deck));

  // ← LATER WRITES THE REVISIT SHAPE apply-verdict OWNS — one park mechanism, never a snooze store.
  ok('← LATER lands in THE REVISIT PARK (the judgment\'s own record), through the judge\'s own writer',
    /parkItem\(supabase, user\.id, input, \{ after \}\)/.test(later)
    && /export async function parkItem\(/.test(judge)
    && /await writeCache\(client, userId, input, sig, verdict\);/.test(judge)
    && /revisit: \{ after, by: 'user' \}/.test(judge));
  ok('   …and the ONE consequence module narrates and logs it, exactly as a judged park',
    /applyVerdictConsequences\(supabase, user\.id, input, parked\.verdict\)/.test(later)
    && /verdict\.work === 'none' && verdict\.revisit\?\.after && !verdict\.resolution/.test(src('lib/work/apply-verdict.ts')));
  // ONE STORE, asserted structurally rather than by word-hunting (all three files SAY "snooze" —
  // each one saying it does not have one). The park's only home is the judgment row: the LATER
  // route writes nothing of its own, and the judge's writer names exactly the judgment cache.
  // ⟲ RE-POINTED (Sep 23, W2.6 lib/store/item-plans.ts typed door): the raw `{ kind: 'judgment',
  // entity_id: ... }` object literal moved OUT of judge.ts and into the ONE typed door's
  // `upsertPlan`/`insertPlan` (`{ user_id, kind, entity_id: key, tasks }`, `lib/store/item-plans.ts`
  // — TABLE = 'item_plans', the single table every kind including 'judgment' writes through). The
  // law is unchanged — the park writer's only table is still the judgment cache — it's now proven
  // by judge.ts calling the door with the literal kind 'judgment', plus the door itself owning
  // exactly one table constant, rather than judge.ts spelling the row object itself.
  const itemPlansDoor = src('lib/store/item-plans.ts');
  ok('   …no second snooze store exists anywhere (one shape, one home)',
    !/from\('item_snoozes'\)|snoozed_until|kind: 'snooze'|'revisit_store'/.test(later + deck + judge)
    // the LATER route performs NO write of its own — it calls the two existing writers and nothing else
    && !/\.insert\(|\.upsert\(|\.update\(/.test(later)
    // …and the park writer calls the ONE typed door with the judgment kind, on its item's own key
    && /upsertPlan\(client, userId, 'judgment', `\$\{input\.kind\}:\$\{input\.id\}`/.test(judge)
    // …and that door owns exactly one table for every kind it stores (no second store to drift to)
    && /const TABLE = 'item_plans';/.test(itemPlansDoor)
    && (itemPlansDoor.match(/from\(TABLE\)/g) ?? []).length > 0
    && !/\.from\('item_plans_/.test(itemPlansDoor));
  ok('LATER ALWAYS RECORDS A DATE — a malformed, past or over-horizon day is refused in code',
    /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(after\)\) return \{ ok: false/.test(judge)
    && /if \(after <= todayStr\) return \{ ok: false/.test(judge)
    && /horizon\.setUTCFullYear/.test(judge));
  ok('   …in the USER\'s day, never the server\'s',
    /localNow\(await userTimezone\(client, userId\)\)\.dateStr/.test(judge.slice(judge.indexOf('export async function parkItem'))));

  // THE PARK RESURFACES — and says whose appointment it is.
  ok('a user park HOLDS until its date (their word outranks the judge), and expires on it',
    /prior\.revisit\.by === 'user' \|\| \(priorSig && nonDaySig\(priorSig\) === nonDaySig\(sig\)\)/.test(judge)
    && /prior\.revisit\.after > todayStr/.test(judge));
  // THE RESURFACING, EXERCISED rather than grepped: a hand-parked row is a plain judged-none, which
  // is `judged_quiet`, which is machinery, which is HANDLED — so without the park clause "show me
  // this on Thursday" would FILE the thing on Thursday. Both directions are asserted.
  const parkedFacts = (due: boolean) => ({
    item: { id: 'x', source_data: {} } as any, isEcho: false, judgedNone: true,
    judgedResolution: null, budgetOverflow: false,
    userParkedUntil: due ? '2020-01-01' : '2099-01-01', userParkDue: due,
  });
  ok('   …while the date is still ahead the row stays filed (that is what parking IS)',
    bandOf(classifyHeld(parkedFacts(false) as any), parkedFacts(false) as any) === 'handled');
  ok('   …and on that day it is LIFTED BACK INTO WAITING as a deck candidate',
    bandOf(classifyHeld(parkedFacts(true) as any), parkedFacts(true) as any) === 'waiting');
  ok('   …wearing the reader\'s own words',
    whyHeldOf(classifyHeld(parkedFacts(true) as any), parkedFacts(true) as any) === 'you asked to see this today');
  ok('   …read off the SAME judgments map the judged-none facts come from (no extra query)',
    /if \(v\.revisit\?\.by === 'user' && typeof v\.revisit\.after === 'string'\) userParked\.set/.test(src('lib/deeds/held-members.ts')));
}

// ── SQ15 · THE PREPARED WORK IS SHOWN, NEVER COMMITTED HERE ─────────────────────────────────────
// Q9 mounted the artifact's own renderer (EmailCard / InviteCard) so a draft could be sent inside
// the deck. Q9v2 replaced that with the reply slot: the draft rendered as its own words, read-only.
// RE-POINTED (Sep 21 — owner call: "remove 'Ask or tell Clara about this…' from the cards for
// now"): the slot is parked, so the deck now holds no composer, no draft body and no send door at
// all. The PREPARED FACT still reaches the reader — as the card's own chip, which is information
// rather than an affordance — and the words live one ⏎ away in the room, the only surface that can
// send them. STRICTLY STRONGER again than the gate it replaces: the surface has no text input on a
// card either, so a mis-keyed arrow cannot reach one.
function sq15() {
  console.log('\nSQ15 · THE PREPARED WORK IS SHOWN, NEVER COMMITTED — one commit door, and it is the room');
  const deck = src('components/triage/triage-deck.tsx');
  ok('the deck mounts NO send-capable renderer at all (the v1 artifact cards are gone)',
    !/EmailCard|InviteCard|components\/home\/email-card|components\/home\/invite-card/.test(deck));
  ok('   …and names NO send door of its own',
    !/send-reply|send-coworker-email|\/api\/items\/execute|\/api\/invites\/send/.test(deck));
  ok('   …the prepared fact reaches the reader as a CHIP, and no draft body is read at all',
    /const chip = row\.preparedWord \?\?/.test(deck)
    && /'draft ready'/.test(deck)
    && !/function loadDraft\(/.test(deck)
    && !/_draftCache/.test(deck)
    && !/inbox\/\$\{itemId\}\/draft/.test(deck));
  ok('   …and the deck mounts NO composer: no input, no textarea, no editable node',
    !/<textarea/.test(deck) && !/contentEditable=/.test(deck)
    && !/function ReplySlot\(/.test(deck) && !/<ReplySlot/.test(deck)
    // The one <input> the frame keeps is L's DATE field — a when for the park, never a message.
    && (deck.match(/<input/g) ?? []).length === 1
    && /<input type="date" value=\{customDate\}/.test(deck));
  ok('THE INVARIANT: the ONLY door out of the deck is the item\'s own room',
    (() => {
      // openRoom is the row kit's `open` — the item's address. Nothing else navigates or promotes.
      const promotions = deck.match(/openRoom\(\)/g) ?? [];
      return promotions.length >= 1
        && !/router\.push|setView\(|heldWaiting|attention\.heldBack/.test(deck);
    })());
}

// ── SQ16 · THE POSTURE TAIL REUSES THE ONE ELIGIBILITY TABLE ────────────────────────────────────
// Q9v2: "where a standing rule is expressible the 'always?' posture tail rides HERE, contextually —
// Never as a separate arrow is retired". A set of one is still a set: the same table decides, the
// same composer writes, THE ONE WRITER stores. Where nothing is keepable, nothing is offered.
function sq16() {
  console.log('\nSQ16 · THE POSTURE TAIL — on DISMISS, one eligibility table, one composer, one writer');
  const deck = src('components/triage/triage-deck.tsx');
  const words = src('lib/triage/words.ts');
  const lens = src('components/home/held-quiet.tsx');
  const route = src('app/api/postures/from-item/route.ts');

  // THE ARROW IS GONE EVERYWHERE — verb table, keyboard map, component, lens. A retired verb that
  // survives in one of the four is exactly the drift this suite exists to catch.
  ok('↓ NEVER is retired from the verb table, the keyboard map and both surfaces',
    !TRIAGE_VERBS.some((v) => (v.verb as string) === 'never')
    && !Object.values(TRIAGE_KEYS).some((v) => (v as string) === 'never')
    && !/ArrowDown/.test(words) && !/'never'|doNever|verbOf\('never'\)/.test(deck)
    && !/'never'/.test(lens));
  ok('   …and the tail now rides the DISMISS deed, one beat before the stack advances',
    /const doDismiss = useCallback\(\(\) => \{/.test(deck)
    && /drop\(\);\s*\n\s*onCount\('dismiss'\);/.test(deck)
    && /if \(offer\.ok\) \{ setPendingPosture\(true\); return; \}/.test(deck));

  ok('the card asks the POSTURES MODULE whether a tail is keepable — it holds no table',
    /import \{ postureFromDeed \} from '@\/lib\/postures\/from-deed'/.test(deck)
    && /postureFromDeed\(\{ verb: 'archive', classKey: row\.cls \}\)/.test(deck)
    && !/POSTURE_ELIGIBILITY|ai_match|CLASS_MATCH/.test(deck));
  ok('   …and offers NOTHING where it is not (no fake "always")',
    /\{pendingPosture && offer\.ok && !postureNote/.test(deck));
  ok('the route re-derives the class server-side — the client never names it',
    /const derived = await deriveHeld\(supabase, user\.id/.test(route)
    && /classifyHeld\(facts\)/.test(route)
    && !/body\.cls|body\.classKey/.test(route));
  ok('   …and lands through THE ONE WRITER, with its validation floor',
    /createPosture\(supabase, user\.id, offer\.offer\.sentence, \{/.test(route)
    && /primitives: offer\.offer\.primitives/.test(route));
  ok('   …zero AI on the path (the deed-tail precedent)',
    !/getAIClient|aiCall|aiCreate/.test(route) && !/getAIClient|aiCall|aiCreate/.test(deck));
  ok('the eligibility table itself is unchanged — a class that refuses a class deed refuses this one',
    /cc_watch: \{\s*offered: false/.test(src('lib/postures/from-deed.ts'))
    && /quieter_threads: \{\s*offered: false/.test(src('lib/postures/from-deed.ts')));
}

// ── SQ18 · THE DOOR OPENS AT ONCE ───────────────────────────────────────────────────────────────
// Owner, live (Sep 18): clicking "When you're ready" left "Reading the account…" over a bare list
// for 20–30 seconds — the deck gated on a whole-pool derivation. The house doctrine (hydrate
// last-known → paint → background refresh; skeleton only on `loading && !cached`) had never reached
// this lens. Four laws, each asserted where it lives.
function sq18() {
  console.log('\nSQ18 · THE DOOR OPENS AT ONCE — the instant deck, the extending queue, the warm ledger');
  const lens = src('components/home/held-quiet.tsx');
  const deck = src('components/triage/triage-deck.tsx');
  const route = src('app/api/home/held/route.ts');
  const queue = src('lib/triage/queue.ts');

  // ── 1 · THE DECK MOUNTS ON WHAT THE CLIENT ALREADY HOLDS ──────────────────────────────────────
  // The rows the Home hands over (its own held-back commitments and deals) and a warm account are
  // enough for card one. Nothing about rendering the deck may wait on the ledger fetch.
  ok('the deck mounts from the rows in hand — the shape alone decides, the fetch does not',
    /const deckMode = shape === 'deck' && !exited;/.test(lens)
    && /const deckShown = deckMode && !!deckDay;/.test(lens));
  ok('   …so the band renders before the account does, in the DECK\'s chrome',
    /\(waitingRows\.length > 0 \|\| \(deckMode && !ledger\)\)/.test(lens)
    && /deckMode && !deckShown \?/.test(lens));
  ok('   …and the bare list never flashes underneath it while loading',
    (() => {
      // The list branch is reachable only when the reader is NOT in deck mode: every render of the
      // ledger rows sits behind `deckShown`'s own else, never beside a loading state.
      const i = lens.indexOf('{deckMode && !deckShown ?');
      // (W5b: the list renders FOLDS — same who + subject under one row — through HeldFoldRows.)
      const j = lens.indexOf('<HeldFoldRows key={g.key}');
      return i > 0 && j > i && /\) : deckShown \? \(/.test(lens);
    })());
  ok('   …the header speaks no total before it has one',
    /\{bands \? `\$\{bands\.waiting\.title\} · \$\{waitingCount\}` : 'Waiting'\}/.test(lens));

  // ── 2 · THE QUEUE-MERGE LAW, asserted on the pure function that owns it ───────────────────────
  {
    type R = { id: string };
    const a: R[] = [{ id: 'a' }, { id: 'b' }];
    const extended = mergeQueue(a, [{ id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'd' }]);
    ok('the merge APPENDS what is new and never reorders what is already in the stack',
      extended.map((r) => r.id).join(',') === 'a,b,c,d');
    ok('   …a row already in the stack is never duplicated',
      mergeQueue(a, [{ id: 'a' }, { id: 'b' }]).length === 2);
    ok('   …nothing new returns the SAME array (a settled stack never re-renders)',
      mergeQueue(a, [{ id: 'a' }]) === a);
    ok('   …an empty stack takes the arrival whole, in its served order',
      mergeQueue([] as R[], [{ id: 'x' }, { id: 'y' }]).map((r) => r.id).join(',') === 'x,y');
    // THE COUNTER NEVER STATES A TOTAL IT DOES NOT HAVE.
    ok('a complete stack counts; a partial one says what it HAS and admits the rest',
      queueCount(12, true) === '12 left'
      && queueCount(12, false) === '12 here · counting the rest…'
      && !/left/.test(queueCount(12, false)));
    ok('   …and the deck is handed that completeness rather than assuming it',
      /complete = true/.test(deck) && /queueCount\(left, complete\)/.test(deck)
      && /complete=\{deckComplete\}/.test(lens)
      && /const deckComplete = !!ledger && !ledger\.warm;/.test(lens));
    ok('   …a stack still being counted never ends in a session receipt',
      /if \(!row && !complete\)/.test(deck)
      && deck.indexOf('if (!row && !complete)') < deck.indexOf('triageEnd(tallyNow())'));
  }
  ok('the merge stays pure — no React, no fetch, no clock, so this law is testable at all',
    !/react|useState|fetch\(|new Date\(/i.test(queue)
    && /export function mergeQueue</.test(queue) && /export function queueCount\(/.test(queue));
  // ⟲ RE-POINTED (W8.3 — ONE COUNT): the ONE queue moved into the deck (the cursor's owner); the
  // lens hands it the warm opening while the account is read and the counted rows once it lands.
  ok('   …and ONE queue exists, extended in place only while the deck is live (the deck owns it)',
    /const waitingRows = deckMode \? \(deckComplete \? listRows : incomingRows\) : listRows;/.test(lens)
    && !/queueRef/.test(lens) && /const stackRef = useRef<TriageRow\[\]>\(\[\]\);/.test(src('components/triage/triage-deck.tsx'))
    && (lens.match(/const waitingRows/g) ?? []).length === 1);

  // ── 3 · THE SERVER CACHE — the timeline_cache precedent, exactly ──────────────────────────────
  // (RE-POINTED Sep 18: the kind, the shape and the WRITER moved into lib/deeds/held-cache.ts so the
  //  brief's primer stores a byte-identical account — one payload, one writer, two callers. The
  //  route still owns the read, the age and the convergence, which is what these two assert.)
  const cacheMod = src('lib/deeds/held-cache.ts');
  ok('the ledger route serves a STORED last-good and converges in after()',
    /'held_cache'/.test(cacheMod) && /kind: HELD_CACHE_KIND/.test(cacheMod)
    && /\.eq\('kind', HELD_CACHE_KIND\)/.test(route)
    && /after\(deriveAndStore\)/.test(route)
    && /import \{ NextResponse, after, type NextRequest \} from 'next\/server';/.test(route));
  ok('   …the stored payload is STAMPED and its age decides (never served blind)',
    /updated_at: new Date\(\)\.toISOString\(\)/.test(cacheMod)
    && /Date\.now\(\) - Date\.parse\(cached\.updated_at as string\)/.test(route)
    && /age >= HELD_CACHE_MS/.test(route) && /age < HELD_CACHE_MAX_MS/.test(route));
  ok('   …a last-good never speaks a day it did not compute against',
    /\{ \.\.\.cachedPayload, today: todayISO/.test(route));
  ok('   …and only the DEFAULT shape is cached (a paged read derives for itself)',
    /const cacheable = offset === 0 && perClass === HELD_MEMBERS_PER_CLASS;/.test(route)
    && /if \(!cacheable\) return NextResponse\.json\(await derive\(\)\);/.test(route));
  // THE BUST IS THE DEED'S OWN: every mutation this lens reaches ends in `reload`, which asks for a
  // fresh read — derived synchronously, and it REPLACES the stored payload rather than dropping it.
  ok('the reader\'s own deed busts the cache and restores it in one read',
    /if \(fresh\) return NextResponse\.json\(await deriveAndStore\(\)\);/.test(route)
    && /url\.searchParams\.get\('fresh'\) === '1'/.test(route)
    && /reload: \(\) => void load\(true\)/.test(lens)
    && /fetch\(`\/api\/home\/held\$\{fresh \? '\?fresh=1' : ''\}`/.test(lens));

  // ── 4 · THE CLIENT HYDRATE — the stamped cache, with freshness DEMANDED ───────────────────────
  ok('the ledger hydrates from the stamped local cache and demands freshness',
    /loadLS<HeldLedger>\(HELD_LS_KEY, \{ maxAgeMs: HELD_LS_MAX_AGE_MS \}\)/.test(lens)
    && /const HELD_LS_MAX_AGE_MS = 3 \* 60_000;/.test(lens)
    && /saveLS\(HELD_LS_KEY, next\)/.test(lens));
  ok('   …in an EFFECT, never a useState initializer (the hydration law)',
    !/useState<HeldLedger \| null>\(\(\) =>/.test(lens)
    && /useEffect\(\(\) => \{\n\s+if \(!enabled\) return;/.test(lens));
  ok('   …a warm paint is MARKED as warm, so nothing downstream mistakes it for this visit\'s read',
    /\{ \.\.\.warm, warm: true \}/.test(lens) && /warm\?: boolean;/.test(lens));
  ok('   …and it never overwrites a live account with a cached one',
    /setLedger\(\(cur\) => \(cur \? cur : \{ \.\.\.warm, warm: true \}\)\)/.test(lens));
}

// ── SQ17 · THE KEYBOARD, THE RECEIPT, AND THE READER WHO ASKED FOR STILLNESS ────────────────────
function sq17() {
  console.log('\nSQ17 · THE KEYBOARD MAP, THE PURE RECEIPT, THE REDUCED MOTION');
  const deck = src('components/triage/triage-deck.tsx');
  const words = src('lib/triage/words.ts');

  // THE MAP IS ONE TABLE — the component reads it rather than typing arrows into a switch.
  // (RE-POINTED to Q9v2's OWN ROW, exactly as the owner wrote it: ← dismiss · → done · ↑ keep ·
  //  ⏎ open · L dated-later · Space = keep · Z · Esc.)
  const V2_ROW: Record<string, string> = {
    ArrowLeft: 'dismiss', ArrowRight: 'done', ArrowUp: 'keep', Enter: 'open',
    l: 'later', L: 'later', ' ': 'keep', z: 'undo', Z: 'undo', Escape: 'exit',
  };
  for (const [key, verb] of Object.entries(V2_ROW)) {
    ok(`   ${key === ' ' ? 'space' : key} → ${verb}`, TRIAGE_KEYS[key] === verb);
  }
  ok('   …and the table holds NOTHING BUT that row (no retired binding survives)',
    Object.keys(TRIAGE_KEYS).length === Object.keys(V2_ROW).length
    && Object.keys(TRIAGE_KEYS).every((k) => TRIAGE_KEYS[k] === V2_ROW[k]));
  ok('the component reads THE TABLE, never its own arrow strings',
    /const verb = TRIAGE_KEYS\[e\.key\];/.test(deck)
    && (deck.match(/'Arrow(Right|Left|Up|Down)'/g) ?? []).length === 0);
  // RE-POINTED (Sep 21): the reply slot is parked, so the only field either guard protects is L's
  // date input. The law is unchanged — a key typed into a field is not a verdict.
  ok('   …and typing inside the frame\'s own field never steers the deck (L\'s date)',
    (deck.match(/isContentEditable \|\| \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(t\.tagName\)/g) ?? []).length === 2
    && /onKeyDown=\{\(e\) => \{ e\.stopPropagation\(\);/.test(deck));
  ok('   …the host owns Esc and Z; the station owns the five verbs',
    /if \(!verb \|\| verb === 'undo' \|\| verb === 'exit'\) return;/.test(deck));

  // THE RECEIPT IS PURE-COMPOSED — counts in, sentence out, nothing else.
  ok('the receipt module reaches no model, no fetch and no clock',
    !/getAIClient|aiCall|aiCreate|fetch\(|Date\.now\(\)|new Date\(\)\s*[;)]/.test(words));
  ok('   …and it claims only what the counts back',
    triageReceipt({ done: 14, dismiss: 5, later: 1, postures: 3, elapsedMs: 4 * 60_000 })
      === 'Cleared 20 in 4 minutes — 14 done, 5 dismissed, 1 set aside, 3 postures taught.');
  ok('   …a clause with a zero count never appears',
    !/dismissed/.test(triageReceipt({ done: 2, dismiss: 0, later: 0, postures: 0, elapsedMs: 60_000 }))
    && !/set aside/.test(triageReceipt({ done: 2, dismiss: 0, later: 0, postures: 0, elapsedMs: 60_000 })));
  ok('   …and an empty session gets no congratulation at all',
    triageReceipt({ done: 0, dismiss: 0, later: 0, postures: 0, elapsedMs: 90_000 }) === '');
  // A KEEP CLEARS NOTHING, so a session of nothing but keeps has nothing to report — the row is
  // exactly where it was, and a receipt claiming otherwise would be the congratulation nobody earned.
  ok('   …a session of pure KEEPs reports nothing (a keep moves no row)',
    triageReceipt({ done: 0, dismiss: 0, later: 0, postures: 0, elapsedMs: 120_000 }) === '');

  // THE WHENS ARE DATES, computed from a day handed in.
  ok('the whens are real dates, composed from the served day',
    laterOptions('2026-09-18').map((o) => `${o.id}:${o.after}`).join('|')
      === 'tomorrow:2026-09-19|next_week:2026-09-21');
  ok('   …and "next week" on a Monday is a week out, never today',
    laterOptions('2026-09-21')[1].after === '2026-09-28');

  // THE READER WHO ASKED FOR STILLNESS gets it — on a surface you hold a key down on, this matters.
  ok('every transition the deck runs is motion-reduce guarded',
    /motion-reduce:transition-none motion-reduce:transform-none/.test(deck)
    && (deck.match(/transition-all duration-200/g) ?? []).length
       === (deck.match(/motion-reduce:transition-none/g) ?? []).length);

  // THE ENTRY AND THE TOGGLE.
  const lens = src('components/home/held-quiet.tsx');
  // ⟲ RE-POINTED (W15.3 — ONE DECISION PER SCREEN): the rule moved to lib/triage/view-shape.ts and
  // got STRICTER — the Home's door ALWAYS opens the deck; the persisted list choice ("View all") is
  // honoured only when the address names the lens. Full gates: scripts/smoke-decision-card.ts D1.
  ok('the door opens INTO the deck by default, and the list is a persisted choice',
    /initialWaitingShape\(\{ fromHome, stored: loadLS<WaitingShape>\(VIEW_KEY\) \}\)/.test(lens)
    && initialWaitingShape({ fromHome: true, stored: 'list' }) === 'deck'
    && initialWaitingShape({ fromHome: false, stored: 'list' }) === 'list'
    && initialWaitingShape({ fromHome: false, stored: null }) === 'deck'
    && /saveLS\(VIEW_KEY, s\)/.test(lens) && /TRIAGE_VIEW_ALL/.test(lens));
  ok('   …the shape is read in an EFFECT, never a useState initializer (the hydration law)',
    /useEffect\(\(\) => \{ setShape\(loadShape\(fromHome\)\); \}, \[\]\);/.test(lens)
    && !/useState<WaitingShape>\(loadShape/.test(lens));
  // RE-POINTED (Sep 21 — CLOSE RETURNS WHERE YOU CAME FROM): the exit now consults the RECORDED
  // ORIGIN first (Home-opened → the Home), and only then ends the session in place. The law this
  // gate has always held is unchanged and still asserted: closing NEVER demotes the deck for next
  // time — the shape is a stored choice and the exit writes to no store.
  ok('   …walking away ends the session without demoting the deck for next time',
    /if \(closeReturnsHome\) \{ onBack\(\); return; \}/.test(lens)
    && /setReceipt\(r \|\| null\); setExited\(true\);/.test(lens)
    && !/saveLS\([^)]*exited|saveLS\(VIEW_KEY, 'list'\)/.test(lens));
  ok('Watched and Handled stay list-shaped below either view',
    (() => {
      const i = lens.indexOf('BAND 2 · WATCHED');
      const j = lens.indexOf('BAND 3 · HANDLED');
      return i > 0 && j > i && !/deckShown|TriageDeck/.test(lens.slice(i));
    })());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ── SQ20 · THE ROW LEADS WITH WHO ───────────────────────────────────────────────────────────────
// Owner walk, Sep 18: the Home showed "M Condomínios Lda — Review and respond…" beside "Send AI
// agent platform presentation deck with implementations — needs shaping". Same page, two grammars,
// and the second lost the person the work is FOR. The lane an obligation arrived through is not a
// reason to drop whom you owe.
//
// THE LAW: one grammar for every lane — a whisper leads with WHO when the row has a known
// counterparty and its own title does not already name them. Two floors keep it honest, and both
// are gated here: NEVER INVENT A WHO (the who is SERVED; a source label — "from <the meeting>" —
// is where work came from, not who waits on it) and NEVER SAY THE NAME TWICE.
function sq20() {
  console.log('\nSQ20 · THE ROW LEADS WITH WHO — one grammar for every lane, never an invented who');
  const {
    whisperSentence, whisperWho, servedWho,
  } = require('../lib/home/calm') as typeof import('../lib/home/calm');
  const row = (o: Partial<DoItem>): DoItem =>
    ({ source: 'commitment', key: `k${Math.random()}`, entityId: 'e', href: '', ask: '', ...o });

  // 1 · THE LANE WITH NO SENDER NOW LEADS WITH ITS COUNTERPARTY.
  ok('a commitment with a counterparty LEADS WITH IT, like a mail row leads with its sender',
    whisperSentence(row({ counterparty: 'Northwind', ask: 'Send the presentation deck' }))
      === 'Northwind — Send the presentation deck');
  ok('   …and the mail lane is untouched — the sender still leads',
    whisperSentence(row({ source: 'reply', primary: 'Acme Lda', ask: 'Review and respond' }))
      === 'Acme Lda — Review and respond');

  // 2 · NEVER SAY THE NAME TWICE — a title that already names them takes no prefix.
  ok('a title that already names them gets NO prefix',
    whisperSentence(row({ counterparty: 'Northwind', ask: 'Send Northwind the signed contract' }))
      === 'Send Northwind the signed contract');
  ok('   …the test is DISTINCTIVE, not literal — a corporate form word is not identity',
    whisperWho(row({ counterparty: 'Northwind Lda' }), 'Send northwind the deck') === null
    // …and "Lda" alone can never suppress a lead: it carries no identity at all
    && whisperWho(row({ counterparty: 'Northwind Lda' }), 'Send the Lda paperwork') === 'Northwind Lda');

  // 3 · NEVER INVENT A WHO.
  ok('no counterparty → the title stands alone, exactly as before',
    whisperSentence(row({ ask: 'Draft the Q3 summary' })) === 'Draft the Q3 summary');
  ok('   …and a SOURCE LABEL is refused — where work came from is not who waits on it',
    whisperWho(row({ counterparty: 'from the Monday standup' }), 'Send the deck') === null
    && servedWho(row({ counterparty: 'from the Monday standup' })) === null
    && whisperSentence(row({ counterparty: 'from the Monday standup', ask: 'Send the deck' }))
      === 'Send the deck');

  // 4 · ONE READING, EVERY SURFACE. The ledger's `who` and the whisper's lead are the same served
  //     fact, resolved by the same function — never a per-renderer re-derivation.
  const home = src('components/home/home-view.tsx');
  // ⟲ RE-POINTED (Sep 22, W3.6): the handed row now reads the who ONCE into a local (the card's
  // title composer needs it too — `cardFacts`), then serves that same value onto the row. Still one
  // reading through `servedWho`, no second derivation; only the literal moved.
  ok('the ledger prints the SAME served who (one reading, no second derivation)',
    (/who: servedWho\(it\),/.test(home) || (/const who = servedWho\(it\);/.test(home) && /\n\s+who,\n/.test(home)))
    && /servedWho/.test(home.slice(0, home.indexOf('\n\n', home.indexOf("from '@/lib/home/calm'")))));
  ok('   …and the who is SERVED onto the row, never guessed in the renderer',
    /counterparty: c\.counterparty \?\? null/.test(home)
    && /counterparty\?: string \| null;/.test(src('lib/home/agenda.ts')));
  ok('the composer stays PURE — no fetch, no AI, no Date on the who path',
    (() => {
      const calm = src('lib/home/calm.ts');
      const seg = calm.slice(calm.indexOf('export function servedWho('), calm.indexOf('export function toWhisper('));
      return !/fetch\(|aiCall|getAIClient|Date\./.test(seg);
    })());
}

// ── SQ19 · THE DECK, RESHAPED (Q9v2) ────────────────────────────────────────────────────────────
// The owner's afternoon walk: "hard to follow, empty real estate; this [reference] seemed more
// simple." Three structural laws, each asserted where it lives.
//   1 · THE FRAME OWNS THE VERBS, THE CARD OWNS THE CONTENT.
//   2 · TRUE FOCUS — the deck takes the room; the prose folds, reachable, and returns on Close.
//   3 · THE CARD IS THE THING ITSELF — the thread's tail through the EXISTING door, lazily, cached,
//       clipped by the one clipper. (The reply slot it used to end on is PARKED by owner call,
//       Sep 21 — SQ15 carries that law now, strictly stronger: no composer in the surface at all.)
//   AMENDED Sep 21 · THE VERBS SIT BELOW THE CARD (owner: "CTA buttons should be below?"). The
//       frame still owns every verb — only the seat moved — so the ordering is asserted by the
//       INDEX of each block's own marker, and the card area keeps a floor so the pills do not
//       bounce from card to card.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function sq19() {
  console.log('\nSQ19 · Q9v2 — THE FRAME OWNS THE VERBS, THE CARD OWNS THE THING ITSELF');
  const deck = src('components/triage/triage-deck.tsx');
  const words = src('lib/triage/words.ts');
  const lens = src('components/home/held-quiet.tsx');

  // THE CARD'S OWN SOURCE, sliced out so "no verb inside the card" is a fact about the component
  // rather than a hope about the file. Everything from `function TriageCard(` to the next top-level
  // function is the card; the reply slot is its own component beneath it, also verb-free.
  // RE-POINTED (Sep 21): the card now ends where the STATION begins — the reply slot that used to
  // sit between them is parked, so there is no third component in the file to slice out.
  const cardStart = deck.indexOf('function TriageCard(');
  const cardEnd = deck.indexOf('function TriageStation(');
  const card = cardStart > 0 && cardEnd > cardStart ? deck.slice(cardStart, cardEnd) : '';

  // ── 1 · FRAME OWNS VERBS ──────────────────────────────────────────────────────────────────────
  ok('the card exists as its own component and renders NOTHING verb-shaped',
    !!card
    && !/TRIAGE_VERBS|verbOf\(|PrimaryPill|QuietPill|useRowActions|TRIAGE_KEYS/.test(card)
    && !/onClick=\{do(Done|Dismiss|Keep)\}|done\(\)|drop\(\)/.test(card));
  ok('   …and holds no deed door at all (the two it could reach are READS)',
    !/api\/items\/later|api\/postures\/from-item|api\/inbox\/\$\{[^}]+\}\/(complete|dismiss)/.test(card));
  ok('the two clearing verbs are LARGE PILLS, rendered from the table\'s rank',
    /const primary = verbsOfRank\('primary'\);/.test(deck)
    && /\{primary\.map\(\(v\) => \(/.test(deck)
    && /min-h-\[44px\] flex-1/.test(deck)
    && verbsOfRank('primary').map((v) => v.verb).join(',') === 'dismiss,done');
  ok('   …with Keep and Open quiet beside them, and Later demoted to a chip',
    verbsOfRank('quiet').map((v) => v.verb).join(',') === 'keep,open'
    && verbsOfRank('chip').map((v) => v.verb).join(',') === 'later'
    && /<QuietPill v=\{verbOf\('keep'\)\}/.test(deck)
    && /<QuietPill v=\{verbOf\('open'\)\}/.test(deck)
    && /<QuietPill v=\{verbOf\('later'\)\}/.test(deck));
  ok('   …and no label, key or rank is typed in the component (the table owns them)',
    !/>Dismiss<\/span>/.test(deck) && !/>Done<\/span>/.test(deck) && !/>Keep<\/span>/.test(deck)
    && /\{v\.label\}/.test(deck) && /\{v\.key\}/.test(deck));
  // RE-POINTED (Sep 21) — THE VERBS SIT BELOW THE CARD. The law that survives is the one that
  // always mattered: the verbs belong to the FRAME and they do not move when the card does. Only
  // their seat changed, so the ordering assertion inverts and gains the card area's own floor.
  ok('   …and they sit BELOW the card, in the frame\'s own row (card first, then the verbs)',
    deck.indexOf('THE STACK, PEEKING') < deck.indexOf('THE PILL BAR — BELOW THE CARD')
    && deck.indexOf('<TriageCard row={row} />') < deck.indexOf('{primary.map((v) => ('));
  // ⟲ RE-POINTED (W15.3 — ONE DECISION PER SCREEN): the floor became a FIXED HEIGHT. A floor let a
  // tall card, or evidence landing late, push the pills down; the card is now one height
  // (DECISION_CARD_H) that scrolls inside, and the pills sit in a pinned fixed-height slot.
  ok('   …the pill bar does not move when the card does (only the card wears the exit class, and the card has one fixed height)',
    /exiting \? `opacity-0 \$\{CARD_EXIT\[exiting\]\}` : 'opacity-100'/.test(deck)
    && !/CARD_MIN_H/.test(deck)
    && /<div className=\{CARD_AREA\}>/.test(deck)
    && /<DecisionActionsSlot>/.test(deck)
    && /^h-\[clamp\(/.test(DECISION_CARD_H) && /^h-\[\d+px\]$/.test(DECISION_ACTIONS_H));
  ok('   …and the stack still READS as a stack beneath it (both shoulders survive the move)',
    (deck.match(/rounded-b-2xl border border-t-0/g) ?? []).length === 2
    && /\{under && \(/.test(deck));

  // L IS THE PARK DOOR, and the park is still the one record.
  ok('L opens the dated park — the same door, demoted to a key and a chip',
    TRIAGE_KEYS['l'] === 'later' && TRIAGE_KEYS['L'] === 'later'
    && /else if \(verb === 'later'\) setLaterOpen/.test(deck)
    && /fetch\('\/api\/items\/later'/.test(deck)
    && !/ArrowLeft.*later/.test(words));

  // ── 2 · TRUE FOCUS ────────────────────────────────────────────────────────────────────────────
  ok('entering the deck takes the room — the title, the intro and the band header collapse',
    /const focus = deckShown;/.test(lens)
    && /\{!focus && \(\s*\n\s*<>/.test(lens)
    && /max-w-\[640px\]/.test(lens));
  ok('   …and the rest of the account stays REACHABLE, never unmounted',
    /\{focus && \(\s*\n\s*<button onClick=\{\(\) => setRestOpen/.test(lens)
    && /focus && !restOpen \? 'grid-rows-\[0fr\] opacity-0' : 'grid-rows-\[1fr\] opacity-100'/.test(lens));
  ok('   …it returns whole on Close (the fold is keyed to the deck, stored nowhere)',
    /const \[restOpen, setRestOpen\] = useState\(false\);/.test(lens)
    && !/saveLS\([^)]*restOpen/.test(lens));
  ok('the header in focus mode is ONE line — Close · the band · what is left · view as list',
    /<span>\{TRIAGE_EXIT_LABEL\}<\/span>/.test(deck)
    && /When you&rsquo;re ready/.test(deck)
    && /\{queueCount\(left, complete\)\}/.test(deck)
    && /onViewAsList && \(/.test(deck)
    && /onViewAsList=\{\(\) => chooseShape\('list'\)\}/.test(lens));
  ok('THE READER WHO ASKED FOR STILLNESS gets the layout and no fade',
    (lens.match(/grid transition-all duration-200 ease-out motion-reduce:transition-none/g) ?? []).length >= 1
    && (deck.match(/transition-all duration-200/g) ?? []).length
       === (deck.match(/motion-reduce:transition-none/g) ?? []).length);

  // ── 3 · THE CARD IS THE THING ITSELF ──────────────────────────────────────────────────────────
  // ⟲ RE-POINTED (Sep 22, W3.6 · DECK CARDS WITH CONTEXT): the avatar read `row.who ?? row.title`,
  // so a who-less card wore the first letter of its TITLE ("S" for "Schedule…") — an invented
  // initial. The law this assertion always meant is the one below it: the initial is the WHO's own
  // letter, never an invented one — so a who-less card now wears the neutral glyph.
  ok('the card\'s top row is avatar + counterparty + source word + the contextual chip',
    /initialOf\(row\.who\)/.test(card) && !/initialOf\(row\.who \?\? row\.title\)/.test(card)
    && /TRIAGE_SOURCE_WORD\[row\.item\.source\] \?\? null/.test(card)
    && /const chip = row\.preparedWord \?\?/.test(card));
  ok('   …and the initial is the counterparty\'s own first letter, never an invented one',
    initialOf('acme lda') === 'A' && initialOf('') === '·' && initialOf(null) === '·');

  // THE TAIL — one existing door, lazy, cached, shared in flight, prefetched exactly one ahead.
  // RE-POINTED (Sep 19): the door is read through lib/inbox/thread-door.ts now — ONE loader shared
  // with the room's object card. The law is unchanged (the EXISTING door, mail rows only).
  ok('the thread tail comes through THE EXISTING thread door, and only for a mail row',
    /fetch\(`\/api\/inbox\/\$\{itemId\}\/thread`\)/.test(src('lib/inbox/thread-door.ts'))
    && /const loadTail = \(itemId: string\): Promise<TriageMessage\[\]> => loadThreadTail\(itemId\);/.test(deck)
    && /TRIAGE_THREADED\.includes\(row\.item\.source\)/.test(deck)
    && /export const TRIAGE_THREADED: readonly string\[\] = \['reply', 'notice'\];/.test(words));
  ok('   …read LAZILY, on the card in hand',
    /useEffect\(\(\) => \{\s*\n\s*if \(!threaded\) \{ setTail\(null\); return; \}/.test(deck));
  // ⟲ RE-POINTED (Sep 23, W3.7 room speed — "ONE READ, TWO SHAPES"): the door now caches the RAW
  // payload (`_raw`/`_rawFlight`) and derives the narrowed `ThreadDoorData` from it, because the
  // deep-dive's room needs the whole payload the object card doesn't — a second `/thread` fetch on
  // the same item was the bug this wave closed. The bare `_flight: Map<…, Promise<ThreadDoorData>>`
  // is gone; the in-flight share now guards the raw fetch (`_rawFlight`), and `_cache` (still typed
  // `ThreadDoorData`) is filled as a side effect once the raw promise resolves. The law — cached,
  // in-flight shared, one loader — is unchanged; only which promise is shared moved.
  ok('   …CACHED for the session, and an in-flight read is shared rather than repeated (in the ONE loader, so the deck\'s warm IS the room\'s first paint)',
    (() => {
      const door = src('lib/inbox/thread-door.ts');
      return /const _cache = new Map<string, ThreadDoorData>\(\);/.test(door)
        && /const _rawFlight = new Map<string, Promise<ThreadRawPayload \| null>>\(\);/.test(door)
        && /const had = _cache\.get\(itemId\);\s*\n\s*if \(had\) return Promise\.resolve\(had\);/.test(door)
        && !/_tailCache|_tailFlight/.test(deck);
    })());
  ok('   …and the NEXT card is read while this one is, one ahead and no further',
    // ⟲ RE-POINTED (W8.3): one ahead in the deck's own stack.
    /const next = stack\[cursor \+ 1\] \?\? null;/.test(deck)
    && /if \(next && TRIAGE_THREADED\.includes\(next\.item\.source\)\) void loadTail\(next\.id\);/.test(deck)
    && !/rows\.slice\(cursor.*\)\.forEach|rows\.map\(\(r\) => loadTail/.test(deck));
  // THE EXCERPT-HONESTY LAW REACHES THE CARD: a clip ends at a boundary and SAYS it was ours.
  {
    const long = `${'word '.repeat(300)}end.`;
    const tail = threadTail([
      { id: 'a', fromName: 'Acme', body: 'first', receivedAt: null, isFromUser: false },
      { id: 'b', from: 'sam@acme.test', body: long, receivedAt: null, isFromUser: false },
      { id: 'c', body: 'mine', isFromUser: true },
    ]);
    ok('the tail is the LAST ≤2 messages, oldest→newest as served',
      tail.length === TRIAGE_TAIL_MESSAGES && tail.map((m) => m.id).join(',') === 'b,c');
    ok('   …each author-named from the message itself ("You" for the user\'s own)',
      tail[0].author === 'sam@acme.test' && tail[1].author === 'You');
    // ⟲ RE-POINTED (W11.3 — THE MARKER NEVER RENDERS): a card body is a DISPLAY clip.
    ok('   …and every body clipped for display — "…", never the prompt marker',
      tail[0].body.endsWith('…') && !tail[0].body.includes(EXCERPT_MARK) && tail[0].body.length <= TRIAGE_MESSAGE_CHARS + 2);
    // The card reads each message's OWN words — the quoted chain beneath belongs to the messages
    // above it. (`topMessageOf`'s own conservative floor stands: a near-empty top keeps the full
    // text, because a judge — or a reader — with more context beats one with none.)
    {
      const own = 'Thanks — that works, and I have signed the addendum this morning.';
      ok('   …a message quoting its own history contributes its OWN words, not the chain',
        threadTail([{ id: 'x', body: `${own}\n\nOn Mon, Sam wrote:\n> the whole negotiation` }])[0].body === own);
    }
    ok('   …and a message with no words at all is dropped, never rendered empty',
      threadTail([{ id: 'x', body: '   ', snippet: '' }]).length === 0);
    ok('the tail is PURE — no fetch, no clock, no React (which is why this is testable at all)',
      /export function threadTail\(/.test(words)
      && !/fetch\(|useState|new Date\(/.test(words.slice(words.indexOf('export function threadTail'), words.indexOf('export function initialOf'))));
  }

  // THE REPLY SLOT IS PARKED (owner call, Sep 21). RE-POINTED, STRICTLY STRONGER: where the gate
  // used to prove the slot could only SPEAK, it now proves the surface has no slot to speak with —
  // no composer, no steer door, no draft body. The card's chip carries the prepared fact, the room
  // carries the words, and the parked table stays honest for the day it is reinstated.
  ok('the deck mounts NO reply slot at all — no composer, no steer door, no draft preview',
    !/function ReplySlot\(|<ReplySlot/.test(deck)
    && !/items\/steer/.test(deck)
    && !/TRIAGE_STEER_KIND/.test(deck)
    && !/ready to send|Ask or tell/.test(deck));
  ok('   …and the card ends on the prepared CHIP, which is information and not an affordance',
    !!card && /const chip = row\.preparedWord \?\?/.test(card)
    && !/<input|<textarea|onSubmit|placeholder=/.test(card));
  ok('   …the reinstatement\'s ONE table survives in the pure half, marked parked',
    /PARKED \(owner call, Sep 21/.test(words)
    && TRIAGE_STEER_KIND['deal'] === undefined
    && TRIAGE_STEER_KIND['reply'] === 'email' && TRIAGE_STEER_KIND['commitment'] === 'commitment');
  ok('   …and the deck writes NO room turn of its own (the room key is resolved server-side)',
    !/\/api\/room\/turns/.test(deck));
}

// ── SQ21 · THE OPENING CONTRACT — THE PROSE DISCIPLINE ──────────────────────────────────────────
// docs/threads-plan.md, clauses 2+3 (the owner's Sep 19 walk). Four findings, four laws, each
// stated in the prompt AND enforced by a net: say it once · point at nothing you cannot show ·
// name a person once per sentence · carry one move.
function sq21() {
  console.log('\nSQ21 · THE OPENING CONTRACT — one fact once, no dangling pointer, one name, one move');
  const b = src('lib/room/brief.ts');

  // 1 · SAY IT ONCE — the echo dies, the first statement lives, a new fact is never touched.
  const restated = dropRestatements(
    'You owe your CV, profile and training offerings. Your CV, profile and training offerings are '
    + 'still outstanding. He runs the workshop in October.', GENERIC_WORK_WORDS);
  ok('a sentence that restates an earlier one is dropped', restated.dropped.length === 1
    && /You owe your CV/.test(restated.text) && /workshop in October/.test(restated.text));
  ok('   …and the FIRST statement of the fact is the one that survives',
    restated.text.indexOf('You owe your CV') === 0);
  ok('   …a paragraph that says three different things is untouched',
    dropRestatements('The call is Friday. He asked for the deck. Nothing else is owed.',
      GENERIC_WORK_WORDS).dropped.length === 0);
  ok('   …and a single sentence can never be dropped',
    dropRestatements('You owe the CV and the profile and the training offerings.', GENERIC_WORK_WORDS).dropped.length === 0);

  // 2 · NO DANGLING POINTER — phrase-level, never the sentence, and only when unsupported.
  const dangle = stripDanglingRefs('You owe your CV, profile, and training offerings before then.');
  ok('"before then" with no antecedent is stripped, and the sentence keeps everything it knows',
    dangle.dropped.length === 1 && dangle.text === 'You owe your CV, profile, and training offerings.');
  ok('   …the same pointer SURVIVES when the text states the time it points at',
    stripDanglingRefs('The call is Friday. You owe the CV before then.').dropped.length === 0);
  ok('   …and a pointer can never satisfy itself',
    stripDanglingRefs('You owe it before then.').dropped.length === 1);
  ok('prose with no pointer at all is returned untouched',
    stripDanglingRefs('Nothing needs you on this today.').dropped.length === 0);

  // 3 · ONE NAME PER SENTENCE — the live find, exactly.
  ok('the counterparty is introduced once; the second mention is a pronoun',
    nameOncePerSentence("Sam is asking you to decide whether to engage with Sam's collaboration proposal.", ['Sam'])
      === 'Sam is asking you to decide whether to engage with their collaboration proposal.');
  ok('   …the count is PER SENTENCE — the next sentence may introduce them again',
    nameOncePerSentence('Reply to Sam. Sam sent the deck to Sam yesterday.', ['Sam Mendes'])
      === 'Reply to Sam. Sam sent the deck to them yesterday.');
  ok('   …a second mention in SUBJECT position is left alone rather than mangled',
    /Sam sent the deck/.test(nameOncePerSentence('Reply to Sam. Sam sent the deck to Sam yesterday.', ['Sam Mendes'])));
  ok('   …and with no people to dedupe the text is returned as composed',
    nameOncePerSentence('Sam and Sam again.', [null, '']) === 'Sam and Sam again.');

  // 4 · THE PROMPT CARRIES ALL FOUR, and the composer runs the nets.
  ok('the composer states the prose laws in the prompt',
    /NO_RESTATEMENT_RULE/.test(b) && /REFERENCE_RULE/.test(b) && /ONE_MOVE_RULE/.test(b));
  ok('   …and enforces them in code after the call, on the text the claims floor already corrected',
    /dropRestatements\(claimed\.text, GW\)/.test(b) && /stripDanglingRefs\(once\.text\)/.test(b)
    && /nameOncePerSentence\(refs\.text, g\.board\.map\(\(b\) => b\.who\)\)/.test(b));
  ok('   …the names it dedupes are the BOARD\'s own counterparties, never guessed',
    !/nameOncePerSentence\([^)]*\[['"]/.test(b));

  // 5 · THE ABSENCE IS A FACT — the claims floor's missing half (a claim with nothing below).
  ok('with nothing to render, the prompt SAYS SO rather than staying silent',
    /NOTHING RENDERS BENEATH YOUR BRIEF/.test(b) && /You may NOT `\s*\n?\s*\+ `write that anything is "below"|You may NOT /.test(b));
  ok('   …and prepared work is listed among the components the composer may point at',
    /PREPARED WORK, rendered as its own card/.test(b) && /const preparedRows = g\.board\.filter/.test(b));

  // 6 · THE THIRD-PERSON REFUSAL — the belt behind the conservative collapse.
  // ⟲ RE-POINTED (Sep 23, W3.5 room first paint): same shape move as SQ4's "fully-degraded brief"
  // gate — the refusal now returns the explicit `null` of `Promise<RoomResponse | null>`.
  // ⟲ RE-POINTED (Sep 23, W8.4 THE ROOM SPEAKS TRUE): the refusal's name test moved to the pure
  // `narratesSpeakerInThirdPerson` (a name inside a longer proper name is someone else) and the
  // refusal is remembered for its sig before the same `return null` (smoke-room-voice owns both).
  ok('a composition still narrating the speaker by name is REFUSED to last-good, never served',
    /refused a composition that narrates the speaker in the third person/.test(b)
    && /if \(narratesSpeakerInThirdPerson\(voiced, speaker, knownPeople\)\) \{/.test(b)
    && /await refuseForSig\(client, userId, roomKey, sig\);\n    return null;\n  \}\n  const claimed = enforceRenderedClaims/.test(b));

  // 7 · THE VERSION IS A FLOOR, NOT A PIN (the pin trap: an exact match breaks on the next bump).
  ok('ROOM_BRIEF_VERSION carries the contract so every cached opening re-authors',
    ROOM_BRIEF_VERSION >= 14 && /THE OPENING CONTRACT, clauses 2\+3/.test(b));
}

async function main() {
  sq1();
  sq3();
  sq4();
  sq5();
  sq6();
  sq7();
  sq8();
  await sq9();
  sq10();
  sq11();
  sq12();
  sq13();
  sq14();
  sq15();
  sq16();
  sq17();
  sq18();
  sq19();
  sq20();
  sq21();
  const probe = await resolveProbeUser(sb);
  await sq2('the probe host', probe);
  const { data: profs } = await sb.from('profiles').select('id').limit(500);
  const ref = (profs ?? []).map((p) => p.id as string).find((id) => id.startsWith(REFERENCE_PREFIX));
  if (ref) await sq2('the reference account (read-only)', ref);
  else console.log('\nSQ2 · reference account not present in this database — skipped');

  console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-quality: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
