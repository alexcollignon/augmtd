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

console.log(`\n${failures.length ? '❌' : '✅'} ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`   ✗ ${f}`); process.exit(1); }
