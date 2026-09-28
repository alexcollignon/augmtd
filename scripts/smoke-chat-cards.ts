// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W20.B · A CLAIM RENDERS IN EVERY CHAT · SHOW THE WORK · THE SCHEDULE OFFER · TIME ZONES.
// ZERO AI, ZERO network, no data (the core is stubbed; the DB is in memory).
//
// THE INCIDENT (owner walk, Sep 28): on an item page "can you send an invite for it?" → the core
// prepared the invite and said "Here's the invite. Review it and send when it looks right." — and no
// card rendered (the item door wrote three card kinds and dropped the rest). The room showed a generic
// "Working on it…" while the Home chat narrates each tool. The counterparty had stated "Oct 12,
// 9.30 AM CET" for the call and nothing offered an invite (the item was judged "chase"); the chat-born
// invite stored 08:30Z although Paris is on summer time that day (07:30Z).
//
//   A · ONE TABLE, BOTH DOORS: steer persists + returns invite / email draft / bulk deed (fake client,
//       stubbed core), exactly once; the Home door writes the same component (tests/unit/chat-cards).
//   B · THE INVERSE GATE: the card-bearing fields the core returns == the table both doors write ==
//       the kinds both chat surfaces hydrate and render (a new field fails until classified).
//   C · THE RAIL RENDERS THE SAME CARDS as Home, through ONE renderer (rendered, not grepped).
//   D · A CLAIM WITHOUT A CARD is re-worded at the ONE answer door.
//   E · THE WORK SHOWS: steer streams THE ONE STREAM; the rail's in-flight line speaks the label and
//       reserves the card's shape.
//   F · THE SCHEDULE OFFER: a future stated meeting time → an invite beside the verdict's work; not
//       otherwise; idempotent; the page leads with it (tests/unit/schedule-offer).
//   G · TIME ZONES: CET/CEST/WET/BST/EST resolve through the region on the date (tests/unit/zoned-time).
// Run: npx tsx scripts/smoke-chat-cards.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  CARD_TURN_FIELDS, CARD_COMPONENT_KEY, CARD_PROGRESS, cardTurnOf, chatCardsOfComponent, widgetOfProgress,
  claimFloorSay, CLAIM_WITHOUT_CARD_LINE,
} from '../lib/present/turn-card';
import { chatCardNodes } from '../components/home/chat-cards';
import { sseFrame } from '../lib/present/converse-stream';
import { splitSseFrames } from '../components/home/ask-stream-read';
import { correctStatedZone } from '../lib/core/zoned-time';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
(globalThis as { React?: unknown }).React = React;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = (node: React.ReactNode) =>
  renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(React.Fragment, null, node)));
const vitest = (file: string): { good: boolean; out: string } => {
  let out = '';
  try {
    out = execSync(`npx vitest run ${file}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { good: /Tests\s+\d+ passed/.test(out) && !/failed/.test(out), out };
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); return { good: false, out }; }
};
const failLines = (out: string) => out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | ');

const steer = src('app/api/items/steer/route.ts');
const home = src('app/api/home/ask/route.ts');
const rail = src('components/home/item-rail.tsx');
const homeAsk = src('components/home/home-ask.tsx');
const core = src('lib/converse/index.ts');

console.log('\nA · ONE TABLE, BOTH DOORS (outcome — the doors run over an in-memory DB, core stubbed)');
{
  const r = vitest('tests/unit/chat-cards.test.ts');
  ok('A1 steer returns AND persists invite / email draft / bulk deed as card turns (exactly once — a duplicate delivery writes nothing); a plain answer stays a plain row; the Home door writes the identical component; the stream carries progress then done',
    r.good, failLines(r.out));
  ok('A2 both doors write and forward through the ONE table (no hand-kept component switch left in either)',
    /cardTurnOf\(turn\)/.test(steer) && /cardPayloadOf\(turn\)/.test(steer) && /normalizeTurnCards\(turn\)/.test(steer)
    && /cardTurnOf\(turn\)/.test(home) && /cardPayloadOf\(turn\)/.test(home) && /normalizeTurnCards\(turn\)/.test(home)
    && !/'invite_card'|'email_draft_card'|'bulk_deed_card'|collectionTurnComponent|eventTurnComponent|changeTurnComponent/.test(steer + home));
}

console.log('\nB · THE INVERSE GATE — returned == persisted == rendered');
{
  // Every field of the core's turn type is classified: a CARD (the table) or a known non-card surface.
  const block = core.slice(core.indexOf('export type ConverseTurn = {'), core.indexOf('\n};', core.indexOf('export type ConverseTurn = {')));
  const fields = [...block.matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
  const NON_CARD = ['say', 'refs', 'files', 'applied', 'draft', 'learned', 'entityName', 'delegated', 'commit', 'openStage', 'options', 'workflowDraft', 'artifact', 'artifacts'];
  const unclassified = fields.filter((f) => !NON_CARD.includes(f) && !(CARD_TURN_FIELDS as readonly string[]).includes(f));
  ok('B1 every ConverseTurn field is either a card in the ONE table or a known non-card surface', fields.length > 10 && unclassified.length === 0, `unclassified: ${unclassified.join(', ')}`);
  ok('B2 every card in the table is a field the core returns', CARD_TURN_FIELDS.every((f) => fields.includes(f)));
  ok('B3 every table row has its own durable key (no two kinds share a key)', new Set(Object.values(CARD_COMPONENT_KEY)).size === CARD_TURN_FIELDS.length);
  const samples: Record<string, unknown> = {
    invite: { id: 'i1', invite: { title: 'Implementation call', startISO: '2026-10-12T07:30:00.000Z', endISO: '2026-10-12T08:00:00.000Z', attendees: ['sam@acme.test'], timezone: 'Europe/Lisbon' } },
    bulkDeed: { id: 'b1', deed: {} },
    emailDraft: { id: 'e1', itemId: 'item-1' },
    collection: { id: 'c1', spec: { kind: 'documents', framing: 'One document.', rows: [{ id: 'r', title: 'Terms' }] } },
    event: { id: 'ev1', spec: { id: 'ev1' } },
    change: { id: 'ch1', spec: { id: 'ch1' } },
  };
  const renderedKinds = CARD_TURN_FIELDS.filter((f) => {
    const card = cardTurnOf({ [f]: samples[f] } as never);
    return !!card && chatCardNodes(chatCardsOfComponent(card.component), 'k').length === 1;
  });
  ok('B4 every table kind round-trips server component → client hydrator → ONE rendered card', renderedKinds.length === CARD_TURN_FIELDS.length,
    `rendered: ${renderedKinds.join(', ')}`);
  ok('B5 both chat surfaces hydrate and paint through the ONE client half (Home + rail)',
    /chatCardsOfComponent\(/.test(homeAsk) && /chatCardsOfPayload\(/.test(homeAsk) && /chatCardNodes\(/.test(homeAsk)
    && /chatCardsOfComponent\(/.test(rail) && /chatCardsOfPayload\(/.test(rail) && /chatCardNodes\(/.test(rail));
  ok('B6 neither surface keeps a private render of a chat card kind',
    !/<InviteCard|<BulkDeedCard|<CollectionCard|<ChangeCard/.test(homeAsk + rail) && !/key === 'invite_card'|key === 'email_draft_card'|key === 'bulk_deed_card'|key === 'collection_card'|key === 'change_card'/.test(homeAsk + rail));
}

console.log('\nC · THE RAIL RENDERS THE SAME CARDS (rendered)');
{
  const cards = chatCardsOfComponent(cardTurnOf({ invite: { id: 'i1', invite: { title: 'Implementation call', startISO: '2026-10-12T07:30:00.000Z', endISO: '2026-10-12T08:00:00.000Z', attendees: ['sam@acme.test'], timezone: 'Europe/Lisbon' } } } as never)!.component);
  const nodes = chatCardNodes(cards, 'k');
  const html = render(nodes.map((n) => React.createElement('div', { key: n.id }, n.node)));
  // The card seeds its fields from the stored payload on mount (an effect — SSR shows its frame), so
  // the gate asserts the frame renders AND the mounted card is handed exactly the stored payload.
  const handed = (nodes[0]?.node as React.ReactElement<{ chat?: { inviteId: string; invite: { title?: string; attendees?: string[] } } }> | undefined)?.props?.chat;
  ok('C1 a rehydrated invite turn mounts the invite card with the stored payload (its time selector renders)',
    /role="radiogroup"/.test(html) && handed?.inviteId === 'i1' && handed?.invite.title === 'Implementation call'
    && handed?.invite.attendees?.[0] === 'sam@acme.test', html.slice(0, 160));
  const mail = render(chatCardNodes({ emailDrafts: [{ emailId: 'e1', draft: { to: ['sam@acme.test'], subject: 'Re: terms', body: 'Hi Sam, the terms are attached.' } as never }] }, 'k').map((n) => React.createElement('div', { key: n.id }, n.node)));
  ok('C2 a standalone email draft renders the email card with its words', /the terms are attached/.test(mail), mail.slice(0, 160));
  const bulk = render(chatCardNodes({ bulkDeeds: [{ deedId: 'b1' }] }, 'k').map((n) => React.createElement('div', { key: n.id }, n.node)));
  ok('C3 a bulk deed renders its host (it re-reads the stored deed)', bulk.length > 0);
  ok('C4 the rail mounts the renderer in the turn body and a card turn is never narration',
    /cardNodes\.map\(\(c\) => <div key=\{c\.id\} className="mt-1\.5">\{c\.node\}<\/div>\)/.test(rail)
    && /hasCards\(t\.cards\)/.test(src('components/home/room-chat.ts')));
}

console.log('\nD · A CLAIM WITHOUT A CARD DOES NOT SERVE');
{
  ok('D1 "Here\'s the invite…" with nothing attached → the honest line', claimFloorSay({ say: "Here's the invite. Review it and send when it looks right.", refs: [] }) === CLAIM_WITHOUT_CARD_LINE);
  ok('D2 the same words with the card attached stand', claimFloorSay({ say: "Here's the invite.", refs: [], invite: { id: 'i', invite: {} } }) === "Here's the invite.");
  ok('D3 the floor sits at THE ONE answer door (every chat reads its answer through it)', /if \(turn\?\.say\) turn\.say = claimFloorSay\(turn\);/.test(core));
}

console.log('\nE · THE WORK SHOWS — one stream, the live label, the reserved shape');
{
  const { events } = splitSseFrames(sseFrame({ type: 'progress', label: CARD_PROGRESS.prepare_calendar_invite.label }) + sseFrame({ type: 'done', say: 'x' }));
  ok('E1 the wire round-trips (progress, then done)', (events as Array<{ type: string }>).map((e) => e.type).join(',') === 'progress,done');
  // ⟲ RE-POINTED W22: the item door streams the answer's TOKENS too (the Home door's `token` frames).
  ok('E2 both doors answer over THE ONE STREAM', /converseStreamResponse\(/.test(steer) && /converseStreamResponse\(/.test(home) && /onProgress: \(label\) => send\(\{ type: 'progress', label \}\)/.test(home) && /answer\(\(label\) => send\(\{ type: 'progress', label \}\)(?:, \(t\) => send\(\{ type: 'token', t \}\))?\)/.test(steer));
  ok('E3 the rail asks for the stream and reads it through the ONE reader',
    /stream: true/.test(rail) && /readConverseStream\(res,/.test(rail) && /readConverseStream\(res,/.test(homeAsk));
  ok('E4 the in-flight line speaks the live label; a card being made reserves its own shape',
    /line: stage \?\? 'Working on it…'/.test(rail) && /widgetOfProgress\(stage\)/.test(rail) && /<PreparingShape shape=\{makingWidget\}/.test(rail));
  ok('E5 the card-producing labels are ONE table (the core spreads it) and name their widget',
    /Object\.fromEntries\(Object\.entries\(CARD_PROGRESS\)/.test(core) && widgetOfProgress('Putting the invite together…') === 'invite'
    && widgetOfProgress('Searching your files…') === null);
}

console.log('\nF · THE SCHEDULE OFFER (outcome)');
{
  const r = vitest('tests/unit/schedule-offer.test.ts');
  ok('F1 a future stated meeting time → an invite at the stated region\'s instant; idempotent; not over a booking, another invite, quoted history or a past time; withdrawn when the thread moves; the page leads with it (one widget); a claim without a card is re-worded',
    r.good, failLines(r.out));
  const pass2 = src('lib/prepare/pass.ts');
  ok('F2 the pass runs the offer BESIDE the verdict\'s lane (inbox, not schedule/none)',
    /verdict\.work !== 'schedule' && verdict\.work !== 'none'\) \{\s*\n\s*try \{\s*\n\s*const \{ prepareScheduleOffer \}/.test(pass2));
  ok('F3 the verdict\'s hygiene keeps the offer (it is not the verdict\'s lane)',
    /\.offer !== 'stated_time'\) contradicting\.push\('prepared_invite'\)/.test(src('lib/work/apply-verdict.ts')));
  ok('F4 the item page seats the offer as its ONE widget', /lead: kind === 'email' && mounted\.invite \? 'invite' : null/.test(rail)
    && /lead && row\.includes\(lead\) && mounted\[lead\] === true/.test(src('components/thread/item-page.ts')));
}

console.log('\nG · TIME ZONES (DST-true)');
{
  const r = vitest('tests/unit/zoned-time.test.ts');
  ok('G1 CET/CEST/WET/WEST/GMT/BST/EST/EDT resolve through the region ON THE DATE across every DST edge', r.good, failLines(r.out));
  ok('G2 the incident: "Oct 12, 9.30 am CET" → 07:30Z (not 08:30Z)', correctStatedZone('2026-10-12T08:30:00.000Z', 'Oct 12, 9.30 am CET', 'Europe/Lisbon') === '2026-10-12T07:30:00.000Z');
  ok('G3 the invite grounding applies the zone floor to the slot and its alternatives',
    (src('lib/home/prepare-action.ts').match(/correctStatedZone\(/g) ?? []).length >= 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
