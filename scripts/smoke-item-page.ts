// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — THE ITEM PAGE IS A FEW KIT WIDGETS (stabilization W16 · law `the-item-page-is-a-few-widgets`)
//
// ZERO AI · ZERO DB · ZERO NETWORK. Renders the item page's thread for EVERY item kind × EVERY machine
// state through the ONE composition (components/thread/item-page.ts composeItemPage → itemPageItems)
// and the kit's real timeline (renderToStaticMarkup), and holds:
//   A · the composition: ≤1 action widget, always a kit widget kind, chosen by the machine's state; a
//       withdrawn target (nothing mounted) renders no widget; Clara is one sentence with no draft /
//       file / prep claim and no button; the header carries no status pill; Done is emphasised only
//       on the confirm widget.
//   B · the render: the timeline for every fixture — exactly the widgets the plan names, no proposal
//       (MOVE) card, no "Review …" button, the confirm widget's words "Mark done" / "Keep open",
//       never "Not yet".
//   C · looks-done is meaningful: only same-conversation evidence (or a held meeting with the
//       counterparty for a meeting-shaped obligation) raises it — the owner's example stays down.
//   D · the source floors: the header frame has no state pill / evidence bar / face pile / project
//       chip; the rail's item door renders through the one composition and no MOVE; the view door
//       serves no move; every kind mounts the confirm widget through its own done door.
//   W · W16.2 — ONE set of words: the Home row and the confirm widget say "Mark done" / "Keep open"
//       from ONE home; no "Not yet" in any looks-done UI.
//   F · W16.2 — Clara's fallback is DIRECTION-TRUE over fixtures (own promise · their ask · awaiting ·
//       meeting), from the item's own facts (origin served by the view door; no AI).
//   K · W16.2 — the confirm widget is a first-class kit kind (`confirm`): in the contract, drawn by the
//       kit's renderer, specimened in the catalogue, produced by the host, routed by the item page.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeItemPage, itemPageItems, claraSentenceOf, actionOf, actionCardOf, ITEM_ACTION_WIDGETS, CONFIRM_WORDS,
  WIDGET_OF_ARTIFACT, ARTIFACTS_OF_STATE, NOT_ITEM_PAGE_WIDGETS,
  type ItemActionWidget, type ItemArtifactKind, type ItemArtifactsMounted, type ItemPagePlan, type ItemPageState,
} from '../components/thread/item-page';
import { ThreadTimeline } from '../components/thread/thread-timeline';
import { ThreadCardView } from '../components/thread/thread-cards';
import { THREAD_CARD_KINDS, type ThreadCard } from '../components/thread/types';
import { CONFIRM_WORDS as WORDS_HOME } from '../lib/evidence/looks-done-word';
import { fallbackOpeningLine, originOf } from '../lib/room/opening-fallback';
import { readdirSync, statSync } from 'fs';
import { looksDoneEvidenceOf, looksDoneLine, looksDoneLive } from '../lib/evidence/looks-done';
import type { Evidence } from '../lib/evidence/match';
import { deriveState } from '../lib/work/machine';
import { bookedEventFor, counterpartyInEvent, nameKeysOf, addressNamesPerson, scheduledWordOf } from '../lib/work/scheduled';
import type { PreparedArtifact } from '../lib/prepare/read';

// The kit's JSX files compile with the classic runtime under tsx — the global the decision-card gate sets too.
(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
const gate = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// ── FIXTURES — every item kind, with the artifacts its door can MOUNT (generic names only) ──────────
// Every door can ALSO carry a live ask, a decision and the looks-done evidence; a handoff carries a
// parked run's gate. The machine's state picks ONE through the table.
type Kind = 'email' | 'commitment' | 'meeting-action' | 'follow-up' | 'invite' | 'forward' | 'deliverable' | 'handoff' | 'meeting-commitment' | 'booked-call';
const ALWAYS: ItemArtifactsMounted = { ask: true, decision: true, looks_done: true };
const KINDS: Record<Kind, { who: string; ask: string; title: string; source: 'source' | 'event'; mounts: ItemArtifactsMounted; gate?: boolean }> = {
  email: { who: 'Sam', ask: 'send the signed order form', title: 'Order form', source: 'source', mounts: { reply_draft: true } },
  commitment: { who: 'Acme', ask: 'share the updated report', title: 'Share the updated report', source: 'source', mounts: { nudge_draft: true, invite: true, deliverable: true } },
  'meeting-action': { who: 'Sam', ask: 'circulate the notes from the review', title: 'Circulate the notes', source: 'source', mounts: { deliverable: true } },
  'follow-up': { who: 'Acme', ask: 'answer on pricing', title: 'Waiting on pricing', source: 'source', mounts: { nudge_draft: true, invite: true } },
  invite: { who: 'Sam', ask: 'book a call next week', title: 'Call next week', source: 'source', mounts: { invite: true } },
  forward: { who: 'Sam', ask: 'pass the brief to the design lead', title: 'Brief for design', source: 'source', mounts: { forward: true } },
  deliverable: { who: 'Acme', ask: 'send the quarterly summary', title: 'Quarterly summary', source: 'source', mounts: { paste_pack: true, document: true, frame: true } },
  handoff: { who: 'Acme', ask: 'approve the shortlist', title: 'Shortlist', source: 'source', mounts: { gate: true }, gate: true },
  'meeting-commitment': { who: 'Sam', ask: 'send the recap', title: 'Recap', source: 'event', mounts: { nudge_draft: true } },
  // W16 · the owner's case: a you_owe "join the call" commitment whose meeting is ALREADY BOOKED and
  // accepted — the stale invite is still in the pool, the booking is mounted as the event widget.
  'booked-call': { who: 'Sam Lee', ask: 'join the call 30 minutes later than originally scheduled', title: 'Join call', source: 'source', mounts: { invite: true, booked_event: true } },
};
const STATES: ItemPageState[] = ['awaiting_approval', 'awaiting_input', 'awaiting_decision', 'ready', 'looks_done', 'scheduled', 'committed', 'parked', 'preparing', 'unjudged', 'settled'];
// The owner's paragraph, verbatim in shape: a draft claim + a review demand.
const LYING_BRIEF = "I've drafted a reply to their product feedback — you need to review my draft before it goes. Nothing else is open.";
const PLAIN_BRIEF = 'Sam wants the signed order form before Friday. The rest of the thread is logistics.';

const SEAT = { id: 'cos', name: 'Clara', roleLabel: 'chief of staff' };
// What the host mounts for each widget — a kit render, carrying the widget's data-attribute.
const widgetNode = (w: ItemActionWidget): React.ReactNode => {
  const tag = (child: React.ReactNode) => React.createElement('div', { 'data-widget': w }, child);
  switch (w) {
    case 'email': return tag(React.createElement(ThreadCardView, { card: { kind: 'email', state: 'ready', to: ['sam@acme.example'], subject: 'Re: Order form', body: 'Hi Sam — attached.', onSend: () => {} } as never }));
    case 'input': return tag(React.createElement(ThreadCardView, { card: { kind: 'input', ask: '', items: ['The signed form'], onAttach: () => {} } }));
    case 'deliverable': return tag(React.createElement(ThreadCardView, { card: { kind: 'deliverable', title: 'Notes', onOpen: () => {} } }));
    case 'approval': return tag(React.createElement(ThreadCardView, { card: { kind: 'approval', title: 'Shortlist', approveLabel: 'Approve', rejectLabel: 'Hold back', onApprove: () => {}, onReject: () => {} } }));
    case 'frame': return tag(React.createElement(ThreadCardView, { card: { kind: 'frame', title: 'Summary', onOpen: () => {} } }));
    default: return tag(w);
  }
};
const CONFIRM_CARD: ThreadCard = { kind: 'confirm', line: null, onDone: () => {}, onKeep: () => {} };
const sourceNode = (w: 'source' | 'event') => React.createElement('div', { 'data-source': w }, w === 'event' ? 'Recap call · Tue 10:00 · Sam · Join' : 'the source message');
const renderPage = (plan: ItemPagePlan) => renderToStaticMarkup(React.createElement(ThreadTimeline, {
  items: itemPageItems(plan, {
    seat: SEAT,
    source: plan.source ? sourceNode(plan.source) : null,
    // W16.2 · the confirm widget is handed as the kit's `confirm` CARD (as item-detail's confirmCardOf does).
    action: plan.action === 'confirm' ? { card: CONFIRM_CARD, by: null } : plan.action ? { node: widgetNode(plan.action), by: null } : null,
  }),
}));
const widgetsIn = (html: string) => [...html.matchAll(/data-widget="([a-z]+)"/g)].map((m) => m[1]);
const sourcesIn = (html: string) => [...html.matchAll(/data-source="([a-z]+)"/g)].map((m) => m[1]);
/** The page, top to bottom, as the owner reads it: Clara · the source · the one action widget. */
const outlineOf = (html: string) => [...html.matchAll(/data-(source|widget)="([a-z]+)"/g)].map((m) => `${m[2]} ${m[1] === 'source' ? 'source' : 'widget'}`);
const planOf = (k: (typeof KINDS)[Kind], state: string, brief: string) => composeItemPage({
  machine: { state, line: 'You replied on Sep 23' }, gateOpen: k.gate === true, mounted: { ...k.mounts, ...ALWAYS },
  brief, who: k.who, ask: k.ask, title: k.title, source: k.source,
});

// ── T · THE TABLE ───────────────────────────────────────────────────────────────────────────────────
console.log('T · one table: machine state + artifact kind → a kit widget, over the whole kit');
{
  const read_ = read('lib/prepare/read.ts');
  const union = (read_.match(/export type PreparedKind = ([^;]+);/)?.[1] ?? '').match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1)) ?? [];
  const unmapped = union.filter((k) => !(k in WIDGET_OF_ARTIFACT));
  gate('T1 EVERY PreparedKind THE ONE READER can serve maps to a kit widget (a new kind without a row fails here and in the typecheck)',
    union.length >= 6 && unmapped.length === 0, `union=${union.join(',')} unmapped=${unmapped.join(',')}`);
  const kitKinds = new Set<string>(THREAD_CARD_KINDS);
  const notKit = ITEM_ACTION_WIDGETS.filter((w) => w !== 'confirm' && !kitKinds.has(w));
  gate('T2 every item-page widget IS a kit widget kind (components/thread/types.ts) — or the kit\'s confirm widget', notKit.length === 0, notKit.join(','));
  const forbidden = Object.values(WIDGET_OF_ARTIFACT).filter((w) => (NOT_ITEM_PAGE_WIDGETS as readonly string[]).includes(w));
  gate('T3 collection · bulk · proposal · custom are never item-page widgets', forbidden.length === 0 && !(ITEM_ACTION_WIDGETS as readonly string[]).some((w) => (NOT_ITEM_PAGE_WIDGETS as readonly string[]).includes(w)));
  const rowsBad = (Object.entries(ARTIFACTS_OF_STATE) as Array<[ItemPageState, readonly ItemArtifactKind[]]>).filter(([, ks]) => ks.some((k) => !(k in WIDGET_OF_ARTIFACT)));
  gate('T4 every state row names only artifact kinds the table maps', rowsBad.length === 0, rowsBad.map(([s]) => s).join(','));
  const covered = new Set(Object.values(ARTIFACTS_OF_STATE).flat());
  const orphan = (Object.keys(WIDGET_OF_ARTIFACT) as ItemArtifactKind[]).filter((k) => !covered.has(k));
  gate('T5 every mapped artifact kind is reachable from some machine state (no dead row)', orphan.length === 0, orphan.join(','));
  const widgets = new Set(Object.values(WIDGET_OF_ARTIFACT));
  gate('T6 the whole kit set the owner named is reachable: email · invite · forward · input · decision · deliverable · doc · frame · approval · confirm',
    ITEM_ACTION_WIDGETS.every((w) => widgets.has(w)));
}

// ── A · THE COMPOSITION ─────────────────────────────────────────────────────────────────────────────
console.log('\nA · one composition, every kind × every state');
{
  const bad: string[] = [];
  const pillBad: string[] = [];
  const emphasisBad: string[] = [];
  for (const [kind, k] of Object.entries(KINDS) as Array<[Kind, (typeof KINDS)[Kind]]>) {
    for (const state of STATES) {
      const plan = planOf(k, state, PLAIN_BRIEF);
      const mounted: ItemArtifactsMounted = { ...k.mounts, ...ALWAYS };
      const row = k.gate ? ARTIFACTS_OF_STATE.gate_open : ARTIFACTS_OF_STATE[state];
      const expectArt = row.find((a) => mounted[a] === true) ?? null;
      const ok = expectArt === null ? plan.action === null && plan.artifact === null
        : plan.artifact === expectArt && plan.action === WIDGET_OF_ARTIFACT[expectArt] && ITEM_ACTION_WIDGETS.includes(plan.action!);
      if (!ok) bad.push(`${kind}/${state} → ${plan.action}(${plan.artifact})`);
      if (plan.header.statusPill !== null) pillBad.push(`${kind}/${state}`);
      if (plan.header.doneEmphasis !== (plan.action === 'confirm')) emphasisBad.push(`${kind}/${state}`);
    }
  }
  gate('A1 every kind × state: at most ONE action widget — the table\'s pick for the machine\'s state from what is mounted', bad.length === 0, bad.slice(0, 6).join(' · '));
  gate('A2 the header never carries a status pill (the state speaks through the widget)', pillBad.length === 0, pillBad.join(' · '));
  gate('A3 Done is emphasised ONLY when the widget is the confirm widget', emphasisBad.length === 0, emphasisBad.join(' · '));
  const withdrawn = STATES.map((st) => [st, actionOf({ state: st }, {})] as const).filter(([, a]) => a !== null);
  gate('A4 a withdrawn target renders NO widget (nothing mounted → none, in every state — never a "Review …" button)', withdrawn.length === 0, withdrawn.map(([s]) => s).join(' · '));
  gate('A4b the table covers the owner\'s scenarios: reply → email · forward → forward · document → deliverable · a handoff → approval (input station → input) · looks done → confirm',
    actionOf({ state: 'awaiting_approval' }, { reply_draft: true })?.widget === 'email'
    && actionOf({ state: 'awaiting_approval' }, { forward: true })?.widget === 'forward'
    && actionOf({ state: 'ready' }, { deliverable: true })?.widget === 'deliverable'
    && actionOf({ state: 'ready' }, { document: true })?.widget === 'doc'
    && actionOf({ state: 'ready' }, { frame: true })?.widget === 'frame'
    && actionOf({ state: 'settled' }, { gate: true }, true)?.widget === 'approval'
    && actionOf({ state: 'settled' }, { input_gate: true }, true)?.widget === 'input'
    && actionOf({ state: 'looks_done' }, { looks_done: true })?.widget === 'confirm');

  const lying = claraSentenceOf({ brief: LYING_BRIEF, who: 'Sam', ask: 'send product feedback', title: null });
  gate('A5 Clara never claims a draft / file / prep: the owner\'s paragraph falls back to the item\'s own facts',
    !!lying && !/draft|prepar|attach|file|review|below|I['’]ve/i.test(lying) && /Sam/.test(lying), String(lying));
  const plain = claraSentenceOf({ brief: PLAIN_BRIEF, who: 'Sam', ask: 'x', title: null });
  gate('A6 Clara is ONE sentence — the composition\'s first plain sentence, the rest dropped', plain === 'Sam wants the signed order form before Friday.', String(plain));
  const q = claraSentenceOf({ brief: 'Shall I send it now? It is ready.', who: null, ask: 'send the renewal', title: null });
  gate('A7 a question or an empty composition is not the situation — the facts speak ("Still open: …")', q === 'Still open: send the renewal.', String(q));
  const long = claraSentenceOf({ brief: `${'Sam asked about the rollout plan and the budget and the timeline '.repeat(6)}.`, who: null, ask: null, title: null });
  gate('A8 Clara stays short — clipped at a boundary, declared with "…"', !!long && long.length <= 181 && long.endsWith('…'), String(long?.length));
}

// ── B · THE RENDER ──────────────────────────────────────────────────────────────────────────────────
console.log('\nB · the rendered thread, every kind × every state');
{
  const bad: string[] = [];
  for (const [kind, k] of Object.entries(KINDS) as Array<[Kind, (typeof KINDS)[Kind]]>) {
    for (const state of STATES) {
      const plan = planOf(k, state, LYING_BRIEF);
      const html = renderPage(plan);
      const sources = sourcesIn(html);
      const actions = widgetsIn(html);
      const claraPart = html.split(/data-source="(?:source|event)"/)[0];
      const problems = [
        (sources.length !== 1 || sources[0] !== k.source) && `source ${sources.join(',')} ≠ one ${k.source}`,
        actions.length > 1 && `${actions.length} action widgets`,
        plan.action && actions[0] !== plan.action && `rendered ${actions[0]} ≠ plan ${plan.action}`,
        /Review (?:the |my )?(?:reply )?draft|Review reply/i.test(html) && 'a Review … button',
        /Not yet/.test(html) && '"Not yet"',
        /drafted|my draft/i.test(claraPart.replace(/<[^>]+>/g, ' ')) && 'Clara claims a draft',
        /<button/.test(claraPart) && 'a button in Clara\'s sentence',
      ].filter(Boolean);
      if (problems.length) bad.push(`${kind}/${state}: ${problems.join(', ')}`);
    }
  }
  gate('B1 every fixture renders: ONE source (the event widget for a meeting), ≤1 action widget (the plan\'s), no MOVE / "Review …" button, no "Not yet", no draft claim, no button in Clara\'s words', bad.length === 0, bad.slice(0, 5).join(' · '));

  // ⟲ RE-POINTED (W16.2): rendered through the KIT's renderer as `kind: 'confirm'` (was the bare component).
  const confirm = renderToStaticMarkup(React.createElement(ThreadCardView, { card: { kind: 'confirm', line: 'You replied on Sep 23', onDone: () => {}, onKeep: () => {} } }));
  gate('B2 the confirm widget: the evidence as one plain line + "Mark done" / "Keep open" (plain words, never "Not yet")',
    confirm.includes('You replied on Sep 23') && confirm.includes(`>${CONFIRM_WORDS.done}<`) && confirm.includes(`>${CONFIRM_WORDS.keep}<`) && !/Not yet/.test(confirm)
    && CONFIRM_WORDS.done === 'Mark done' && CONFIRM_WORDS.keep === 'Keep open');
  const settled = renderToStaticMarkup(React.createElement(ThreadCardView, { card: { kind: 'confirm', line: 'You replied on Sep 23', state: 'settled', settledLine: 'Kept open.' } }));
  gate('B3 the confirm widget settles in place — no verbs once answered', !/<button/.test(settled) && settled.includes('Kept open.'));
  const cc = read('components/thread/confirm-card.tsx');
  gate('B4 the confirm widget is presentational kit (no fetch, no router) — the host owns both doors', !/\bfetch\(/.test(cc) && !/useRouter|supabase/.test(cc));
}

// ── C · LOOKS DONE IS MEANINGFUL ────────────────────────────────────────────────────────────────────
console.log('\nC · looks-done only from the same conversation');
{
  const teammateOtherThread: Evidence = { type: 'email', id: 'e9', at: '2026-09-23T09:00:00Z', title: 'Re: Meeting next week to know your products', by: 'teammate', key: 'person', deed: 'message_sent', actor: { role: 'teammate', name: 'Sam' }, threadId: 'other-thread' };
  gate('C1 the owner\'s example: a teammate\'s mail to the same contact on ANOTHER thread never looks done',
    looksDoneEvidenceOf([teammateOtherThread], 'unclear', 'user') === null);
  const userOtherThread: Evidence = { ...teammateOtherThread, by: 'user', actor: { role: 'user' } };
  gate('C2 …nor does the user\'s own mail on another thread with the same counterparty', looksDoneEvidenceOf([userOtherThread], 'promised', 'user') === null);
  const sameThread: Evidence = { ...teammateOtherThread, key: 'object', threadId: 'own-thread' };
  const hit = looksDoneEvidenceOf([teammateOtherThread, sameThread], 'unclear', 'user');
  gate('C3 a deed on the work\'s OWN conversation does (scoped same_conversation)', hit?.scope === 'same_conversation' && hit.id === 'e9');
  const heldPerson: Evidence = { type: 'calendar', id: 'm1', at: '2026-09-03T10:00:00Z', title: 'Intro call', status: 'held', key: 'person', deed: 'meeting_held' };
  gate('C4 a held meeting with the counterparty counts ONLY for a meeting-shaped obligation',
    looksDoneEvidenceOf([heldPerson], 'unclear', 'user') === null
    && looksDoneEvidenceOf([heldPerson], 'unclear', 'user', { meetingShaped: true })?.scope === 'held_meeting');
  gate('C5 entity membership never counts', looksDoneEvidenceOf([{ ...sameThread, key: 'entity' }], 'unclear', 'user') === null);
  gate('C6 a record written before the scoping law (no scope) is not live — the platform heals it at read',
    !looksDoneLive({ sig: 'ee9', refusedSig: null, evidence: {} }) && looksDoneLive({ sig: 'ee9', refusedSig: null, evidence: { scope: 'same_conversation' } }));
  gate('C7 the evidence line is one plain line ("You replied on Sep 23" · "Sam delivered it on Sep 3")',
    looksDoneLine({ type: 'email', id: 'x', at: '2026-09-23T10:00:00Z', by: 'user', name: null, title: 'Re: x', deed: 'message_sent' }) === 'You replied on Sep 23'
    && looksDoneLine({ type: 'document', id: 'y', at: '2026-09-03T10:00:00Z', by: 'teammate', name: 'Sam', title: 'Report', deed: 'deliverable_produced' }) === 'Sam delivered it on Sep 3');
  const settle = read('lib/work/evidence-settle.ts');
  gate('C8 the settle door hands the meeting-shaped signal (the judge\'s schedule verb or the work\'s own words) to the writer',
    /noteLooksDone\([\s\S]{0,200}\{ meetingShaped: schedulingSignal \|\| meetingShaped\(/.test(settle));
}

// ── S · A BOOKED MEETING IS THE DEED (the owner's walk: a call booked + accepted for Sep 30, the page
//        saying "Due" and proposing a NEW invite with only the user on it) ────────────────────────────
console.log('\nS · a booked meeting is scheduled — the event widget, never a new invite');
{
  const NOW = '2026-09-24T12:00:00.000Z';
  const ev = { id: 'ev-booked', start_time: '2026-09-30T10:00:00.000Z', end_time: '2026-09-30T10:30:00.000Z', title: 'Acme x Us // confirmed', timezone: 'Europe/Lisbon',
    attendees: [{ email: 'me@us.example', responseStatus: 'accepted' }, { email: 'sam.lee@acme.example', responseStatus: 'accepted' }, { email: 'kpark@acme.example' }], status: 'confirmed' };
  // The counterparty is stored as NAMES only; the event carries ADDRESSES only.
  const facts = { addresses: [], names: ['sam lee and kim park'], text: 'Join call with Sam Lee and Kim Park — 30 minutes later than originally scheduled', verdictWork: null, afterISO: '2026-09-20T09:00:00.000Z' };
  gate('S1 a stored "A and B" is two name keys; a name key finds an attendee through the attendee\'s own address (first+last, or initial+last)',
    nameKeysOf('Sam Lee and Kim Park').join('|') === 'sam lee|kim park'
    && addressNamesPerson('sam.lee@acme.example', 'sam lee') && addressNamesPerson('kpark@acme.example', 'kim park')
    && !addressNamesPerson('sam@acme.example', 'sam lee') && nameKeysOf('Sam').length === 0);
  gate('S2 the booking is found for a NAME-ONLY counterparty ("join … call" is meeting-shaped) — and a declined or cancelled one is not',
    counterpartyInEvent(ev, facts) && bookedEventFor(facts, [ev], NOW).upcoming?.id === 'ev-booked'
    && !bookedEventFor(facts, [{ ...ev, status: 'cancelled' }], NOW).upcoming
    && !counterpartyInEvent({ ...ev, attendees: [{ email: 'sam.lee@acme.example', responseStatus: 'declined' }] }, facts));
  const inv: PreparedArtifact = { kind: 'invite', title: 'Invite — call', content: 'call', by: null, at: NOW, attachment: null, provenance: null, invite: { title: 'Call', startISO: '2026-09-25T10:00:00.000Z', attendees: ['me@us.example'], proposed: true } } as PreparedArtifact;
  const booked = bookedEventFor(facts, [ev], NOW);
  const st = deriveState({ open: true, verdict: { work: 'schedule' }, judgedAt: NOW, prepared: [inv], liveAsk: false, sentStamp: false, booked, nowISO: NOW });
  gate('S3 THE MACHINE: an upcoming booking moots a staged invite — the state is `scheduled` (its when + the event id), never "ready to send"',
    st.state === 'scheduled' && st.scheduledEventId === 'ev-booked' && scheduledWordOf(st.scheduledLine) === 'scheduled — Wed, Sep 30, 11:00',
    JSON.stringify(st));
  const k = KINDS['booked-call'];
  const plan = composeItemPage({ machine: { state: st.state, line: st.scheduledLine }, mounted: k.mounts, brief: null, who: k.who, ask: k.ask, title: k.title, source: 'source' });
  const html = renderPage(plan);
  gate('S4 the page: the source once + the EVENT widget (the booked meeting) — no invite widget, no "Due"',
    plan.action === 'event' && plan.artifact === 'booked_event' && outlineOf(html).join(',') === 'source source,event widget' && !/Due /.test(html), outlineOf(html).join(','));
  gate('S5 no booking and an invite with nobody on it → NO invite widget (the door does not mount it); the who-ask → the INPUT widget',
    actionOf({ state: 'awaiting_approval' }, {}) === null && actionOf({ state: 'awaiting_input' }, { ask: true })?.widget === 'input');
  const pass = read('lib/prepare/pass.ts');
  const lane = pass.slice(pass.indexOf('async function prepareInviteDraft('), pass.indexOf('const invite = await prepareCalendarInvite('));
  gate('S6 THE INVITE LANE: the booked-deed floor asks the machine\'s ONE booking read over the whole horizon BEFORE any spend, and withdraws a prior unsent invite',
    /const booked = await bookingOf\(admin, userId, isCommit \? 'commitment' : 'inbox', row, \{ work: 'schedule' \}\);/.test(lane)
    && /if \(booked\?\.upcoming\) \{\s*await withdrawUnsentInvite\(admin, userId, w, isCommit, 'booked'\);/.test(lane)
    && lane.indexOf('bookingOf(') < lane.indexOf("import('@/lib/home/prepare-action')"));
  gate('S7 THE ATTENDEE FLOOR: an invite with no counterparty address is never staged — the room asks who (an input_checklist under the engine-ask key); a prior one is regenerated, not kept',
    /if \(!\(await inviteHasCounterparty\(admin, userId, invite\.attendees\)\)\) \{\s*await withdrawUnsentInvite\(admin, userId, w, isCommit, 'no_counterparty'\);\s*await askWhoToInvite\(admin, userId, w\);/.test(pass)
    && /nonLive: untrueInvite \|\| priorNoParty/.test(pass) && /dedupeKey: `requires:\$\{w\.entityId\}`,/.test(pass.slice(pass.indexOf('async function askWhoToInvite(')))
    && /return list\.some\(\(a\) => !isUserForm\(a, forms\)\);/.test(pass));
  const view = read('app/api/items/view/route.ts');
  const detail = read('components/home/item-detail.tsx');
  gate('S8 serve-time: the view serves the booked event id on `scheduled` and `withCounterparty: false` on a lone invite; every door mounts an invite only with a counterparty',
    /eventId: st\.state === 'scheduled' \? st\.scheduledEventId \?\? null : null/.test(view)
    && /a\.kind === 'invite' && inviteParty === false \? \{ withCounterparty: false \}/.test(view)
    && (detail.match(/p\.kind === 'invite' && p\.invite\?\.withCounterparty !== false/g) ?? []).length === 3
    && /if \(view\.machineState\?\.eventId\) mounted\.booked_event = true;/.test(read('components/home/item-rail.tsx')));
  gate('S9 the header subtitle says "scheduled — <when>" and never "Due" on a scheduled item',
    /\{data\?\.dueDate && !scheduled && </.test(detail) && (detail.match(/\{scheduledMetaOf\(view\)\}/g) ?? []).length >= 3);
}

// ── D · THE SOURCE FLOORS ───────────────────────────────────────────────────────────────────────────
console.log('\nD · the surfaces render through the one composition');
{
  const detail = read('components/home/item-detail.tsx');
  const frame = detail.slice(detail.indexOf('function ItemRoomFrame('), detail.indexOf('function DeepDiveShell('));
  const header = frame.slice(frame.indexOf('<header'), frame.indexOf('</header>'));
  gate('D1 the item header: no state pill, no face pile, no project chip, no membership chip — back · title · subtitle · Details · Done · Dismiss · ⋯',
    !!header && !/room\.stateWord|stateTone|<FacePile|room\.project|room\.membership/.test(header)
    && /<BackLink/.test(header) && /room\.title/.test(header) && /room\.meta/.test(header) && /FILED_LABEL/.test(header)
    && /<ResolveGroup resolve=\{room\.resolve\} \/>/.test(header) && /room\.verbs\.length > 0/.test(header));
  gate('D2 no evidence banner: the looks-done strip and its "Not yet" are gone from the item page',
    !/LooksDoneStrip|room\.confirm|>Not yet</.test(detail));
  gate('D3 project linking lives in Details (the drawer\'s Project section)',
    /id: 'project', label: 'Project'/.test(frame) && /sections=\{projectSection \? \[projectSection, \.\.\.tabs\] : tabs\}/.test(frame));
  gate('D4 every kind mounts the confirm widget through ITS OWN done door, and emphasises Done only on it',
    /confirmArtifactOf\(emailConfirm\)/.test(detail) && /looksDoneConfirmOf\(view, 'inbox', id, markHandled\)/.test(detail)
    && /confirmArtifactOf\(commitConfirm\)/.test(detail) && /looksDoneConfirmOf\(view, 'commitment', id, \(\) => act\('done'\)\)/.test(detail)
    && /confirmArtifactOf\(followConfirm\)/.test(detail) && /looksDoneConfirmOf\(view, 'commitment', id, \(\) => resolveFollowUp\('done'\)\)/.test(detail)
    && (detail.match(/emphasis: doneEmphasisOf\(view, /g) ?? []).length === 3 && !/resolveEmphasisOf/.test(detail));
  gate('D5 every mounted action card declares the ARTIFACT it renders (the table maps it to its kit widget) — and the handoff gate / meeting event ride the rail as the gate / event widget',
    /artifactKind: 'reply_draft' as const/.test(detail) && /artifactKind: 'nudge_draft' as const/.test(detail)
    && (detail.match(/artifactKind: 'invite' as const/g) ?? []).length === 3 && /artifactKind: 'forward' as const/.test(detail)
    && /artifactKind: leadArts\[0\]\.kind as ItemArtifactKind/.test(detail) && /artifactKind: 'looks_done' as const/.test(detail)
    && /gate=\{gateStanding && gateNode \? \{ kind: handoff\?\.gateKind === 'input' \? 'input_gate' : 'gate', node: gateNode \} : null\}/.test(detail)
    && /<EventCard pointer=\{\{ eventId: view\.sourceMeeting\.addressId \}\} \/>/.test(detail)
    && !/widget: '/.test(detail));
  const rail = read('components/home/item-rail.tsx');
  const block = rail.slice(rail.indexOf('const itemPage = inRoom ? null'), rail.indexOf('THE OPENING IS A MESSAGE (owner walk'));
  gate('D6 the rail\'s item door renders through the ONE composition — and no MOVE, offer, gap line or folded ask',
    /composeItemPage\(\{/.test(block) && /items\.push\(\.\.\.itemPageItems\(plan, \{/.test(block)
    && !/moveCard|ctaOffer|gapLine|foldedAsk|mergedArt|pinnedNode/.test(block)
    && /if \(!itemPage\) items\.push\(\{\s*type: 'pinned'/.test(rail)
    && /if \(!itemPage && liftedAsk && !foldedAsk\)/.test(rail) && /if \(!itemPage && decision && decision\.options\.length >= 2\)/.test(rail)
    && /if \(!itemPage\) visibleTail\.forEach/.test(rail) && /if \(!itemPage\) endArtifacts\.forEach/.test(rail));
  gate('D7 a widget is offered only when its card is MOUNTED on the page (the table picks from mounted artifacts only)',
    /for \(const a of artifacts \?\? \[\]\) if \(a\.artifactKind && a\.node\) mounted\[a\.artifactKind\] = true;/.test(block)
    && /if \(gate\?\.node\) mounted\[gate\.kind\] = true;/.test(block));
  const view = read('app/api/items/view/route.ts');
  gate('D8 serve-time control truth: the item door serves NO move and NO offers (a control not served cannot be dead at click)',
    /const looseMove = null;/.test(view) && /move: looseMove,/.test(view) && /offers: looseOffers,/.test(view));
}

// ── W · ONE SET OF WORDS (W16.2) ────────────────────────────────────────────────────────────────────
console.log('\nW · the Home row and the confirm widget share their words — one home');
{
  const home = read('components/home/home-view.tsx');
  const cc = read('components/thread/confirm-card.tsx');
  const whisper = home.slice(home.indexOf('function WhisperLine('), home.indexOf('THE HOVER FLOOR'));
  gate('W1 ONE home: lib/evidence/looks-done-word.ts holds CONFIRM_WORDS; the item page re-exports the SAME object',
    WORDS_HOME === CONFIRM_WORDS && WORDS_HOME.done === 'Mark done' && WORDS_HOME.keep === 'Keep open'
    && /export const CONFIRM_WORDS = \{ done: 'Mark done', keep: 'Keep open' \} as const;/.test(read('lib/evidence/looks-done-word.ts'))
    && !/export const CONFIRM_WORDS =/.test(read('components/thread/item-page.ts')));
  gate('W2 the Home row\'s looks-done pair and the kit widget both print CONFIRM_WORDS from that home (never their own literals)',
    /import \{ LOOKS_DONE_WORD, CONFIRM_WORDS \} from '@\/lib\/evidence\/looks-done-word';/.test(home)
    && />\{CONFIRM_WORDS\.done\}<\/button>/.test(whisper) && />\{CONFIRM_WORDS\.keep\}<\/button>/.test(whisper)
    && /onClick=\{refuse\}/.test(whisper) && /refuseLooksDoneOnRow\(item\)/.test(whisper)
    && /import \{ CONFIRM_WORDS \} from '@\/lib\/evidence\/looks-done-word';/.test(cc)
    && />\{CONFIRM_WORDS\.done\}</.test(cc) && />\{CONFIRM_WORDS\.keep\}</.test(cc)
    && !/>(?:Done|Not yet|Mark done|Keep open)</.test(whisper) && !/>(?:Mark done|Keep open)</.test(cc));
  // Every UI file: "Not yet" never appears as rendered text or a string literal (comments aside; the
  // held list's "Not yet judged" is a different fact and is allowed).
  const files: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(join(process.cwd(), dir))) { const p = join(dir, f); if (statSync(join(process.cwd(), p)).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
  walk('components'); walk('app');
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const hits = files.filter((f) => /(>\s*Not yet\s*<|['"`]Not yet(?! judged)[^'"`]*['"`])/.test(stripComments(read(f))));
  gate('W3 NO "Not yet" in any UI (components/ · app/) — the looks-done refusal is "Keep open" everywhere', hits.length === 0, hits.join(', '));
}

// ── F · CLARA'S FALLBACK IS DIRECTION-TRUE (W16.2) ──────────────────────────────────────────────────
console.log('\nF · the fallback sentence is direction-true, from the item\'s own facts');
{
  // Fixtures: the SAME words, four origins, derived from the item's own data (no AI).
  const fx = {
    own: originOf({ kind: 'commitment', source: 'email', direction: 'you_owe', authoredByUser: true }),
    theirs: originOf({ kind: 'commitment', source: 'email', direction: 'you_owe', authoredByUser: false }),
    inbox: originOf({ kind: 'inbox_item', source: 'email', hasSender: true }),
    awaiting: originOf({ kind: 'commitment', source: 'email', direction: 'awaiting', authoredByUser: false }),
    meeting: originOf({ kind: 'commitment', source: 'meeting', direction: 'you_owe' }),
    meetingInbox: originOf({ kind: 'inbox_item', source: 'meeting', hasSender: false }),
    unknown: originOf({ kind: 'commitment', source: 'email', direction: 'you_owe', authoredByUser: null }),
  };
  gate('F1 the origin comes from the item\'s own data: own sent mail → own_promise · received → their_ask · awaiting → awaiting · meeting → meeting · unread → none',
    fx.own === 'own_promise' && fx.theirs === 'their_ask' && fx.inbox === 'their_ask' && fx.awaiting === 'awaiting'
    && fx.meeting === 'meeting' && fx.meetingInbox === 'meeting' && fx.unknown === null, JSON.stringify(fx));
  const say = (origin: typeof fx.own, who: string | null, ask: string) => claraSentenceOf({ brief: null, who, ask, title: null, origin });
  const own = say(fx.own, 'Acme', 'share the updated report');
  const ownNamed = say(fx.own, 'Sam Lee', 'join the call with Sam Lee 30 minutes later');
  const theirs = say(fx.theirs, 'Sam', 'send the signed order form');
  const awaiting = say(fx.awaiting, 'Acme', 'send the pricing');
  const meeting = say(fx.meeting, 'Sam', 'send the recap');
  gate('F2 the user\'s OWN promise: "You told <X> you\'d …" (or "You said you\'d …") — never "<X> is asking you to …"',
    own === "You told Acme you'd share the updated report." && ownNamed === "You said you'd join the call with Sam Lee 30 minutes later.", `${own} | ${ownNamed}`);
  gate('F3 the counterparty\'s ask: "<X> asked you to …"; our own framing is never put in their mouth',
    theirs === 'Sam asked you to send the signed order form.' && say(fx.theirs, 'Sam', 'decide whether to engage') === 'From Sam — decide whether to engage.', String(theirs));
  gate('F4 awaiting: "Waiting on <X> to …" · meeting: "From the meeting: …"',
    awaiting === 'Waiting on Acme to send the pricing.' && meeting === 'From the meeting: send the recap.', `${awaiting} | ${meeting}`);
  const all = [own, ownNamed, awaiting, meeting, say(null, 'Sam', 'send the deck')];
  gate('F5 no origin, or any non-ask origin → no "asking you / asked you" claim; each is ONE short sentence with no claim',
    all.every((l) => !!l && !/asking you|asked you/.test(l!) && (l!.match(/[.!?](\s|$)/g) ?? []).length === 1 && !/draft|prepar|below|I['’]ve/i.test(l!))
    && fallbackOpeningLine({ who: 'Sam', ask: 'Send the deck' }) === 'From Sam — send the deck.', all.join(' | '));
  const view = read('app/api/items/view/route.ts');
  const rail = read('components/home/item-rail.tsx');
  gate('F6 the facts are served, not guessed: the view reads the source\'s authorship through THE ONE SOURCE READER, the row\'s direction, and serves `anchor.origin`; the rail hands it to both fallback seats',
    /const \{ emailSourceOf \} = await import\('@\/lib\/commitments\/source'\);[\s\S]{0,200}\?\.authoredByUser \?\? null;/.test(view)
    && /const anchorOrigin = originOf\(\{/.test(view) && /anchor: \{ \.\.\.anchor, origin: anchorOrigin \},/.test(view)
    && /thread_id, direction'/.test(read('lib/room/item-anchor.ts'))
    && /origin: view\.anchor\?\.origin \?\? null,/.test(rail) && /preparedClause: prep, origin: a\?\.origin \?\? null \}\)/.test(rail)
    && !/getAIClient|aiCreate/.test(read('lib/room/opening-fallback.ts')));
}

// ── K · CONFIRM IS A REAL KIT WIDGET (W16.2) ────────────────────────────────────────────────────────
console.log('\nK · the confirm widget is a first-class kit kind');
{
  const types = read('components/thread/types.ts');
  const cards = read('components/thread/thread-cards.tsx');
  const cat = read('app/(main)/dev/thread-preview/preview-catalogue.tsx');
  const detail = read('components/home/item-detail.tsx');
  const page = read('components/thread/item-page.ts');
  gate('K1 `confirm` is in the contract: ThreadCardKind, THREAD_CARD_KINDS, and its own card interface over AnswerableState',
    (THREAD_CARD_KINDS as string[]).includes('confirm') && /ThreadCardKind =[\s\S]{0,260}'confirm'/.test(types)
    && /export interface ConfirmWidgetCard extends CardBase \{\n  kind: 'confirm';[\s\S]{0,80}state\?: AnswerableState;/.test(types)
    && /\| ConfirmWidgetCard \|/.test(types));
  gate('K2 the kit\'s renderer draws it (case \'confirm\' → ConfirmCard) — the same words, the same three states',
    /case 'confirm': \{[\s\S]{0,160}<ConfirmCard \{\.\.\.props\} \/>/.test(cards) && /import \{ ConfirmCard \} from '\.\/confirm-card';/.test(cards));
  const sec = cat.slice(cat.indexOf("\n    section: 'confirm',"), cat.indexOf("\n    section: 'custom',"));
  gate('K3 the catalogue specimens it in every state (open · busy · settled)',
    sec.length > 0 && ['open', 'busy', 'settled'].every((st) => new RegExp(`kind: 'confirm'[^}]*state: '${st}'`).test(sec)));
  gate('K4 the product PRODUCES it: item-detail composes `kind: \'confirm\'` (confirmCardOf) and hands it as the artifact\'s card',
    /function confirmCardOf\(confirm: LooksDoneConfirm\): ConfirmWidgetCard/.test(detail) && /kind: 'confirm', id: 'confirm', line: confirm\.line,/.test(detail)
    && /artifactKind: 'looks_done' as const, card,/.test(detail) && !/function ConfirmHost/.test(detail));
  const plan = composeItemPage({ machine: { state: 'looks_done', line: 'You replied on Sep 23' }, mounted: { looks_done: true }, brief: null, who: 'Sam', ask: 'x', title: null, source: 'source' });
  const items = itemPageItems(plan, { seat: SEAT, action: { card: CONFIRM_CARD, node: 'ignored' } });
  const kinds = items.flatMap((i) => ('cards' in i && i.cards ? i.cards.map((c) => c.kind) : []));
  const html = renderToStaticMarkup(React.createElement(ThreadTimeline, { items }));
  gate('K5 the item page routes it through the kind — never the custom slot (a confirm plan with only a node renders nothing)',
    kinds.join(',') === 'confirm' && /data-widget="confirm"/.test(html) && html.includes('You replied on Sep 23')
    && actionCardOf(plan, { node: 'x' }) === null && /cards: \[card\],/.test(page)
    && /if \(!c \|\| c\.kind !== 'confirm'\) return null;/.test(page), kinds.join(','));
  const rail = read('components/home/item-rail.tsx');
  gate('K6 the rail hands the artifact\'s card to the one composition',
    /action: actionNode \|\| card\?\.card \? \{ node: actionNode, card: card\?\.card \?\? null, by: card\?\.by \?\? null \} : null,/.test(rail));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
// The three owner-facing scenarios, top to bottom (printed for the report; not gated).
if (process.argv.includes('--print')) {
  const scenarios: Array<[string, Kind, string]> = [
    ['reply prepared', 'email', 'awaiting_approval'], ['needs input', 'email', 'awaiting_input'], ['looks done', 'email', 'looks_done'],
    ['forward prepared', 'forward', 'awaiting_approval'], ['document ready', 'deliverable', 'ready'], ['handoff gate', 'handoff', 'settled'],
    ['meeting-born commitment', 'meeting-commitment', 'awaiting_approval'], ['scheduled', 'invite', 'scheduled'],
    ['booked call (the owner\'s case)', 'booked-call', 'scheduled'],
  ];
  for (const [name, kind, state] of scenarios) {
    const plan = planOf(KINDS[kind], state, LYING_BRIEF);
    const html = renderPage(plan);
    console.log(`\n${name} (${kind}, ${state}): header [back · title · subtitle · Details · Done${plan.header.doneEmphasis ? ' (emphasised)' : ''} · Dismiss · ⋯] · Clara "${plan.clara}" · ${outlineOf(html).join(' · ')}`);
  }
}
if (fail > 0) process.exit(1);
