/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ONE DECISION PER SCREEN (stabilization W15.3, Sep 24 — docs/laws-registry.md
 * `one-decision-per-screen`).
 *
 * Owner walk on "When you're ready": the one-at-a-time card is preferred ("why not this as only
 * option"); the card first painted short, then the evidence landed and pushed Dismiss/Done down;
 * "no expansion beyond a viewport height — I don't want the user to scroll for the buttons".
 *
 * ZERO-AI, zero DB, zero network: server renders of the REAL deck (effects never run, so no read
 * fires) + source floors for the lens's default and the keyboard. Exit 1 on any failure.
 *   npx tsx scripts/smoke-decision-card.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { TriageDeck, TriageDeckSkeleton, type TriageRow } from '../components/triage/triage-deck';
import {
  DecisionCardFrame, DecisionCardSkeleton, DECISION_CARD_H, DECISION_ACTIONS_H,
} from '../components/triage/decision-frame';
import { initialWaitingShape, DEFAULT_WAITING_SHAPE } from '../lib/triage/view-shape';
import { TRIAGE_KEYS, TRIAGE_VIEW_ALL, TRIAGE_ONE_AT_A_TIME } from '../lib/triage/words';
import type { DoItem } from '../lib/home/agenda';
import { buildHeldLedger, whyHeldOf, HELD_BANDS, HELD_CLASS_ORDER, type HeldFacts, type HeldClassId, type ItemPageTruth } from '../lib/home/attention';
import { heldIntro, rowWhyOf, ROW_JARGON, ROW_WHY_WORDS, sentenceCase } from '../lib/home/held-words';
import { TRIAGE_SOURCE_WORD, TRIAGE_READY_WORDS, readyWordOf } from '../lib/triage/words';
import {
  receiptKindOfItem, composeItemPage, ARTIFACTS_OF_STATE, PAGE_PREPARED_KINDS, type ItemPageState, type ItemArtifactsMounted,
} from '../components/thread/item-page';

// tsx compiles JSX with the classic runtime (tsconfig `jsx: preserve`), so the rendered components
// resolve `React` at call time — hand them the one instance (the vitest tier uses the automatic runtime).
(globalThis as unknown as { React: typeof React }).React = React;

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = (el: React.ReactElement) =>
  renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, el));
const item = (source: DoItem['source'], id: string): DoItem => ({ source, key: `${source}:${id}`, entityId: id, href: `/item/${id}`, ask: 'Reply to Sam' });
const row = (id: string, source: DoItem['source'], excerpt: string | null, title = 'The quarterly numbers'): TriageRow => ({
  id, item: item(source, id), who: 'Sam at Acme', title, why: 'waiting on you', excerpt, dueDate: null, prepared: null, cls: null,
});
const deck = (rows: TriageRow[], extra: Record<string, unknown> = {}) =>
  render(React.createElement(TriageDeck, { rows, today: '2026-09-24', onExit: noop, ...extra }));
const classOf = (html: string, attr: string): string | null => html.match(new RegExp(`<[a-z]+ ${attr}[^>]*class="([^"]+)"`))?.[1] ?? null;
const LONG = Array.from({ length: 400 }, (_, i) => `Line ${i} of a long thread.`).join('\n');

// ═══ D1 · THE DOOR OPENS ONE AT A TIME ═══
console.log('\nD1 · "When you\'re ready" opens the card; the list is the secondary "View all"');
{
  const held = code('components/home/held-quiet.tsx');
  gate('D1.1 the default shape is the card', DEFAULT_WAITING_SHAPE === 'deck'
    && initialWaitingShape({ fromHome: false, stored: null }) === 'deck');
  gate('D1.2 the Home door ALWAYS opens the card (a past "View all" never surprises the door)',
    initialWaitingShape({ fromHome: true, stored: 'list' }) === 'deck');
  gate('D1.3 an address that names the lens honours the per-viewer choice (browser storage only)',
    initialWaitingShape({ fromHome: false, stored: 'list' }) === 'list');
  gate('D1.4 the lens reads its shape through that one rule, with the recorded origin, in an EFFECT',
    /initialWaitingShape\(\{ fromHome, stored: loadLS<WaitingShape>\(VIEW_KEY\) \}\)/.test(held)
    && /useEffect\(\(\) => \{ setShape\(loadShape\(fromHome\)\); \}, \[\]\);/.test(held)
    && /useState<WaitingShape>\('deck'\)/.test(held));
  gate('D1.5 the list still exists behind "View all" (and returns by "One at a time")',
    TRIAGE_VIEW_ALL === 'View all' && TRIAGE_ONE_AT_A_TIME === 'One at a time'
    && /shape === 'deck' \? TRIAGE_VIEW_ALL : TRIAGE_ONE_AT_A_TIME/.test(held)
    && /onViewAsList=\{\(\) => chooseShape\('list'\)\}/.test(held)
    && />View all</.test(deck([row('v', 'reply', 'Hi.')], { onViewAsList: noop })));
  gate('D1.6 the persisted choice goes through the try/catch cache (never raw localStorage)',
    /saveLS\(VIEW_KEY, s\)/.test(held) && !/localStorage\./.test(held));
}

// ═══ D2 · ONE GEOMETRY ═══
console.log('\nD2 · the card\'s outer height is one constant, whatever it holds');
{
  const renders = {
    short: deck([row('a', 'reply', 'Short.')]),
    long: deck([row('b', 'reply', LONG, 'A very long title '.repeat(30))]),
    loading: deck([row('c', 'reply', null)]),
    commitment: deck([row('d', 'commitment', null)]),
    notice: deck([row('e', 'notice', 'An automated notice.')]),
    deal: deck([row('f', 'deal', null)]),
  };
  const cls = Object.fromEntries(Object.entries(renders).map(([k, h]) => [k, classOf(h, 'data-decision-card')]));
  gate('D2.1 every render carries the decision card', Object.values(cls).every((c) => !!c && c.includes(DECISION_CARD_H)), JSON.stringify(cls));
  gate('D2.2 short, long, loading and every kind share ONE outer class (same height)', new Set(Object.values(cls)).size === 1);
  gate('D2.3 the height is a HEIGHT that fits the viewport (not a floor, not a cap)',
    /^h-\[clamp\(\d+px,calc\(100dvh_-_\d+px\),\d+px\)\]$/.test(DECISION_CARD_H)
    && !/(^|\s)(min-h|max-h)-/.test(cls.short ?? ''));
  gate('D2.4 long content stays in the DOM (it scrolls inside; nothing is clipped away)', renders.long.includes('Line 399 of a long thread.'));
  gate('D2.5 the card hides its overflow and its body is the one scroll region',
    (cls.short ?? '').includes('overflow-hidden')
    && /overflow-y-auto/.test(classOf(renders.long, 'data-decision-scroll') ?? '')
    && /min-h-0 flex-1/.test(classOf(renders.long, 'data-decision-scroll') ?? ''));
  gate('D2.6 the head is bounded (title and why clamp)',
    /line-clamp-2 px-5 text-\[15px\]/.test(src('components/triage/triage-deck.tsx'))
    && /line-clamp-2 px-5 text-\[12px\]/.test(src('components/triage/triage-deck.tsx')));
}

// ═══ D3 · THE ACTIONS ARE PINNED ═══
console.log('\nD3 · the action row is pinned outside the scroll region');
{
  const html = deck([row('p', 'reply', LONG)]);
  const cardAt = html.indexOf('data-decision-card');
  const scrollAt = html.indexOf('data-decision-scroll');
  const actionsAt = html.indexOf('data-decision-actions');
  gate('D3.1 order: card › its scroll region › then the actions slot', cardAt > -1 && scrollAt > cardAt && actionsAt > scrollAt);
  gate('D3.2 no verb renders inside the card', !/aria-label="(Dismiss|Done|Keep|Open|Later) \(/.test(html.slice(cardAt, actionsAt)));
  gate('D3.3 Dismiss / Done / Keep / Open / Later all render in the actions slot',
    ['Dismiss', 'Done', 'Keep', 'Open', 'Later'].every((v) => new RegExp(`aria-label="${v} \\(`).test(html.slice(actionsAt))));
  gate('D3.4 the slot has a fixed height and hides overflow (tails open INSIDE it)',
    /^h-\[\d+px\]$/.test(DECISION_ACTIONS_H)
    && (classOf(html, 'data-decision-actions') ?? '').includes(DECISION_ACTIONS_H)
    && (classOf(html, 'data-decision-actions') ?? '').includes('overflow-hidden'));
  const deckSrc = code('components/triage/triage-deck.tsx');
  gate('D3.5 the card area never grows (no floor; the fixed card is the only height)',
    !/CARD_MIN_H/.test(deckSrc) && /const CARD_AREA = 'flex flex-shrink-0 flex-col pb-4';/.test(deckSrc)
    && /<DecisionActionsSlot>/.test(deckSrc));
}

// ═══ D4 · THE SKELETON IS THE CARD ═══
console.log('\nD4 · every waiting state stands in the card\'s own frame');
{
  const frame = classOf(render(React.createElement(DecisionCardFrame, null, 'x')), 'data-decision-card');
  const states: Record<string, string | null> = {
    skeleton: classOf(render(React.createElement(DecisionCardSkeleton, {})), 'data-decision-card'),
    deckSkeleton: classOf(render(React.createElement(TriageDeckSkeleton)), 'data-decision-card'),
    counting: classOf(deck([], { complete: false }), 'data-decision-card'),
    end: classOf(deck([], { complete: true }), 'data-decision-card'),
    loadingCard: classOf(deck([row('l', 'reply', null)]), 'data-decision-card'),
  };
  gate('D4.1 skeleton = card height (every state carries the frame\'s exact class)',
    !!frame && Object.values(states).every((c) => c === frame), JSON.stringify(states));
  gate('D4.2 a card still reading shows the evidence skeleton INSIDE the frame',
    /data-decision-scroll[^>]*><div aria-hidden="true" class="flex flex-col gap-2 px-5 pt-1"/.test(deck([row('l2', 'reply', null)])));
  const held = code('components/home/held-quiet.tsx');
  gate('D4.3 the lens\'s place-holder is the deck\'s own skeleton (no hand-drawn short card)',
    /<TriageDeckSkeleton \/>/.test(held) && !/h-3\.5 w-3\/4 animate-pulse/.test(held));
}

// ═══ D5 · THE KEYBOARD IS UNCHANGED ═══
console.log('\nD5 · keyboard shortcuts unchanged');
{
  gate('D5.1 the key map is exactly Q9v2\'s', JSON.stringify(TRIAGE_KEYS) === JSON.stringify({
    ArrowLeft: 'dismiss', ArrowRight: 'done', ArrowUp: 'keep', Enter: 'open', ' ': 'keep',
    l: 'later', L: 'later', z: 'undo', Z: 'undo', Escape: 'exit',
  }));
  const deckSrc = src('components/triage/triage-deck.tsx');
  gate('D5.2 the station\'s handler still routes every verb (and leaves undo/exit to the deck)',
    /if \(!verb \|\| verb === 'undo' \|\| verb === 'exit'\) return;/.test(deckSrc)
    && /if \(verb === 'done'\) doDone\(\);/.test(deckSrc) && /else if \(verb === 'dismiss'\) doDismiss\(\);/.test(deckSrc)
    && /else if \(verb === 'keep'\) doKeep\(\);/.test(deckSrc) && /else if \(verb === 'later'\) setLaterOpen/.test(deckSrc)
    && /else if \(verb === 'open'\) openRoom\(\);/.test(deckSrc));
  gate('D5.3 the deck\'s handler still owns Esc and Z; typing in a field never steers',
    /if \(verb === 'exit'\) \{ e\.preventDefault\(\); leave\(\); \}/.test(deckSrc)
    && /else if \(verb === 'undo'\) \{ e\.preventDefault\(\); void undoLast\(\); \}/.test(deckSrc)
    && (deckSrc.match(/isContentEditable \|\| \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(t\.tagName\)/g) ?? []).length === 2);
}

// ═══ D6 · ONE EVIDENCE MOUNT (W15.1 swaps it) ═══
console.log('\nD6 · the evidence renderer is one simple mount line, and it is agnostic');
{
  const deckSrc = code('components/triage/triage-deck.tsx');
  gate('D6.1 the card mounts its evidence on ONE line inside the frame',
    (deckSrc.match(/<TriageEvidence row=\{row\} \/>/g) ?? []).length === 1
    && /<DecisionCardFrame head=\{/.test(deckSrc));
  const frameSrc = code('components/triage/decision-frame.tsx');
  gate('D6.2 the frame knows no kind, no verb, no fetch (agnostic, pure presentation)',
    !/source|commitment|reply|notice|fetch\(|useEffect|onClick/.test(frameSrc));
}

// ═══ W16.3 · THE PILL IS THE PAGE'S WIDGET ═══
// Owner walk, Sep 24: a card wore "draft ready" while opening the same item showed NO draft widget (the
// one reader had withdrawn the draft — signed as another mailbox / superseded). The card's pill is now
// the prepared kind the item page's own table would mount, over the machine's state + the one reader's
// LIVE kinds; a withdrawn artifact never reaches the live kinds.
console.log('\nP · W16.3 — the card\'s "ready" pill == the item page\'s prepared widget');
const TODAY = '2026-09-24';
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const heldRow = (id: string, over: Partial<HeldFacts> = {}, sd: Record<string, unknown> = {}): HeldFacts => ({
  item: { id, work_title: 'x', source_data: {
    subject: 'The quarterly numbers', from_name: 'Sam Lee', from_address: 'sam@acme.test', received_at: '2026-09-22T09:00:00Z',
    body: 'Could you send the quarterly numbers?',
    understanding: { role: 'addressed', relevance: 'reply', ownership: 'you_owe', language: 'en', mailKind: 'customer' },
    draft: { body: 'Here they are.', generated_at: '2026-09-22T10:00:00Z' }, ...sd,
  } } as never,
  isEcho: false, judgedNone: false, budgetOverflow: true, neverJudged: false, judgedCurrent: true, ...over,
});
const cardOf = (r: ReturnType<typeof buildHeldLedger>['bands']['waiting']['rows'][number]): TriageRow => ({
  id: r.itemId, item: { source: 'reply', key: r.itemId, entityId: r.itemId, href: `/item/${r.itemId}`, ask: r.subject },
  who: r.from, title: r.subject, why: r.why, excerpt: r.excerpt, dueDate: r.dueDate, prepared: r.prepared ?? null, cls: r.cls,
});
{
  // P1 · the pure equivalence, over EVERY state × every subset of the prepared kinds.
  const states = Object.keys(ARTIFACTS_OF_STATE) as ItemPageState[];
  const kinds = PAGE_PREPARED_KINDS;
  let checked = 0; const bad: string[] = [];
  for (const st of states.filter((x) => x !== 'gate_open')) {
    for (let mask = 0; mask < (1 << kinds.length); mask++) {
      const live = kinds.filter((_, i) => mask & (1 << i));
      const mounted: ItemArtifactsMounted = {}; for (const k of live) mounted[k] = true;
      const plan = composeItemPage({ machine: { state: st }, mounted, brief: null, who: null, ask: null, title: null, source: null });
      const pageKind = plan.artifact && (kinds as readonly string[]).includes(plan.artifact) ? plan.artifact : null;
      const pill = receiptKindOfItem(st, live);
      checked++;
      if (pill !== pageKind) bad.push(`${st}/${live.join('+')}: pill ${pill} vs page ${pageKind}`);
    }
  }
  gate(`P1 over ${checked} state × live-kind fixtures the pill kind IS the page's prepared widget (never one without the other)`, bad.length === 0, bad.slice(0, 3).join(' | '));
  gate('P1b no machine state → no pill (the page shows no widget)', receiptKindOfItem(null, ['reply_draft']) === null);
  gate('P1c every prepared kind the table can choose has ONE ready word', kinds.every((k) => !!readyWordOf(k)) && Object.keys(TRIAGE_READY_WORDS).length === kinds.length);

  // P2 · THE WITHDRAWN DRAFT — the owner's case, end to end through the REAL ledger + the REAL card.
  const withdrawn: Record<string, ItemPageTruth> = { w1: { state: 'awaiting_approval', liveKinds: [] } };
  const wRow = buildHeldLedger([heldRow('w1')], TODAY, { itemPage: withdrawn }).bands.waiting.rows[0];
  gate('P2 a stored draft the one reader WITHDREW serves no prepared kind (the source_data draft no longer speaks)', !!wRow && wRow.prepared === null, JSON.stringify(wRow?.prepared));
  const wPage = composeItemPage({ machine: { state: 'awaiting_approval' }, mounted: {}, brief: null, who: null, ask: null, title: null, source: 'source' });
  const wHtml = text(deck([cardOf(wRow)]));
  gate('P2b …the item page shows no action widget AND the card shows no "ready" pill', wPage.action === null && !/draft ready|ready/i.test(wHtml.replace(/When you.re ready/i, '')), wHtml.slice(0, 200));
  const live: Record<string, ItemPageTruth> = { l1: { state: 'awaiting_approval', liveKinds: ['reply_draft'] } };
  const lRow = buildHeldLedger([heldRow('l1')], TODAY, { itemPage: live }).bands.waiting.rows[0];
  const lPage = composeItemPage({ machine: { state: 'awaiting_approval' }, mounted: { reply_draft: true }, brief: null, who: null, ask: null, title: null, source: 'source' });
  gate('P3 a LIVE draft: the page mounts the email widget AND the card says "Draft ready"… (one reader, one answer)',
    lRow?.prepared === 'reply_draft' && lPage.action === 'email' && /draft ready/.test(text(deck([cardOf(lRow)]))));
  const nRow = buildHeldLedger([heldRow('n1')], TODAY).bands.waiting.rows[0];
  gate('P4 no served page truth for a row → no pill (never a guess from source_data)', nRow?.prepared === null);
  const ldRow = buildHeldLedger([heldRow('d1')], TODAY, { itemPage: { d1: { state: 'looks_done', liveKinds: ['reply_draft'] } } }).bands.waiting.rows[0];
  const ldHtml = text(deck([cardOf(ldRow)]));
  gate('P5 LOOKS DONE with a live draft: the page shows the confirm widget, the card wears no draft pill and says "Looks done — confirm"',
    ldRow?.prepared === null && composeItemPage({ machine: { state: 'looks_done' }, mounted: { reply_draft: true, looks_done: true }, brief: null, who: null, ask: null, title: null, source: null }).action === 'confirm'
    && !/draft ready/.test(ldHtml) && /Looks done — confirm/.test(ldHtml), ldHtml.slice(0, 240));
  const att = code('lib/home/attention.ts'); const hm = code('lib/deeds/held-members.ts');
  const deckSrc2 = code('components/triage/triage-deck.tsx'); const hv = code('components/home/home-view.tsx');
  gate('P6 source: the ledger no longer derives a pill from source_data; it reads the page\'s table over the served truth',
    !/liveFromSourceData/.test(att) && /receiptKindOfItem\(truth\.state, truth\.liveKinds\)/.test(att));
  gate('P7 source: the served truth is THE MACHINE\'s batched reader (the one reader\'s live kinds), read beside the bodies for the pill rows',
    /itemPageTruthFor\(client, userId, pillIds\)/.test(hm) && /workStatesFor\(client, userId, chunk\.map/.test(hm)
    && /liveKinds: \(st\?\.all \?\? \[\]\)\.filter\(isLiveArtifact\)/.test(code('lib/work/machine.ts'))
    && /itemPage: derived\.itemPage \?\? null/.test(code('lib/deeds/held-cache.ts')));
  gate('P8 source: the card words its pill from the kind by ONE table; the Home\'s handed rows choose it through the same page table',
    /const chip = readyWordOf\(row\.prepared\);/.test(deckSrc2) && !/'draft ready'|'invite ready'/.test(deckSrc2)
    && /receiptKindOfItem\(it\.machineState \?\? null/.test(hv) && /machineState: c\.machine\?\.state \?\? null/.test(hv));
}

// ═══ W16.3 · PLAIN WORDS ═══
console.log('\nJ · W16.3 — the card and the list speak the reader\'s words, from the item\'s own facts');
{
  // J1 · every class × every fact shape the ledger can serve — no machinery word.
  const variants: Array<[string, Partial<HeldFacts>, Record<string, unknown>]> = [
    ['plain overflow', {}, { understanding: { ownership: 'none', mailKind: 'customer' }, from_name: '' }],
    ['asked', {}, {}],
    ['due ahead', {}, { understanding: { role: 'addressed', relevance: 'reply', ownership: 'you_owe', language: 'en', mailKind: 'customer', deadline: '2026-10-13' } }],
    ['past due', {}, { understanding: { role: 'addressed', relevance: 'reply', ownership: 'you_owe', language: 'en', mailKind: 'customer', deadline: '2026-09-13' } }],
    ['calendar', { calendarAdjacent: true }, {}],
    ['parked', { userParkedUntil: TODAY, userParkDue: true, judgedNone: true }, {}],
    ['never judged', { neverJudged: true, judgedCurrent: false }, {}],
    ['answered', { judgedNone: true, judgedResolution: 'answered' }, {}],
    ['quiet', { budgetOverflow: false }, {}],
  ];
  const whys: string[] = [];
  for (const cls of HELD_CLASS_ORDER as HeldClassId[]) for (const [, over, sd] of variants) {
    whys.push(whyHeldOf(cls, heldRow('j', over, sd), TODAY));
    whys.push(whyHeldOf(cls, heldRow('j', over, sd), TODAY, 'looks_done'));
  }
  const offenders = whys.filter((w) => ROW_JARGON.test(w));
  gate(`J1 ${whys.length} row whys (every class × fact shape) carry no machinery word ("judged", "today's five", "held", "seat", "budget")`, offenders.length === 0, offenders.slice(0, 3).join(' | '));
  const intros = [0, 3].flatMap((served) => [0, 1].map((urgent) => heldIntro({ total: 9, classes: [], bands: { waiting: { count: 3, urgent }, watched: { count: 1 }, handled: { count: 5 } }, servedCount: served }, 0)));
  intros.push(heldIntro({ total: 0, classes: [], bands: { waiting: { count: 0, urgent: 0 }, watched: { count: 0 }, handled: { count: 0 } } }, 0));
  const listWords = [...intros, HELD_BANDS.waiting.sentence, ...Object.values(ROW_WHY_WORDS), ...Object.values(TRIAGE_SOURCE_WORD), ...Object.values(TRIAGE_READY_WORDS)];
  const listOff = listWords.filter((w) => ROW_JARGON.test(w));
  gate('J2 the list\'s intro, the waiting sentence, the source and ready words carry none either', listOff.length === 0, listOff.join(' | '));
  gate('J3 the retired strings are gone from every source that speaks them',
    !/did not make today/.test(code('lib/home/attention.ts')) && !/judged thing/.test(code('lib/home/held-words.ts'))
    && !/today’s five were fuller/.test(code('lib/home/attention.ts')) && !/'mail'/.test(code('lib/triage/words.ts').split('TRIAGE_SOURCE_WORD')[1]?.split(';')[0] ?? "'mail'"));

  // J4 · THE WORDS COME FROM THE ITEM'S OWN FACTS — rendered through the REAL card.
  const r = (id: string, over: Partial<HeldFacts>, sd: Record<string, unknown>, truth?: ItemPageTruth) =>
    buildHeldLedger([heldRow(id, over, sd)], TODAY, truth ? { itemPage: { [id]: truth } } : {}).bands.waiting.rows[0];
  const asked = text(deck([cardOf(r('a1', {}, {}))]));
  gate('J4 who asked + when → "Sam asked you on Sep 22" (the sender\'s first name, the arrival day)', /Sam asked you on Sep 22/.test(asked), asked.slice(0, 240));
  const due = text(deck([cardOf(r('a2', {}, { understanding: { role: 'addressed', relevance: 'reply', ownership: 'you_owe', language: 'en', mailKind: 'customer', deadline: '2026-10-13' } }))]));
  gate('J5 a stated date → "Due Oct 13" (the date moved off the meta line into the why — said once)', /Due Oct 13/.test(due) && (due.match(/Oct 13/g) ?? []).length === 1, due.slice(0, 240));
  const plain = text(deck([cardOf(r('a3', {}, { understanding: { ownership: 'none', mailKind: 'customer' } }))]));
  gate('J6 nothing more specific → "Waiting for you"', /Waiting for you/.test(plain), plain.slice(0, 240));
  gate('J7 the machine says looks done → "Looks done — confirm"', /Looks done — confirm/.test(text(deck([cardOf(r('a4', {}, {}, { state: 'looks_done', liveKinds: [] }))]))));
  gate('J8 the kind label is plain ("Email"), never the lane token "mail"', /\bEmail\b/.test(asked) && !/\bmail\b/.test(asked.replace(/Email/g, '')));
  const all = [asked, due, plain].join(' ');
  gate('J9 no rendered card word is machinery (judged · today\'s five · held · seat · budget)', !ROW_JARGON.test(all), (all.match(ROW_JARGON) ?? [])[0]);
  gate('J10 the ladder is ONE home, and the card only sentence-cases it', rowWhyOf({ cls: 'quieter_threads', todayISO: TODAY, overflow: true }) === 'waiting for you'
    && sentenceCase('waiting for you') === 'Waiting for you' && /const whyLine = sentenceCase\(row\.why\);/.test(code('components/triage/triage-deck.tsx'))
    && /return rowWhyOf\(\{/.test(code('lib/home/attention.ts')));
}

// ═══ W16.4 · THE CARD'S EVIDENCE IS THE PAGE'S SOURCE ═══
// Owner walk, Sep 24: the one-at-a-time card for a commitment ("Fix the incomplete survey question",
// source = the counterparty's Aug 10 request on a very long shared thread) showed the THREAD'S NEWEST
// message (Sep 3, "+97 earlier") while the item page showed the commitment's OWN message (W11.1). The
// card now mounts exactly what the page mounts, read by the one source reader. These gates run the
// REAL server reader (readDeckContexts) and the REAL page readers (emailSourceOf · sourceQuoteOf ·
// meetingSourceOf) over one in-memory table fixture, then server-render the REAL deck and the page's
// own mounts and demand the card's evidence IS the page's source widget.
type Row = Record<string, unknown>;
function tableClient(tables: Record<string, Row[]>) {
  const at = (r: Row, path: string): unknown => {
    if (!path.includes('->>')) return r[path];
    const [a, b] = path.split('->>'); const o = r[a] as Row | undefined; return o ? o[b] : undefined;
  };
  const from = (table: string) => {
    const st = { filters: [] as Array<(r: Row) => boolean>, cols: '*', order: null as null | { c: string; asc: boolean }, limit: Infinity, single: false };
    const run = () => {
      let rows = (tables[table] ?? []).filter((r) => st.filters.every((f) => f(r)));
      if (st.order) { const { c, asc } = st.order; rows = [...rows].sort((x, y) => (String(at(x, c) ?? '') < String(at(y, c) ?? '') ? -1 : 1) * (asc ? 1 : -1)); }
      rows = rows.slice(0, st.limit);
      const proj = rows.map((r) => {
        if (st.cols.trim() === '*') return { ...r };
        const o: Row = {};
        for (const part of st.cols.split(',').map((x) => x.trim()).filter(Boolean)) {
          const [alias, path] = part.includes(':') ? part.split(':') : [part, part];
          o[alias.includes('->>') ? alias.split('->>')[1] : alias] = at(r, path) ?? null;
        }
        return o;
      });
      return { data: st.single ? proj[0] ?? null : proj, error: null };
    };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: (c?: string) => { if (typeof c === 'string') st.cols = c; return q; },
      eq: (c: string, v: unknown) => { st.filters.push((r) => at(r, c) === v); return q; },
      in: (c: string, v: unknown[]) => { st.filters.push((r) => v.includes(at(r, c))); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { st.order = { c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { st.limit = n; return q; },
      neq: () => q, not: () => q, is: () => q, or: () => q, gte: () => q, lte: () => q, gt: () => q, lt: () => q, ilike: () => q, range: () => q,
      maybeSingle: () => { st.single = true; return q; },
      single: () => { st.single = true; return q; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    });
    return q;
  };
  return { from } as never;
}
const U = 'u-owner';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C_EMAIL = uid(1), C_MEET = uid(2), C_NOQUOTE = uid(3), E_SRC = uid(10), E_OWN = uid(11), MT = uid(20), EV = uid(21), I_THREAD = uid(30), I_MAIL = uid(31);
const LATER = Array.from({ length: 97 }, (_, i) => ({
  id: uid(100 + i), user_id: U, thread_id: 'thr-long', subject: 'Re: Survey launch', is_from_user: i % 2 === 0,
  from_name: i === 96 ? 'Dana Lee' : 'Sam Rivera', from_address: i === 96 ? 'dana@acme.test' : 'sam@acme.test',
  received_at: `2026-${i < 60 ? '08' : '09'}-${String(i < 60 ? 11 + Math.floor(i / 3) : 1 + Math.floor((i - 60) / 20)).padStart(2, '0')}T10:${String(i % 60).padStart(2, '0')}:00Z`,
  body: i === 96 ? 'The dashboard changes are implemented and live on staging.' : `Status note ${i} on the rollout.`,
}));
const TABLES: Record<string, Row[]> = {
  commitments: [
    { id: C_EMAIL, user_id: U, description: 'Fix the incomplete survey question', source: 'email', source_id: E_SRC, thread_id: 'thr-long', direction: 'you_owe', counterparty: 'Sam Rivera', source_quote: 'could you fix the incomplete survey question before launch?' },
    { id: C_MEET, user_id: U, description: 'Share the workshop notes', source: 'meeting', source_id: MT, thread_id: null, direction: 'you_owe', counterparty: 'Sam Rivera', source_quote: 'we will share the workshop notes' },
    { id: C_NOQUOTE, user_id: U, description: 'Send the revised plan', source: 'email', source_id: E_OWN, thread_id: 'thr-short', direction: 'you_owe', counterparty: 'Sam Rivera', source_quote: null },
  ],
  emails: [
    { id: E_SRC, user_id: U, thread_id: 'thr-long', subject: 'Survey launch', is_from_user: false, from_name: 'Sam Rivera', from_address: 'sam@acme.test', received_at: '2026-08-10T09:00:00Z',
      body: 'Hi,\n\nCould you fix the incomplete survey question before launch? Question 7 stops mid-sentence.\n\nOn Fri, Aug 7, 2026, Dana Lee <dana@acme.test> wrote:\n> The dashboard draft is attached.' },
    ...LATER,
    { id: E_OWN, user_id: U, thread_id: 'thr-short', subject: 'Plan', is_from_user: true, from_name: 'Alex Morgan', from_address: 'alex@ourco.example', received_at: '2026-09-20T09:00:00Z', body: 'I will send the revised plan on Monday.' },
  ],
  inbox_items: [
    // The long thread's item was last touched by the unrelated newest message — the old card's source.
    { id: I_THREAD, user_id: U, source: 'email', source_id: LATER[96].id, source_data: { thread_id: 'thr-long' }, last_activity_at: '2026-09-03T10:00:00Z' },
  ],
  meeting_transcripts: [
    { id: MT, user_id: U, title: 'Workshop prep', start_time: '2026-09-18T09:00:00Z', created_at: '2026-09-18T09:00:00Z', attendees: [{ name: 'Sam Rivera' }], calendar_event_id: EV, summary: 'We agreed the workshop notes go out this week.' },
  ],
  calendar_events: [{ id: EV, user_id: U, title: 'Workshop prep with Acme', start_time: '2026-09-18T09:00:00Z', attendees: [{ displayName: 'Dana Lee', email: 'dana@acme.test' }] }],
};
const between = (html: string) => html.slice(html.indexOf('data-decision-scroll'), html.indexOf('data-decision-actions'));

void (async () => {
  console.log('\nE · W16.4 — the card\'s evidence IS the item page\'s source (commitment · email · meeting)');
  const db = tableClient(TABLES);
  const { readDeckContexts } = await import('../lib/triage/deck-context-read');
  const { emailSourceOf, emailSourcesOf, sourceQuoteOf, sourceQuotesOf, meetingSourceOf, meetingSourcesOf } = await import('../lib/commitments/source');
  const { loadUserForms, isUserForm } = await import('../lib/prepare/addressee');
  const { EmailSourceMount, MeetingSourceMount, SourceObjectMount } = await import('../components/room/source-object');
  const { loadDeckContext } = await import('../lib/triage/deck-context-door');
  const { loadThreadDoor } = await import('../lib/inbox/thread-door');
  const { objectIdForDoor } = await import('../lib/room/door');

  // THE DOORS, SERVED BY THE REAL SERVER READER over the fixture (no network): the deck-context door
  // answers with readDeckContexts; the thread door with the route's own message shape.
  const THREAD_PAYLOAD = {
    id: I_MAIL, subject: 'Quarterly numbers', fromName: 'Sam Rivera', fromAddress: 'sam@acme.test', receivedAt: '2026-09-22T09:00:00Z', attachments: [], invite: null,
    messages: [
      { id: 'm1', from: 'alex@ourco.example', fromName: 'Alex Morgan', receivedAt: '2026-09-20T09:00:00Z', body: 'Sharing the draft numbers.', isFromUser: true },
      { id: 'm2', from: 'sam@acme.test', fromName: 'Sam Rivera', receivedAt: '2026-09-21T09:00:00Z', body: 'Thanks, one question on Q3.', isFromUser: false },
      { id: 'm3', from: 'sam@acme.test', fromName: 'Sam Rivera', receivedAt: '2026-09-22T09:00:00Z', body: 'Could you send the final quarterly numbers?', isFromUser: false },
    ],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (url === '/api/home/deck-context') {
      const { ids } = JSON.parse(init?.body ?? '{}') as { ids: string[] };
      return { ok: true, json: async () => ({ contexts: await readDeckContexts(db, U, ids) }) };
    }
    if (url === `/api/inbox/${I_MAIL}/thread`) return { ok: true, json: async () => THREAD_PAYLOAD };
    return { ok: false, json: async () => null };
  }) as never;
  try {
    const [cEmail, cMeet, cNoQuote] = await Promise.all([loadDeckContext(C_EMAIL), loadDeckContext(C_MEET), loadDeckContext(C_NOQUOTE)]);
    await loadThreadDoor(I_MAIL);

    // ── E1–E4 · THE COMMITMENT ON A LONG THREAD WHOSE NEWEST MESSAGE IS UNRELATED ──
    // The page's facts, exactly as app/api/commitments/[id] serves them and item-detail maps them.
    const pageEmail = await emailSourceOf(db, U, E_SRC);
    const pageQuote = (await sourceQuoteOf(db, U, C_EMAIL))?.line ?? null;
    const pageFacts = pageEmail ? { id: pageEmail.id, threadId: pageEmail.threadId, subject: pageEmail.subject, from: pageEmail.from, receivedAt: pageEmail.receivedAt, excerpt: pageEmail.excerpt, quote: pageQuote } : null;
    const pageHtml = pageFacts ? render(React.createElement(EmailSourceMount, { source: pageFacts, onOpen: noop })) : '';
    const cardHtml = between(deck([row(C_EMAIL, 'commitment', null, 'Fix the incomplete survey question')]));
    gate('E1 the server context carries the commitment\'s OWN source message (by its id), never the thread\'s newest',
      cEmail?.email?.id === E_SRC && cEmail.email.receivedAt === '2026-08-10T09:00:00Z' && cEmail.inboxItemId === I_THREAD, JSON.stringify(cEmail));
    gate('E2 the card\'s evidence IS the item page\'s source widget (same mount, same served facts, same render)',
      !!pageHtml && cardHtml.includes(pageHtml), `card: ${text(cardHtml).slice(0, 200)} | page: ${text(pageHtml).slice(0, 200)}`);
    gate('E3 …it shows the Aug 10 ask in its own words and NOT the thread\'s newest (no "Dashboard", no "+97 earlier", no quoted tail)',
      /incomplete survey question before launch/.test(text(cardHtml)) && !/dashboard changes|earlier/i.test(text(cardHtml)) && !/draft is attached/.test(text(cardHtml)), text(cardHtml).slice(0, 300));
    gate('E4 the quote rides ("Sam Rivera asked: “…”") and the rest of the thread is ONE door away ("Open thread")',
      text(cardHtml).includes('Sam Rivera asked: “could you fix the incomplete survey question before launch?”') && /data-source-quote/.test(cardHtml) && />Open thread</.test(cardHtml), text(cardHtml).slice(0, 300));

    // ── E5 · NO QUOTE → the page's source alone (the user's own message), no quote line ──
    const own = await emailSourceOf(db, U, E_OWN);
    const ownHtml = own ? render(React.createElement(EmailSourceMount, { source: { id: own.id, threadId: own.threadId, subject: own.subject, from: own.from, receivedAt: own.receivedAt, excerpt: own.excerpt, quote: null } })) : '';
    const noQuoteCard = between(deck([row(C_NOQUOTE, 'commitment', null, 'Send the revised plan')]));
    gate('E5 a commitment with no quote: the card is the page\'s source card alone (no quote line; no thread item → no door)',
      cNoQuote?.quote === null && !!ownHtml && noQuoteCard.includes(ownHtml) && !/data-source-quote/.test(noQuoteCard) && !/Open thread/.test(noQuoteCard));

    // ── E6 · A MEETING-BORN COMMITMENT → the meeting source (the page's MeetingSourceMount) ──
    const forms = await loadUserForms(db, U);
    const pageMeeting = await meetingSourceOf(db, U, MT, (who) => isUserForm(who, forms));
    const meetPageHtml = pageMeeting ? render(React.createElement(MeetingSourceMount, { meeting: pageMeeting, onOpen: noop })) : '';
    const meetCard = between(deck([row(C_MEET, 'commitment', null, 'Share the workshop notes')]));
    gate('E6 a meeting-born commitment: the card\'s evidence IS the page\'s meeting source card (title · attendees · summary · door)',
      !!meetPageHtml && meetCard.includes(meetPageHtml) && /Workshop prep with Acme/.test(meetCard) && cMeet?.meeting?.addressId === EV && cMeet.email === null, text(meetCard).slice(0, 240));

    // ── E7 · AN EMAIL ITEM → the page's object card over the SAME thread door ──
    const mailPageHtml = render(React.createElement(SourceObjectMount, { itemId: I_MAIL, onOpenThread: noop }));
    const mailCard = between(deck([row(I_MAIL, 'reply', 'Could you send the final quarterly numbers?')]));
    gate('E7 an email item: the card mounts the item page\'s object card over the same door (+N earlier, subject, the door) — the page\'s own',
      objectIdForDoor({ kind: 'item', itemKind: 'inbox', id: I_MAIL }, { sourceItemId: null }) === I_MAIL
      && mailPageHtml.length > 0 && mailCard.includes(mailPageHtml) && /Could you send the final quarterly numbers\?/.test(text(mailCard)), text(mailCard).slice(0, 240));

    // ── E8 · ONE READER — the batched forms ARE the single reads (same columns, same shaper) ──
    const batchE = (await emailSourcesOf(db, U, [E_SRC, E_OWN]));
    const batchQ = (await sourceQuotesOf(db, U, [C_EMAIL, C_MEET, C_NOQUOTE]));
    const batchM = (await meetingSourcesOf(db, U, [MT], (who) => isUserForm(who, forms)));
    gate('E8 the batched reads equal the page\'s single reads, fact for fact (email · quote · meeting); another user reads nothing',
      JSON.stringify(batchE.get(E_SRC)) === JSON.stringify(pageEmail) && JSON.stringify(batchE.get(E_OWN)) === JSON.stringify(own)
      && batchQ.get(C_EMAIL)?.line === pageQuote && !batchQ.has(C_NOQUOTE) && batchQ.get(C_MEET)?.lead === 'Said in the meeting'
      && JSON.stringify(batchM.get(MT)) === JSON.stringify(pageMeeting)
      && (await emailSourcesOf(db, 'someone-else', [E_SRC])).size === 0);
  } finally { globalThis.fetch = realFetch; }

  // ── E9–E10 · SOURCE FLOORS ──
  const so = code('lib/commitments/source.ts'); const dcr = code('lib/triage/deck-context-read.ts'); const deckSrc = code('components/triage/triage-deck.tsx');
  gate('E9 one reader: the single and batched email reads share the columns + the shaper; the meeting read delegates; the quote read shares its select',
    (so.match(/\.select\(EMAIL_SOURCE_COLS\)/g) ?? []).length === 2 && (so.match(/emailSourceFromRow\(/g) ?? []).length >= 3
    && /return \(await meetingSourcesOf\(client, userId, \[meetingId\], isUser\)\)\.get\(meetingId\) \?\? null;/.test(so)
    && (so.match(/\.select\('id, source_quote, source, source_id, direction, counterparty'\)/g) ?? []).length === 2
    && (so.match(/sourceQuoteFrom\(\{/g) ?? []).length >= 2);
  gate('E10 the deck reads through the one source reader, and the card mounts the page\'s own mounts (no thread-door tail for a commitment)',
    /emailSourcesOf\(client, userId, sourceEmailIds\)/.test(dcr) && /sourceQuotesOf\(client, userId,/.test(dcr) && /meetingSourcesOf\(client, userId, meetingIds, isUser\)/.test(dcr)
    && !/from\('emails'\)|newestByThread|founding/.test(dcr)
    && /<EmailSourceMount source=\{ctx\.email\} quote=\{ctx\.quote\}/.test(deckSrc) && /<MeetingSourceMount meeting=\{ctx\.meeting\}/.test(deckSrc)
    && /<SourceObjectMount itemId=\{row\.id\}/.test(deckSrc) && !/<SourceObjectMount itemId=\{ctx\./.test(deckSrc)
    && (deckSrc.match(/<TriageEvidence row=\{row\} \/>/g) ?? []).length === 1);
})().catch((e) => { failures.push(`E threw: ${String(e)}`); console.log(e); }).then(() => {
  console.log(`\n${failures.length ? '❌' : '✅'} ${pass} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`   ✗ ${f}`); process.exit(1); }
});
