// W15.3 · ONE DECISION PER SCREEN — the standard decision card. Server renders of the REAL deck with
// short, long and still-loading content prove ONE outer geometry; the action row sits outside the
// card's scroll region; the skeleton is the card's own frame; the door opens the card by default.
// Zero IO, zero AI (effects do not run in a static render — the evidence reads never fire).
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { TriageDeck, TriageDeckSkeleton, type TriageRow } from '@/components/triage/triage-deck';
import {
  DecisionCardFrame, DecisionCardSkeleton, DECISION_CARD_H, DECISION_ACTIONS_H,
} from '@/components/triage/decision-frame';
import { initialWaitingShape, DEFAULT_WAITING_SHAPE, TRIAGE_VIEW_KEY } from '@/lib/triage/view-shape';
import { TRIAGE_KEYS, TRIAGE_VIEW_ALL } from '@/lib/triage/words';
import type { DoItem } from '@/lib/home/agenda';

const router = { back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };
const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, el));

const item = (source: DoItem['source'], id: string): DoItem => ({
  source, key: `${source}:${id}`, entityId: id, href: `/item/${id}`, ask: 'Reply to Sam',
});
const row = (id: string, source: DoItem['source'], excerpt: string | null, title = 'The quarterly numbers'): TriageRow => ({
  id, item: item(source, id), who: 'Sam at Acme', title, why: 'waiting on you', excerpt,
  dueDate: null, prepared: null, cls: null,
});
const deck = (r: TriageRow) => render(createElement(TriageDeck, { rows: [r], today: '2026-09-24', onExit: () => {} }));

/** The class attribute of the first element carrying `attr`. */
const classOf = (html: string, attr: string): string | null => {
  const m = html.match(new RegExp(`<[a-z]+ ${attr}[^>]*class="([^"]+)"`));
  return m ? m[1] : null;
};

const LONG = Array.from({ length: 400 }, (_, i) => `Line ${i} of a very long message body.`).join('\n');

describe('the one decision card', () => {
  it('has ONE outer geometry whatever the content: short, long, loading, every kind', () => {
    const short = deck(row('a', 'reply', 'Short.'));
    const long = deck(row('b', 'reply', LONG, 'A title that goes on and on '.repeat(20)));
    const loading = deck(row('c', 'reply', null));            // threaded, nothing served → reading
    const commitment = deck(row('d', 'commitment', null));    // founded, context not read yet
    const notice = deck(row('e', 'notice', 'An automated notice.'));
    const classes = [short, long, loading, commitment, notice].map((h) => classOf(h, 'data-decision-card'));
    for (const c of classes) {
      expect(c).not.toBeNull();
      expect(c).toContain(DECISION_CARD_H);
      expect(c).toContain('overflow-hidden');
    }
    expect(new Set(classes).size).toBe(1);
    // A fixed HEIGHT, never a floor or a cap that content could stretch past.
    expect(DECISION_CARD_H).toMatch(/^h-\[/);
    expect(classes[0]).not.toMatch(/(^|\s)(min-h|max-h)-/);
    // The long content is in the DOM (scrolls inside), never clipped away.
    expect(long).toContain('Line 399 of a very long message body.');
  });

  it('while evidence is on its way the card is already at full height (skeleton inside the frame)', () => {
    const loading = deck(row('c2', 'reply', null));
    expect(loading).toContain('aria-hidden="true" class="flex flex-col gap-2 px-5 pt-1"'); // evidence skeleton
    expect(classOf(loading, 'data-decision-card')).toBe(classOf(deck(row('c3', 'reply', 'Hi.')), 'data-decision-card'));
  });

  it('the content scrolls INSIDE the card; the action row is pinned OUTSIDE the scroll region', () => {
    const html = deck(row('f', 'reply', LONG));
    const scroll = classOf(html, 'data-decision-scroll');
    expect(scroll).toContain('overflow-y-auto');
    expect(scroll).toContain('min-h-0 flex-1');
    const actions = classOf(html, 'data-decision-actions');
    expect(actions).toContain(DECISION_ACTIONS_H);
    expect(actions).toContain('overflow-hidden');
    // Order and containment: the card (and its scroll region) close before the actions open.
    const cardAt = html.indexOf('data-decision-card');
    const actionsAt = html.indexOf('data-decision-actions');
    expect(cardAt).toBeGreaterThan(-1);
    expect(actionsAt).toBeGreaterThan(cardAt);
    // Every verb button is in the actions slot, none in the card.
    const cardHtml = html.slice(cardAt, actionsAt);
    expect(cardHtml).not.toMatch(/aria-label="(Dismiss|Done|Keep|Open|Later) \(/);
    expect(html.slice(actionsAt)).toMatch(/aria-label="Dismiss \(/);
    expect(html.slice(actionsAt)).toMatch(/aria-label="Done \(/);
  });

  it('the skeletons ARE the card frame (same height class)', () => {
    const frame = classOf(render(createElement(DecisionCardFrame, null, 'x')), 'data-decision-card');
    const skel = classOf(render(createElement(DecisionCardSkeleton, {})), 'data-decision-card');
    const skelMsg = classOf(render(createElement(DecisionCardSkeleton, { message: 'Counting the rest of the account…' })), 'data-decision-card');
    const deckSkel = classOf(render(createElement(TriageDeckSkeleton)), 'data-decision-card');
    expect(skel).toBe(frame);
    expect(skelMsg).toBe(frame);
    expect(deckSkel).toBe(frame);
    const counting = render(createElement(TriageDeck, { rows: [], today: '2026-09-24', complete: false, onExit: () => {} }));
    expect(classOf(counting, 'data-decision-card')).toBe(frame);
    const end = render(createElement(TriageDeck, { rows: [], today: '2026-09-24', complete: true, onExit: () => {} }));
    expect(classOf(end, 'data-decision-card')).toBe(frame);
  });

  it('the deck header offers "View all" — the list is the secondary view', () => {
    const html = render(createElement(TriageDeck, { rows: [row('g', 'reply', 'Hi.')], today: '2026-09-24', onExit: () => {}, onViewAsList: () => {} }));
    expect(TRIAGE_VIEW_ALL).toBe('View all');
    expect(html).toContain('>View all<');
  });

  it('the keyboard map is unchanged', () => {
    expect(TRIAGE_KEYS).toEqual({
      ArrowLeft: 'dismiss', ArrowRight: 'done', ArrowUp: 'keep', Enter: 'open', ' ': 'keep',
      l: 'later', L: 'later', z: 'undo', Z: 'undo', Escape: 'exit',
    });
  });
});

describe('the door opens one at a time', () => {
  it('defaults to the card', () => {
    expect(DEFAULT_WAITING_SHAPE).toBe('deck');
    expect(initialWaitingShape({ fromHome: false, stored: null })).toBe('deck');
    expect(initialWaitingShape({ fromHome: false, stored: 'garbage' })).toBe('deck');
  });
  it('the Home door ALWAYS opens the card, whatever was chosen before', () => {
    expect(initialWaitingShape({ fromHome: true, stored: 'list' })).toBe('deck');
  });
  it('an address naming the lens honours the reader\'s own last choice (per-viewer, v2 key)', () => {
    expect(initialWaitingShape({ fromHome: false, stored: 'list' })).toBe('list');
    expect(TRIAGE_VIEW_KEY).toBe('aug-triage-view-v2');
  });
});
