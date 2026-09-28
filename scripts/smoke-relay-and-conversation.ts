// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W18.C · TWO CLASSES FROM THE OWNER'S WALK (Sep 25). ZERO AI, ZERO network, no data.
//
//   R · A RELAY IS A NOTICE (lib/inbox/relay-digest.ts; ONE FACT ONE HOME + the notice law)
//       R1 an automated digest summarising the user's OWN mail is a relay → floored (awareness · none ·
//          no ask · no deadline) → the notice law demotes it: it never seats as an action;
//       R2 it never duplicates an open item: its `relayOf` names the existing home, and the floored
//          digest carries no ask of its own;
//       R3 a genuine automated ask to the user (a system's own approval, no citation) keeps its seat;
//          the security/dunning class keeps its seat even when the model says relay;
//       R4 a PERSON's mail is never floored (a stray model `relay` is dropped);
//       R5 the row name never shows a relay sender as the asker (askerOf + both brief seats);
//       R6 the ONE understanding pass applies the floor with the ingest's signals (both doors).
//   C · THE CONVERSATION ANSWERS (lib/evidence/match.ts; EVIDENCE SETTLES)
//       C1 a later same-conversation message is nominated against an open commitment born of an
//          earlier message — the user's quick reply AND the counterparty's confirmation, even when a
//          colleague's later mail fills the newest slots (the legacy options would drop both);
//       C2 the other side's mail on ANOTHER thread is never nominated for work the user owes;
//       C3 bounded: ≤ EVIDENCE_MAX_PER_TYPE per type, the remainder COUNTED (no silent caps);
//       C4 nomination never closes by itself — a stubbed judge's `unclear` never calls the close; only
//          `delivered` does; the other side's message never raises looks-done alone;
//       C5 the judge is told who wrote each piece (the other side labelled; the confirmation clause);
//       C6 the direction floor's `none` (debt stays on the desk) never masks a live looks-done record.
// Fixtures: fake identities only.   Run: npx tsx scripts/smoke-relay-and-conversation.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import {
  citedOwnMail, isRelayDigest, floorRelayUnderstanding, askerOf, RELAY_MIN_CITED, type WindowMail,
} from '../lib/inbox/relay-digest';
import { isNoMoveNotice } from '../lib/inbox/notice-demotion';
import { coerceUnderstanding, type ItemUnderstanding } from '../lib/inbox/item-understanding';
import {
  matchEventsReport, SETTLE_MATCH, EVIDENCE_MAX_PER_TYPE, type MatchWork,
} from '../lib/evidence/match';
import type { EvidenceEvent } from '../lib/evidence/types';
import { looksDoneEvidenceOf } from '../lib/evidence/looks-done';
import { applyFulfillmentVerdict } from '../lib/commitments/fulfillment';
import { deriveState } from '../lib/work/machine';
import { DIRECTION_FLOOR_REASON } from '../lib/work/direction-floor-word';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');

async function main() {
  console.log('R · A RELAY IS A NOTICE');
  // The user's own window: an invoice from a supplier, a hotel review ask, a marketplace note.
  const window: WindowMail[] = [
    { id: '11111111-1111-4111-8111-111111111111', from: 'billing@acme-airports.example', fromName: 'Acme Airports', threadId: 't-inv' },
    { id: '22222222-2222-4222-8222-222222222222', from: 'noreply@stayhub.example', fromName: 'StayHub', threadId: 't-stay' },
    { id: '33333333-3333-4333-8333-333333333333', from: 'info@fixmarket.example', fromName: 'FixMarket', threadId: 't-fix' },
    { id: '44444444-4444-4444-8444-444444444444', from: 'sam@pilot-account.example', fromName: 'Sam Rivera', threadId: 't-sam' },
  ];
  const digestText = 'Five came in overnight. I started on all of them. Nothing goes out without your approval.\n'
    + 'Acme-Airports · €22 Fast Track invoice — asked you to pay €22 · payable before Sep 24\n'
    + 'StayHub · rate your stay\nFixMarket · check your notification settings';
  const digestFrom = 'assistant@relaybot.example';
  const cited = citedOwnMail(digestText, { from: digestFrom, threadId: 't-digest' }, window, ['Alex', 'Example', 'alex@own.example']);
  const u: ItemUnderstanding = coerceUnderstanding({ role: 'addressed', relevance: 'action', ownership: 'you_owe', mailKind: 'customer', ask: 'Approve the €22 invoice by Sep 24', deadline: '2026-09-24', language: 'en' })!;
  const signals = { isAutomatedSender: true, isNotification: true };
  const relay = isRelayDigest({ u, signals, fromEmail: digestFrom, fromName: 'Relaybot', subject: 'Five came in overnight', cited });
  ok('R1 the digest cites the user\'s own mail (≥ RELAY_MIN_CITED parties)', cited.length >= RELAY_MIN_CITED, JSON.stringify(cited));
  ok('R1 an automated digest of the user\'s own mail is a relay', relay);
  const floored = floorRelayUnderstanding(u, relay, cited)!;
  ok('R1 the relay is floored — awareness · none · no ask · no deadline · notification',
    floored.relevance === 'awareness' && floored.ownership === 'none' && !floored.ask && !floored.deadline && floored.mailKind === 'notification' && floored.relay === true);
  const stored = coerceUnderstanding(JSON.parse(JSON.stringify(floored)));
  ok('R1 the floored understanding survives storage (coerce keeps relay + relayOf)', stored?.relay === true && (stored?.relayOf?.length ?? 0) === cited.length);
  ok('R1 the notice law demotes it — it never seats as an action',
    isNoMoveNotice({ u: stored, rawKind: null, fromEmail: digestFrom, fromName: 'Relaybot', subject: 'Five came in overnight', workState: 'decision_required' }));
  ok('R2 it never duplicates an open item: relayOf names the existing home (the invoice) and it carries no ask',
    (stored?.relayOf ?? []).includes('11111111-1111-4111-8111-111111111111') && !stored?.ask);
  ok('R2 the person on the window (the user\'s own colleague thread) is not cited by a word they never appear as',
    !cited.includes('44444444-4444-4444-8444-444444444444'));

  // R3 · genuine automated asks keep their seat.
  const approveU = coerceUnderstanding({ role: 'addressed', relevance: 'action', ownership: 'you_owe', ask: 'Approve expense report 4411', language: 'en' })!;
  const sysText = 'Expense report 4411 submitted by Sam is waiting for your approval in ExpenseDesk. Approve or reject.';
  const sysCited = citedOwnMail(sysText, { from: 'approvals@expensedesk.example', threadId: 't-exp' }, window, ['Alex']);
  ok('R3 a system\'s own approval ask cites no user mail and is NOT a relay',
    !isRelayDigest({ u: approveU, signals, fromEmail: 'approvals@expensedesk.example', fromName: 'ExpenseDesk', subject: 'Approval needed', cited: sysCited }));
  ok('R3 … so the floor leaves it seated (action · you_owe · its ask)', (() => { const f = floorRelayUnderstanding(approveU, false)!; return f.relevance === 'action' && f.ownership === 'you_owe' && !!f.ask; })());
  ok('R3 the security/dunning class keeps its seat even when the model says relay',
    !isRelayDigest({ u: { relay: true }, signals, fromEmail: 'no-reply@bank.example', fromName: 'Bank', subject: 'Security alert: unusual sign-in', cited: [] }));

  // R4 · a person's mail is never floored.
  const personU = coerceUnderstanding({ role: 'addressed', relevance: 'reply', ownership: 'you_owe', ask: 'Handle the three items below', relay: true, language: 'en' })!;
  const personRelay = isRelayDigest({ u: personU, signals: { isAutomatedSender: false, isNotification: false }, fromEmail: 'sam@pilot-account.example', fromName: 'Sam Rivera', subject: 'FW: three things', cited });
  const personFloored = floorRelayUnderstanding(personU, personRelay)!;
  ok('R4 a person forwarding a summary is not a relay; the stray flag is dropped', !personRelay && personFloored.relay === undefined && personFloored.relevance === 'reply');
  ok('R4 … and the notice law does not demote it', !isNoMoveNotice({ u: personFloored, rawKind: null, fromEmail: 'sam@pilot-account.example', fromName: 'Sam Rivera', subject: 'FW: three things', workState: 'decision_required' }));

  // R5 · the row's name.
  ok('R5 askerOf never names a relay sender', askerOf({ from_name: 'Relaybot', from: digestFrom, understanding: floored }) === null);
  ok('R5 askerOf names a real sender', askerOf({ from_name: 'Sam Rivera', from: 'sam@pilot-account.example', understanding: personFloored }) === 'Sam Rivera');
  const route = src('app/api/home/brief/route.ts');
  ok('R5 both brief seats (action notice · must-respond) lead with askerOf — never the raw sender',
    /const who = askerOf\(sd, u\)/.test(route) && /from: askerOf\(sd, u\)/.test(route));

  // R6 · the ONE understanding pass floors with the ingest's signals.
  const ep = src('lib/ai/email-processor.ts');
  ok('R6 computeUnderstanding applies the relay floor', /applyRelayFloor\(supabase, email\.user_id!, u,/.test(ep) && /"relay":true\|false/.test(ep));
  ok('R6 processEmail passes the ingest signals; the arrival refresh passes the stored signals',
    /computeUnderstanding\(email, supabase, \{ signals: result\.signals/.test(ep) && /signals: \(sd\.signals/.test(src('lib/inbox/refresh-understanding.ts')));

  console.log('\nC · THE CONVERSATION ANSWERS');
  const T0 = '2026-08-10T15:06:45.000Z';
  const NOW = '2026-09-25T12:00:00.000Z';
  const CP = 'client@client-co.example';
  const keys = { addresses: [CP], personIds: [], threadIds: ['tConv'], eventIds: [], fileIds: [], externalRefs: [], entityIds: [] };
  const w: MatchWork = { afterISO: T0, fulfiller: 'user', keys };
  const msg = (id: string, at: string, role: 'user' | 'teammate' | 'counterparty' | 'unknown', address: string, thread = 'tConv'): EvidenceEvent => ({
    source: 'mail', type: 'email', id, at, deed: 'message_sent', actor: { role, address }, participants: [{ address: CP }], objects: { threadId: thread }, title: 'Re: Follow up',
  });
  const events: EvidenceEvent[] = [
    msg('reply', '2026-08-10T15:20:34.000Z', 'user', 'alex@own.example'),
    msg('confirm', '2026-08-10T15:27:22.000Z', 'counterparty', CP),
    ...Array.from({ length: 8 }, (_, i) => msg(`mate${i}`, `2026-09-0${i + 1}T09:00:00.000Z`, 'teammate', 'sam@partner.example')),
    msg('other-thread', '2026-09-10T09:00:00.000Z', 'counterparty', CP, 'tElse'),
  ];
  const legacy = matchEventsReport(events, w, NOW, { teammates: true, types: 'all' });
  const now = matchEventsReport(events, w, NOW, SETTLE_MATCH);
  const ids = now.evidence.map((e) => e.id);
  ok('C1 ⟲ legacy options drop the quick reply and the confirmation (the found-live failure)', !legacy.evidence.some((e) => e.id === 'reply' || e.id === 'confirm'));
  ok('C1 the user\'s reply on the same conversation is nominated', ids.includes('reply'), ids.join(','));
  ok('C1 the counterparty\'s confirmation on the same conversation is nominated, labelled as theirs',
    now.evidence.some((e) => e.id === 'confirm' && e.by === 'counterparty' && e.key === 'object'));
  ok('C2 the other side\'s mail on ANOTHER thread is never nominated', !ids.includes('other-thread'));
  ok('C3 bounded per type and the remainder counted', now.evidence.length <= EVIDENCE_MAX_PER_TYPE && now.leftBehind === 10 - now.evidence.length, `n=${now.evidence.length} left=${now.leftBehind}`);

  // C4 · a stubbed judge: nomination alone never closes.
  let closes = 0;
  const close = async () => { closes++; return true; };
  const row = { id: 'c1', description: 'Fix the incomplete survey question', due_date: '2026-08-14' };
  await applyFulfillmentVerdict(null as never, 'u1', row, { verdict: 'unclear', reason: 'stub' }, close);
  await applyFulfillmentVerdict(null as never, 'u1', row, { verdict: 'promised', reason: 'stub' }, close).catch(() => false);
  ok('C4 a nominated set judged unclear/promised never calls the close', closes === 0);
  await applyFulfillmentVerdict({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) } as never, 'u1', row, { verdict: 'delivered', reason: 'stub', by: { type: 'email', id: 'reply', at: '2026-08-10T15:20:34.000Z' } }, close);
  ok('C4 only a judged delivery calls the close', closes === 1);
  const onlyOther = now.evidence.filter((e) => e.by === 'counterparty');
  ok('C4 the other side\'s message never raises looks-done by itself', looksDoneEvidenceOf(onlyOther, 'unclear', 'user') === null);

  // C5 · the judge reads who wrote each piece.
  const ful = src('lib/commitments/fulfillment.ts');
  const settle = src('lib/work/evidence-settle.ts');
  ok('C5 the other side is labelled in the judge prompt, with the confirmation clause', /the OTHER SIDE \(/.test(ful) && /THE CONFIRMATION CLAUSE/.test(ful));
  // ⟲ RE-POINTED W19: the settle now also hands toCandidates the bodies the W19.A relevance gate
  // already read (gateEvidenceAboutWork — no second read); the fulfiller argument, the law here, is unchanged.
  ok('C5 the settle hands the judge the actor of the other side\'s pieces', /toCandidates\(client, userId, evidence, work\.fulfiller(?:, gated\.bodies)?\)/.test(settle) && /e\.by === 'counterparty'/.test(settle));
  ok('C5 SETTLE_MATCH carries the conversation window (the judge + room see what the settle sees)', SETTLE_MATCH.conversation === true);

  // C6 · the direction floor's none never masks a live looks-done record.
  const base = { open: true, judgedAt: null, prepared: [], liveAsk: false, sentStamp: false, looksDone: true };
  ok('C6 direction-floor none + a live looks-done record → looks_done',
    deriveState({ ...base, verdict: { work: 'none', reason: `${DIRECTION_FLOOR_REASON}. (chase refused)` } }).state === 'looks_done');
  ok('C6 a plain judged none stays settled (unchanged)', deriveState({ ...base, verdict: { work: 'none', reason: 'nothing to do' } }).state === 'settled');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
