/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — TRUTH OF PREPARED CONTENT (stabilization W5a — docs/stabilization-plan.md;
 * invariants 8 A CLAIM RENDERS · 14 TIME TRUTH · 7 EVIDENCE SETTLES reaching the room).
 *
 * ZERO-AI, ZERO-DB, deterministic. Four findings from the owner's Sep 23 walk, each a class
 * (+ F · W5c, the reload after W5a: a hidden artifact must be REPLACED, never spoken, never a
 * hollow card — the lanes' freshness guards, the board digest, the transcript, the judge, the moot
 * predicate and the card mounts):
 *   A · a proposed slot outside the item's STATED WINDOW (and the label that claimed otherwise)
 *   B · prepared words that CLAIM AN UNDONE DEED ("I've finished… here's the updated…")
 *   C · the header word vs the brief — one claim (the false pack no longer drives ready_to_review)
 *   D · the room brief IGNORING EVIDENCE — the board carries LATER EVIDENCE (held meetings, sent mail)
 * Source floors on every seam + pure tests of the floors. Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-prepared-truth.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  completionClaimIn, claimsUndoneWork, inviteOutsideStatedWindow, slotInPast, windowOfItemText,
  COMPLETION_HONESTY_RULE, PROPOSAL_ANNOTATION, confineInviteToStatedWindow,
} from '../lib/prepare/truth';
import { poolRowsToArtifacts, stampTruth, isLiveArtifact, commitmentTruthFacts, badgeOf, leadKindOf, nonLiveKindsOf, withdrawnReasonOf } from '../lib/prepare/read';
import { preparedWordsOf } from '../lib/room/grounding';
import { boardDigestOf, boardLivenessMark } from '../lib/room/brief';
import { namesOurArtifact, askIsMoot } from '../lib/room/ask-mootness';
import { anchorOf } from '../lib/room/item-anchor';
import { deriveState } from '../lib/work/machine';
import { pickFreeSlots, proposeFreeSlots } from '../lib/prepare/free-slots';
import { inviteCardOf } from '../lib/prepare/invite-card';
import { evidenceLinesOf, BOARD_EVIDENCE_RULE } from '../lib/room/grounding';
import { matchEvidence } from '../lib/work/evidence-nominator';
import { calendarEventOf } from '../lib/evidence/sources';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ═══ A · THE STATED WINDOW ═══
console.log('\nA · a proposal honors the stated window and the clock');
{
  const text = 'Schedule meeting with Sam — September 30 or October 1';
  const anchor = '2026-09-18T10:00:00Z';
  gate('A1 the ONE window parser reads the item\'s own words', JSON.stringify(windowOfItemText(text, anchor)) .includes('"start":"2026-09-30","end":"2026-10-01"'));
  gate('A2 a Sep 23 proposal is OUTSIDE the stated window; Sep 30 / Oct 1 are inside; no window → no claim',
    inviteOutsideStatedWindow({ startISO: '2026-09-23T08:00:00Z', timezone: 'Europe/Lisbon' }, text, anchor) === true
    && inviteOutsideStatedWindow({ startISO: '2026-09-30T09:00:00Z', timezone: 'Europe/Lisbon' }, text, anchor) === false
    && inviteOutsideStatedWindow({ startISO: '2026-09-23T08:00:00Z' }, 'Schedule a call with Sam', anchor) === false);
  const nowMs = Date.parse('2026-09-22T15:00:00Z');
  const slots = pickFreeSlots({ todayStr: '2026-09-21', tz: 'UTC', busy: [], count: 3, nowMs });
  gate('A3 pickFreeSlots never proposes a slot behind the clock', slots.length === 3 && slots.every((s) => Date.parse(s.startISO) > nowMs) && slotInPast('2026-09-22T10:00:00Z', nowMs));
  const fake = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) }) } as never;
  const p = proposeFreeSlots(fake, 'u', { tz: 'UTC', todayStr: '2026-09-23', fromDayStr: '2026-09-30', toDayStr: '2026-10-01', count: 3 });
  const closed = proposeFreeSlots(fake, 'u', { tz: 'UTC', todayStr: '2026-09-23', fromDayStr: '2026-09-15', toDayStr: '2026-09-16', count: 3 });
  // (async gates resolve below)
  const pass_ = src('lib/prepare/pass.ts');
  gate('A4 the pass\'s calendar fallback is CONFINED to the stated window (the ONE confinement returns it; fromDayStr/toDayStr) and stamps proposedFrom',
    /const statedWin = confineInviteToStatedWindow\(invite, \{ narrow: w\.title, wide: ctx\.text \}, windowAnchor\);/.test(pass_)
    && /\.\.\.\(statedWin \? \{ fromDayStr: statedWin\.start, toDayStr: statedWin\.end \} : \{\}\)/.test(pass_)
    && /invite\.proposedFrom = statedWin \? 'stated_window' : 'calendar';/.test(pass_));
  const truthSrc = src('lib/prepare/truth.ts');
  gate('A5 THE ONE CONFINEMENT drops a PAST or OUT-OF-WINDOW slot before any card can render it — and BOTH builders run it (the pass lane + the card\'s on-demand build)',
    /export function confineInviteToStatedWindow\(/.test(truthSrc)
    && /if \(invite\.startISO && \(slotInPast\(invite\.startISO, now\) \|\| outside\(invite\.startISO\)\)\) \{\s*invite\.startISO = '';\s*invite\.endISO = '';\s*invite\.proposed = false;/.test(truthSrc)
    && /confineInviteToStatedWindow\(invite, \{ narrow, wide: ctx\.text \}, anchor\);/.test(src('lib/home/prepare-action.ts')));
  const card = src('lib/prepare/invite-card.ts');
  gate('A6 THE LABEL IS A VERIFICATION CLAIM: "inside what they stated" renders ONLY from proposedFrom === \'stated_window\'; calendar says "free on your calendar"; unstamped claims nothing',
    /if \(from === 'stated_window'\) return 'our proposal — inside what they stated';/.test(card)
    && /if \(from === 'calendar'\) return 'our proposal — free on your calendar';/.test(card)
    && /annotation: inv\.proposed \? proposalAnnotationOf\(inv\.proposedFrom\) : 'filled in above'/.test(card)
    && !/inv\.proposed \? 'our proposal — inside what they stated'/.test(card)
    && PROPOSAL_ANNOTATION.unknown === 'our proposal');
  const base = { title: 'Sync', startISO: '2026-10-01T09:00:00Z', endISO: '2026-10-01T09:30:00Z', attendees: [] as string[], timezone: 'UTC', proposed: true };
  gate('A7 pure: the card mapper words the annotation from provenance only',
    inviteCardOf(base).options[0].annotation === 'our proposal'
    && inviteCardOf({ ...base, proposedFrom: 'calendar' }).options[0].annotation === 'our proposal — free on your calendar'
    && inviteCardOf({ ...base, proposedFrom: 'stated_window' }).options[0].annotation === 'our proposal — inside what they stated');
  gate('A8 the provenance rides the whole seam: PreparedCalendarInvite · the stored-artifact serve · the reader\'s invite payload · the card host',
    /proposedFrom\?: ProposedFrom;/.test(src('lib/home/prepare-action.ts'))
    && /stored\.proposedFrom === 'stated_window' \|\| stored\.proposedFrom === 'calendar'/.test(src('lib/home/prepare-action.ts'))
    && /proposedFrom: inv\.proposedFrom/.test(src('lib/prepare/read.ts'))
    && /setProposedFrom\(inv\.proposedFrom\)/.test(src('components/home/invite-card.tsx'))
    && /timezone, proposed, proposedFrom,/.test(src('components/home/invite-card.tsx')));
  const fs = src('lib/prepare/free-slots.ts');
  gate('A9 free-slots: a window opening in the past clamps to tomorrow, a closed window proposes nothing, a slot ≤ now is skipped',
    /const fromDayStr = opts\.fromDayStr && opts\.fromDayStr < tomorrow \? tomorrow : opts\.fromDayStr;/.test(fs)
    && /if \(opts\.toDayStr && opts\.toDayStr < tomorrow\) return \[\];/.test(fs)
    && /if \(start <= nowMs\) continue;/.test(fs));
  void Promise.all([p, closed]).then(([inWin, cl]) => {
    gate('A10 async: proposeFreeSlots confines to the window and refuses a closed one',
      inWin.length > 0 && inWin.every((s) => s.startISO.slice(0, 10) >= '2026-09-30' && s.startISO.slice(0, 10) <= '2026-10-01') && cl.length === 0);
    finish();
  });
}

// ═══ B · THE COMPLETION FLOOR ═══
console.log('\nB · prepared words never claim an undone deed');
{
  const live = "I've finished the group redistribution. Here's the updated allocation breakdown. Everything is balanced now.";
  gate('B1 the live class trips the narrow net (EN) — and PT/DE/FR equivalents',
    !!completionClaimIn(live) && !!completionClaimIn('Já enviei o relatório.') && !!completionClaimIn('Anbei die Unterlagen.') && !!completionClaimIn("J'ai terminé la répartition."));
  gate('B2 status, futures, negations and questions stay silent (fail-safe)',
    completionClaimIn('I have not finished the redistribution yet — I need the scope first.') === null
    && completionClaimIn('I will send the updated breakdown once we agree the scope.') === null
    && completionClaimIn('Could you confirm which groups are in scope?') === null
    && completionClaimIn("Je n'ai pas envoyé le rapport.") === null);
  gate('B3 the floor speaks only with its facts: open + nothing staged',
    !!claimsUndoneWork(live, { obligationOpen: true, staged: false })
    && claimsUndoneWork(live, { obligationOpen: false, staged: false }) === null
    && claimsUndoneWork(live, { obligationOpen: true, staged: true }) === null);
  const ev = src('lib/prepare/evaluate.ts');
  gate('B4 the evaluator carries the deterministic floor BEFORE the AI review (obligationOpen + staged facts; revise with the one objection)',
    // ⟲ RE-POINTED (W12.1 · EVERY DRAFT PASSES THE SAME TRUTH): the evaluator's floors are the ONE
    // vet (lib/prepare/truth vetDraft — completion first, with the same facts), whose objection is
    // `completionObjection` (behaviour held in smoke-compose-truth A).
    /import \{ vetDraft \} from '@\/lib\/prepare\/truth';/.test(ev)
    && /obligationOpen\?: boolean;/.test(ev) && /staged\?: boolean;/.test(ev)
    && /const failed = vetDraft\(args\.content, \{\s*obligationOpen: args\.obligationOpen === true, staged: args\.staged === true,/.test(ev)
    && /if \(failed\) return \{ verdict: 'revise', objection: failed\.objection \};/.test(ev)
    && ev.indexOf('vetDraft(args.content') < ev.indexOf('await aiCall'));
  const pp = src('lib/prepare/paste-pack.ts');
  gate('B5 the paste pack producer: the rule + the FACTS ride the prompt; a tripped pack regenerates ONCE and then REFUSES (nothing stored)',
    /COMPLETION_HONESTY_RULE/.test(pp) && /this obligation is STILL OPEN/.test(pp)
    && /const claim = claimsUndoneWork\(body, \{ obligationOpen: args\.userOwes, staged: false \}\);/.test(pp)
    && /body = await draft\(completionObjection\(claim\)\);/.test(pp)
    && /return \{ status: 'failed' \};\s*\}\s*\}/.test(pp));
  const dr = src('lib/inbox/draft-reply.ts');
  gate('B6 the drafters (reply + the owed-direction nudge) carry the ONE completion rule',
    /import \{ COMPLETION_HONESTY_RULE \} from '@\/lib\/prepare\/truth';/.test(dr)
    && (dr.match(/\$\{COMPLETION_HONESTY_RULE\}/g) ?? []).length >= 2
    && /NEVER claim that work is finished/.test(COMPLETION_HONESTY_RULE));
  const rd = src('lib/prepare/read.ts');
  gate('B7 THE ONE READER derives falseClaim + outsideWindow and its live predicate honors both (single AND batched readers stamp)',
    // ⟲ RE-POINTED (W7.3): + `misaddressed` (TRUE ADDRESSEES) and the commitment selects gained
    // `counterparty` — what an addressed draft must agree with.
    /export function isLiveArtifact\(a: PreparedArtifact\): boolean \{\s*return !a\.stale && !a\.expired && !a\.outsideWindow && !a\.falseClaim && !a\.misaddressed;/.test(rd)
    && /export function stampTruth</.test(rd)
    && (rd.match(/stampTruth\(/g) ?? []).length >= 2
    // ⟲ RE-POINTED (W11.1): + `thread_id` (the signature floor finds the thread's mailbox).
    // ⟲ RE-POINTED (W14.1 · ONE READER, ONE ANSWER): the single reader IS the batched reader over one
    // item — one commitment-facts select serves both (the per-item select is gone by construction).
    && /const states = await preparedStatesFor\(client, userId, \[\{ kind, id: item\.id \}\]\);/.test(rd)
    && /select\('id, description, created_at, status, direction, counterparty(?:, thread_id)?'\)\.eq\('user_id', userId\)\.in\('id', commitIds\)/.test(rd));
  const row = (over: Record<string, unknown>) => ({ id: 'r', task_id: null, type: 'draft', title: 'x', content: 'body', created_at: '2026-09-20T10:00:00Z', metadata: {}, ...over });
  const facts = commitmentTruthFacts({ description: 'Redistribute the group allocation', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' });
  const pack = stampTruth(poolRowsToArtifacts([row({ type: 'document', content: live, metadata: { pastePack: true, note: 'Words ready', agentName: 'Clara' } })], 'commitment'), facts);
  gate('B8 pure: a false pack is not live, earns no badge and no lead kind', pack[0].falseClaim === true && !isLiveArtifact(pack[0]) && badgeOf(pack) === null && leadKindOf(pack) === null);
  const awaiting = stampTruth(poolRowsToArtifacts([row({ content: 'I have sent the report.', metadata: {} })], 'commitment'),
    commitmentTruthFacts({ description: 'Send the report', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'awaiting' }));
  gate('B9 pure: the same words on an AWAITING commitment are never judged (they owe, not the user)', awaiting[0].falseClaim === undefined && isLiveArtifact(awaiting[0]));
}

// ═══ C · ONE CLAIM: header ↔ brief ═══
console.log('\nC · the header speaks the same claim as the brief');
{
  const row = (over: Record<string, unknown>) => ({ id: 'r', task_id: null, type: 'draft', title: 'x', content: 'body', created_at: '2026-09-20T10:00:00Z', metadata: {}, ...over });
  const facts = commitmentTruthFacts({ description: 'Redistribute the group allocation', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' });
  const pack = stampTruth(poolRowsToArtifacts([row({ type: 'document', content: "I've finished the redistribution. Here's the updated breakdown.", metadata: { pastePack: true } })], 'commitment'), facts);
  const st = deriveState({ open: true, verdict: { work: 'reply' }, judgedAt: new Date().toISOString(), prepared: pack, liveAsk: false, sentStamp: false });
  gate('C1 the machine no longer reads a false pack as READY (ready_to_review) — it is preparing, honestly', st.state !== 'ready' && st.primary !== 'review' && st.state === 'preparing', st.state);
  const withAsk = deriveState({ open: true, verdict: { work: 'reply' }, judgedAt: new Date().toISOString(), prepared: pack, liveAsk: true, sentStamp: false });
  gate('C2 precedence #2 (floor → ladder → single claim): with the brief\'s ask standing, the state is awaiting_input, never ready', withAsk.state === 'awaiting_input');
  const view = src('app/api/items/view/route.ts');
  gate('C3 the view door serves LIVE only (a false pack never reaches the card) and its re-prepare trip fires on EVERY non-live artifact (stale · expired · outsideWindow · falseClaim)',
    /prepared: preparedArts\.filter\(isLiveArtifact\)\.map/.test(view)
    // ⟲ RE-POINTED (W13.5): ONE trip predicate for both open paths (lib/room/open-kicks needsReprepareTrip
    // — any artifact !isLiveArtifact), proven over every non-live flag in smoke-room-truth C1.
    && /const tripDue = needsReprepareTrip\(preparedArts\)/.test(view)
    && /return arts\.some\(\(a\) => !isLiveArtifact\(a\)\);/.test(src('lib/room/open-kicks.ts')));
  const detail = src('components/home/item-detail.tsx');
  gate('C4 the header word is the machine\'s word (machineWordOf reads view.machineState) — one derivation, no second author',
    /function machineWordOf\(view: ItemViewData \| null\): string \| null \{\s*const m = view\?\.machineState;/.test(detail));
}

// ═══ D · THE ROOM BRIEF READS THE EVIDENCE ═══
console.log('\nD · the room grounding carries later evidence');
{
  const g = src('lib/room/grounding.ts');
  gate('D1 the board entry carries LATER EVIDENCE from the W3.1 nominator (matchEvidence over the per-user pool, addresses resolved by resolveCommitmentAddresses)',
    /evidence: string\[\];/.test(g) && /matchEvidence\(bounded, \{/.test(g) && /resolveCommitmentAddresses\(client, userId, commitRows\.map/.test(g)
    && /evidence: evidenceByRef\.get\(`commit:\$\{String\(c\.id\)\}`\) \?\? \[\]/.test(g)
    && /evidence: evidenceByRef\.get\(`inbox:\$\{String\(it\.id\)\}`\) \?\? \[\]/.test(g));
  gate('D2 the evidence renders ON the board line with the rule beside it; bounded (pool memoized per user, ≤4 lines per item, 21-day calendar horizon)',
    /\\n  · LATER EVIDENCE: \$\{b\.evidence\.join\(' \| '\)\}/.test(g) && /BOARD_EVIDENCE_RULE/.test(g)
    && /const ROOM_EVIDENCE_MAX_LINES = 4;/.test(g) && /const ROOM_EVIDENCE_TTL_MS = 90_000;/.test(g)
    && /never say it was missed, skipped or not done/.test(BOARD_EVIDENCE_RULE));
  const lines = evidenceLinesOf([
    { type: 'calendar', id: 'e1', at: '2026-09-14T09:00:00Z', title: 'Platform walkthrough', status: 'held' },
    { type: 'email', id: 'm1', at: '2026-09-15T10:00:00Z', title: 'Re: walkthrough', by: 'user' },
  ], 'UTC');
  gate('D3 pure: a held meeting is stated HELD with its date; sent mail as SENT', lines.length === 2 && /HELD 2026-09-14/.test(lines[1]) && /the user SENT/.test(lines[0]));
  // ⟲ RE-POINTED (W8.1 EVIDENCE FROM EVERYWHERE): the pool is one list of normalized events; the
  // meeting enters through the calendar registry row's own mapper. Same fixture, same assertion.
  const held = calendarEventOf({ id: 'e1', start_time: '2026-09-14T09:00:00Z', end_time: '2026-09-14T09:30:00Z', title: 'Walkthrough', attendees: [{ email: 'sam@acme.example' }], status: 'confirmed' }, null, '2026-09-23T00:00:00Z');
  const ev = matchEvidence({
    events: held ? [held] : [],
  }, { kind: 'commitment', id: 'c', afterISO: '2026-09-10T00:00:00Z', counterpartyEmail: 'Sam@Acme.example', fulfiller: 'user', description: 'Schedule a call' }, '2026-09-23T00:00:00Z');
  gate('D4 pure: the nominator finds the held meeting by ADDRESS (case-blind), after the item', ev.length === 1 && ev[0].status === 'held');
  const brief = src('lib/room/brief.ts');
  const rbv = Number(/export const ROOM_BRIEF_VERSION = (\d+);/.exec(brief)?.[1] ?? 0);
  gate('D5 ROOM_BRIEF_VERSION ≥ 15 (a floor, never a pin) — the page changed, every cached opening re-authors; the evidence rides the board digest',
    rbv >= 15 && /:e\$\{b\.evidence\.length\}/.test(brief));
}

// ═══ F · W5c — A HIDDEN ARTIFACT IS REPLACED, NEVER SPOKEN, NEVER A HOLLOW CARD ═══
console.log('\nF · W5c: hidden artifacts re-prepare, leave the brief, and never mount a hollow card');
{
  const facts = commitmentTruthFacts({ description: 'Schedule meeting with Sam — September 30 or October 1', created_at: '2026-09-22T12:00:00Z', status: 'open', direction: 'you_owe' });
  const inviteRow = (startISO: string) => ({ id: 'i', task_id: 'prepare-pass-invite', type: 'draft', title: 'Invite — Sync', content: 'Sync', created_at: '2026-09-22T18:00:00Z',
    metadata: { invite: { title: 'Sync', startISO, endISO: startISO, timezone: 'Europe/Lisbon', attendees: ['sam@acme.example'], proposed: true } } });
  // ⟲ RE-POINTED (W6, Sep 23 — FIXTURE CLOCK ROT): the out-of-window invite sat at 2026-09-23T09:00Z,
  // which the real clock passed on Sep 23 — it then read EXPIRED (a different non-live class) instead
  // of WITHDRAWN-for-the-window, and F5 went red with no code change. It now sits AFTER the stated
  // window (still outside it, never in the past), so F1/F5 keep asserting the window law itself.
  const outside = stampTruth(poolRowsToArtifacts([inviteRow('2026-10-15T09:00:00Z')], 'commitment'), facts);
  const liveInv = stampTruth(poolRowsToArtifacts([inviteRow('2026-09-30T09:00:00Z')], 'commitment'), facts);
  const st = (arts: typeof outside) => ({ all: arts, live: arts.filter(isLiveArtifact), expired: arts.filter((a) => a.expired), badge: badgeOf(arts) });
  gate('F1 pure: THE RE-PREPARE KEY — an out-of-window (or expired) invite is a NON-LIVE kind; a live one is not',
    [...nonLiveKindsOf(st(outside))].join() === 'invite' && nonLiveKindsOf(st(liveInv)).size === 0
    && withdrawnReasonOf(outside[0]) === 'outside the window they stated');
  const pass_ = src('lib/prepare/pass.ts');
  gate('F2 every lane\'s freshness guard reads the non-live set — a young-but-hidden artifact is never "already on it" (invite ×2 · nudge ×2 · reply · delegate · paste pack)',
    /nonLive = nonLiveKindsOf\(await preparedState\(admin, userId,/.test(pass_)
    // ⟲ RE-POINTED (W9.1 — the clock left): every lane hands the non-live set to THE ONE DECISION
    // (lib/prepare/hand.ts decideRegeneration), where a withdrawn machine artifact regenerates.
    && (pass_.match(/groundMoved: movedPast, nonLive: untrueInvite/g) ?? []).length === 2
    && (pass_.match(/groundMoved: movedPast, nonLive: untrueNudge/g) ?? []).length === 2
    && /nonLive: !!nonLive\?\.has\('reply_draft'\)/.test(pass_)
    && /nonLive: !!untrueDeliverable/.test(pass_)
    && /supersede: nonLive\.has\('paste_pack'\)/.test(pass_)
    && /nonLive: !!args\.supersede/.test(src('lib/prepare/paste-pack.ts')));
  const view = src('app/api/items/view/route.ts');
  gate('F3 the on-open trip covers every non-live artifact and LOGS its outcome (a no-op is never silent)',
    // ⟲ RE-POINTED (W13.5): the predicate is needsReprepareTrip (every non-live artifact), same kinds.
    /needsReprepareTrip\(preparedArts\) && \(linkKind === 'inbox_item' \|\| linkKind === 'commitment'\)/.test(view)
    // ⟲ RE-POINTED (W8.4): the trip moved to ONE home shared with the joined-open kick
    // (lib/room/open-kicks.ts reprepareTrip) — the door schedules it; the log line lives with it.
    && /await reprepareTrip\(supabase, uid, linkKind, id, staleRow, eid\);/.test(view)
    && /console\.log\(`\[items\/view\] re-prepare trip \$\{linkKind\}:\$\{id\} → \$\{r\.did\}/.test(src('lib/room/open-kicks.ts')));
  const out = { title: 'Sync', startISO: '2026-09-23T09:00:00.000Z', endISO: '2026-09-23T09:30:00.000Z', proposed: true, timezone: 'Europe/Lisbon',
    alternatives: [{ startISO: '2026-09-23T13:00:00.000Z', endISO: '2026-09-23T13:30:00.000Z' }, { startISO: '2026-10-01T09:00:00.000Z', endISO: '2026-10-01T09:30:00.000Z' }] } as Parameters<typeof confineInviteToStatedWindow>[0];
  const nowMs = Date.parse('2026-09-22T15:00:00Z');
  const win = confineInviteToStatedWindow(out, { narrow: 'Schedule meeting with Sam — September 30 or October 1', wide: 'grounding text' }, '2026-09-22T12:00:00Z', nowMs);
  const inn = { title: 'Sync', startISO: '2026-09-30T09:00:00.000Z', endISO: '2026-09-30T09:30:00.000Z', proposed: true, timezone: 'Europe/Lisbon' } as Parameters<typeof confineInviteToStatedWindow>[0];
  confineInviteToStatedWindow(inn, { narrow: 'Schedule meeting with Sam — September 30 or October 1' }, '2026-09-22T12:00:00Z', nowMs);
  gate('F4 pure: THE ONE CONFINEMENT — a commitment with a stated window: an out-of-window proposal drops (only the in-window alternative survives, the calendar search gets the window); an in-window one is stamped stated_window',
    win?.start === '2026-09-30' && win?.end === '2026-10-01' && out.startISO === '' && out.proposed === false
    && out.alternatives?.length === 1 && out.alternatives[0].startISO.startsWith('2026-10-01')
    && inn.startISO.startsWith('2026-09-30') && inn.proposedFrom === 'stated_window');
  const before = preparedWordsOf(st(liveInv));
  const after = preparedWordsOf(st(outside));
  const entry = (w: ReturnType<typeof preparedWordsOf>) => ({ ref: 'commit:c1', judgedWork: 'schedule', prepared: w.list, expired: w.expired, withdrawn: w.withdrawn, evidence: [] as string[] });
  gate('F5 pure: the board states a hidden invite WITHDRAWN (never PREPARED) and THE DIGEST MOVES when liveness changes',
    before.list.join() === 'calendar invite' && after.list.length === 0
    && after.withdrawn.length === 1 && /outside the window they stated/.test(after.withdrawn[0])
    && boardDigestOf([entry(before)]) !== boardDigestOf([entry(after)])
    // ⟲ W13.5: the mark carries the hidden artifact's WORDS + the reader's reason (was a bare count ':x0w1').
    && boardLivenessMark(entry(after)) === `:x[]w[${after.withdrawn[0]}]` && boardLivenessMark(entry(before)) === '');
  const many = Array.from({ length: 30 }, (_, i) => ({ ref: `inbox:${'x'.repeat(30)}${i}`, judgedWork: 'reply', prepared: ['reply draft'], expired: [] as string[], withdrawn: [] as string[], evidence: [] as string[] }));
  const manyHidden = many.map((b, i) => (i === 29 ? { ...b, prepared: [], withdrawn: ['reply draft — its words claimed work that is not done'] } : b));
  const brief = src('lib/room/brief.ts');
  gate('F6 the digest is hashed WHOLE — a liveness change on a busy room\'s LAST item still moves it (the 400-char head clip is gone)',
    boardDigestOf(many) !== boardDigestOf(manyHidden) && /const boardDigest = boardDigestOf\(g\.board\);/.test(brief)
    && !/b\.prepared\.join\('\+'\)[^\n]*\.slice\(0, 400\)/.test(brief));
  const g = src('lib/room/grounding.ts');
  gate('F7 the grounding: WITHDRAWN rides the board line; a prep narration with no live artifact behind it never reaches the composer\'s transcript',
    /· WITHDRAWN \(not ready — we are re-preparing it; never say it is prepared, below, or ready\)/.test(g)
    && /withdrawn: cprep\.withdrawn/.test(g) && /withdrawn: prep\.withdrawn/.test(g)
    && /const transcript = turns\.filter\(\(t\) => !unbackedPrep\(t\)\)/.test(g)
    && /return !!entry && entry\.prepared\.length === 0;/.test(g));
  const detail = src('components/home/item-detail.tsx');
  const card = src('components/home/invite-card.tsx');
  // Every artifact-card spread (`...(<cond> ? [{ key: 'invite'`) in the deep-dive, with its condition.
  const inviteMounts = [...detail.matchAll(/\.\.\.\(([^\n]*?) \? \[\{\s*(?:\/\/[^\n]*\n\s*)*key: 'invite'/g)].map((m) => m[1]);
  gate('F8 NO HOLLOW INVITE CARD: every invite ARTIFACT card (email · commitment · follow-up) mounts from a LIVE invite ONLY — never the bare schedule verdict, never a plan step; the card itself renders one quiet line (not an empty shell) when the preparer hands back no invite or a hollow partial',
    inviteMounts.length === 3
    && inviteMounts.every((c) => !/verdict\?\.work === 'schedule'|inviteTaskId/.test(c) && /inviteArt|p\.kind === 'invite'/.test(c))
    && /const hollowInvite = !partial\?\.title\?\.trim\(\) && !partial\?\.startISO && !\(Array\.isArray\(partial\?\.attendees\)/.test(card)
    && /\} else \{\s*setHollow\(true\);/.test(card) && /if \(hollow\) \{\s*return <p/.test(card),
    inviteMounts.join(' | '));
  const commitSeg = detail.slice(detail.indexOf('function CommitmentDetail('), detail.indexOf('function InputStationCard('));
  gate('F8b THE DECISION RENDERS ON THE COMMITMENT DOOR: a decide verdict + THE DECISION BRIEF reach the rail as the ONE DecisionCard (brief options supersede the judge\'s labels; object from the door\'s own prepared list); the lead strip still filters decision artifacts',
    /const decisionBriefC = prepArts\.find\(\(p\) => p\.decision && p\.decision\.options\.length >= 2\)/.test(commitSeg)
    && /verdict\?\.work === 'decide'/.test(commitSeg) && /itemKind: 'commitment' as const,/.test(commitSeg)
    && /object: resolveDecisionObject\(view\?\.prepared \?\? null\)/.test(commitSeg)
    // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the door's own source object (`sourceItemId`) now
    // rides the mount between the artifacts and the decision — same mount, one more fact.
    // ⟲ RE-POINTED (W7.3): + the meeting source object (`sourceMeeting`) rides the same mount.
    // ⟲ RE-POINTED (W11.1): + the commitment's OWN source message (`sourceEmail`) rides it too.
    && /<ItemRail kind="commitment"[^>]*artifacts=\{commitArtifacts\}[\s\S]{0,400}?sourceItemId=\{view\?\.sourceItemId \?\? null\}[\s\S]{0,200}?sourceMeeting=\{view\?\.sourceMeeting \?\? null\}[\s\S]{0,600}?decision=\{commitDecision \?/.test(commitSeg)
    && /\(p\.kind === 'deliverable' \|\| p\.kind === 'paste_pack'\) && p\.content && !p\.decision/.test(commitSeg));
  const label = 'paste_pack (group allocation redistribution prepared by Clara)';
  gate('F9 MOOT BY CODE: a requires label naming OUR OWN artifact kind is never the user\'s input (rule 4) — at the render predicate AND the resolver',
    namesOurArtifact(label) && namesOurArtifact('the calendar invite') && namesOurArtifact('decision brief') && namesOurArtifact('follow-up nudge')
    && !namesOurArtifact('forward-looking plan') && !namesOurArtifact('allocation criteria') && !namesOurArtifact('the signed contract')
    && askIsMoot([label], { itemTitle: 'Redistribute the group allocation', itemKind: 'commitment', verdictRequires: null, engineAsk: true })
    && !askIsMoot(['allocation criteria'], { itemTitle: 'Redistribute the group allocation', itemKind: 'commitment', verdictRequires: null, engineAsk: true })
    && /requires = requires\.filter\(\(r\) => !namesOurArtifact\(r\.label\)\);/.test(src('lib/prepare/requirements.ts')));
  const judge = src('lib/work/judge.ts');
  const falseDraft = stampTruth(poolRowsToArtifacts([{ id: 'd', task_id: null, type: 'draft', title: 'x', content: "I've finished the redistribution. Here's the updated breakdown.", created_at: '2026-09-20T10:00:00Z', metadata: {} }], 'commitment'),
    commitmentTruthFacts({ description: 'Redistribute the group allocation', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' }));
  gate('F10 the judge reads LIVE work (hidden ones stated WITHDRAWN, never "already prepared", never requirable) and the loose anchor claims only a live draft',
    /const pool: PreparedArtifact\[\] = prepSt\.live;/.test(judge) && /never list them in "requires"/.test(judge)
    && /poolBlock \+ withdrawnBlock \+/.test(judge)
    && falseDraft[0].falseClaim === true
    && anchorOf('commitment', { counterparty: 'Sam', description: 'Redistribute the group allocation' }, falseDraft).prepared === null);
}

// ═══ E · THE SWEEPS ═══
console.log('\nE · repair sweeps are dry-run by default and ask the reader\'s own predicates');
{
  for (const f of ['scripts/sweep-invite-windows.ts', 'scripts/sweep-false-completion-claims.ts']) {
    const s = src(f);
    gate(`E · ${f} — dry-run default, --apply owner-gated, stampTruth from THE ONE READER`,
      /const APPLY = process\.argv\.includes\('--apply'\);/.test(s) && /stampTruth\(/.test(s) && /dry-run — pass --apply/.test(s));
  }
}

let finished = false;
function finish() {
  if (finished) return; finished = true;
  console.log(`\n${failures.length ? '✗' : '✓'} smoke-prepared-truth: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
}
