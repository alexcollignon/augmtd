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

console.log(`\n${failures.length ? '❌' : '✅'} ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`   ✗ ${f}`); process.exit(1); }
