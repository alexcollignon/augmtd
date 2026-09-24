import { describe, it, expect } from 'vitest';
import { fallbackOpeningLine, originOf } from '@/lib/room/opening-fallback';
import { CONFIRM_WORDS } from '@/lib/evidence/looks-done-word';
import { claraSentenceOf, composeItemPage, itemPageItems, actionCardOf } from '@/components/thread/item-page';
import { THREAD_CARD_KINDS } from '@/components/thread/types';

// W16.2 — the Home row and the confirm widget share their words; Clara's fallback is direction-true;
// the confirm widget is a first-class kit kind.

describe('the confirm words have one home', () => {
  it('are plain deeds, never "Not yet"', () => {
    expect(CONFIRM_WORDS).toEqual({ done: 'Mark done', keep: 'Keep open' });
  });
});

describe('the fallback sentence is direction-true', () => {
  it('reads whose words made the item from its own facts', () => {
    expect(originOf({ kind: 'commitment', source: 'email', direction: 'you_owe', authoredByUser: true })).toBe('own_promise');
    expect(originOf({ kind: 'commitment', source: 'email', direction: 'you_owe', authoredByUser: false })).toBe('their_ask');
    expect(originOf({ kind: 'commitment', source: 'email', direction: 'you_owe', authoredByUser: null })).toBeNull();
    expect(originOf({ kind: 'commitment', source: 'email', direction: 'awaiting', authoredByUser: true })).toBe('awaiting');
    expect(originOf({ kind: 'commitment', source: 'meeting', direction: 'you_owe' })).toBe('meeting');
    expect(originOf({ kind: 'inbox_item', source: 'meeting', hasSender: false })).toBe('meeting');
    expect(originOf({ kind: 'inbox_item', source: 'email', hasSender: true })).toBe('their_ask');
    expect(originOf({ kind: 'inbox_item', source: 'email', hasSender: false })).toBeNull();
  });
  it('says each direction in one short sentence', () => {
    expect(fallbackOpeningLine({ who: 'Acme', ask: 'Share the updated report', origin: 'own_promise' })).toBe("You told Acme you'd share the updated report.");
    expect(fallbackOpeningLine({ who: null, ask: 'Share the updated report', origin: 'own_promise' })).toBe("You said you'd share the updated report.");
    expect(fallbackOpeningLine({ who: 'Sam Lee', ask: 'Join the call with Sam Lee', origin: 'own_promise' })).toBe("You said you'd join the call with Sam Lee.");
    expect(fallbackOpeningLine({ who: 'Sam', ask: 'Send the signed form', origin: 'their_ask' })).toBe('Sam asked you to send the signed form.');
    expect(fallbackOpeningLine({ who: 'Acme', ask: 'Send the pricing', origin: 'awaiting' })).toBe('Waiting on Acme to send the pricing.');
    expect(fallbackOpeningLine({ who: null, ask: 'Send the pricing', origin: 'awaiting' })).toBe('Still waiting: send the pricing.');
    expect(fallbackOpeningLine({ who: 'Sam', ask: 'Send the recap', origin: 'meeting' })).toBe('From the meeting: send the recap.');
  });
  it('never puts an ask in their mouth for the user\'s own promise', () => {
    for (const origin of ['own_promise', 'awaiting', 'meeting', null] as const) {
      expect(fallbackOpeningLine({ who: 'Sam', ask: 'Send the deck', origin }) ?? '').not.toMatch(/asking you|asked you/);
    }
  });
  it('rides the item page\'s one sentence when the composition cannot speak', () => {
    expect(claraSentenceOf({ brief: null, who: 'Acme', ask: 'share the updated report', title: null, origin: 'own_promise' }))
      .toBe("You told Acme you'd share the updated report.");
  });
});

describe('the confirm widget is a kit kind', () => {
  it('is in the contract and the item page renders it as `kind: confirm`, never the custom slot', () => {
    expect(THREAD_CARD_KINDS).toContain('confirm');
    const plan = composeItemPage({ machine: { state: 'looks_done', line: 'You replied on Sep 23' }, mounted: { looks_done: true }, brief: null, who: 'Sam', ask: 'x', title: null, source: 'source' });
    expect(plan.action).toBe('confirm');
    const card = actionCardOf(plan, { card: { kind: 'confirm', line: null, onDone: () => {} } });
    expect(card?.kind).toBe('confirm');
    expect(card && card.kind === 'confirm' ? card.line : null).toBe('You replied on Sep 23');
    // a confirm plan handed only a built node renders NOTHING (no custom fallback)
    expect(actionCardOf(plan, { node: 'x' })).toBeNull();
    const items = itemPageItems(plan, { seat: { id: 'cos', name: 'Clara' }, action: { card: { kind: 'confirm', line: null } } });
    const kinds = items.flatMap((i) => ('cards' in i && i.cards ? i.cards.map((c) => c.kind) : []));
    expect(kinds).toEqual(['confirm']);
  });
});
