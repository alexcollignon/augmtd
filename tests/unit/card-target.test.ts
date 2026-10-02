// REPLY TO A CARD (law `one-component-one-behaviour` — lib/present/card-target.ts). Pure.
import { describe, expect, it } from 'vitest';
import { resolveCardReference, sanitizeTarget, targetedQuestion } from '@/lib/present/card-target';
import { CARD_SUMMARY, BEHAVIOUR_KINDS, summaryTitleOf, stacks, type CardDescriptor } from '@/lib/present/behaviour';

const cards: CardDescriptor[] = [
  { id: 'a', kind: 'reply_draft', title: 'Pilot pricing — two questions', recipient: 'sam@acme.test', ref: 'item-1' },
  { id: 'b', kind: 'invite', title: 'Acme pilot kickoff', recipient: 'jordan@acme.test', ref: 'inv-1' },
  { id: 'c', kind: 'compose_email', title: 'Onboarding plan', recipient: 'riley@globex.test', ref: 'mail-2' },
];
const ref = (r: ReturnType<typeof resolveCardReference>) => (r && 'target' in r ? r.target.ref : r && 'ask' in r ? 'ASK' : null);

describe('reference resolution', () => {
  it('ordinals pick by position', () => {
    expect(ref(resolveCardReference('make the second one shorter', cards))).toBe('inv-1');
    expect(ref(resolveCardReference('make the first one warmer', cards))).toBe('item-1');
    expect(ref(resolveCardReference('shorten the last one', cards))).toBe('mail-2');
  });
  it('ordinals count within a named kind', () => {
    expect(ref(resolveCardReference('make the second email shorter', cards))).toBe('mail-2');
  });
  it('a recipient name or title words pick the card', () => {
    expect(ref(resolveCardReference('make the Sam email shorter', cards))).toBe('item-1');
    expect(ref(resolveCardReference('change the kickoff to Thursday', cards))).toBe('inv-1');
  });
  it('a kind alone picks the only card of that kind', () => {
    expect(ref(resolveCardReference('move that invite to 3pm', cards))).toBe('inv-1');
  });
  it('an ambiguous pointer asks one short question', () => {
    const r = resolveCardReference('make that email shorter', cards);
    expect(r && 'ask' in r && /Which one/.test(r.ask)).toBe(true);
    expect(ref(resolveCardReference('make that one shorter', cards))).toBe('ASK');
  });
  it('a general or non-edit message is never routed to a card', () => {
    expect(resolveCardReference('thanks, that email looks good', cards)).toBeNull();
    expect(resolveCardReference('what is on my calendar tomorrow?', cards)).toBeNull();
    expect(resolveCardReference('make it shorter', [])).toBeNull();
  });
  it('a single card in view is the one "that one" means', () => {
    expect(ref(resolveCardReference('make that one shorter', [cards[1]]))).toBe('inv-1');
  });
});

describe('the target at the door', () => {
  it('sanitizes: unknown kinds and missing refs are no target; titles are clipped', () => {
    expect(sanitizeTarget({ kind: 'bogus', ref: 'x' })).toBeNull();
    expect(sanitizeTarget({ kind: 'invite' })).toBeNull();
    expect(sanitizeTarget({ kind: 'invite', ref: 'inv-1', title: 'x'.repeat(400) })?.title?.length).toBeLessThanOrEqual(140);
  });
  it('the core gets ONE instruction about THAT card, the user\'s words verbatim, the title as data', () => {
    const q = targetedQuestion('make it shorter', { kind: 'compose_email', ref: 'mail-2', title: 'Onboarding plan', recipient: null });
    expect(q).toMatch(/REPLYING TO ONE CARD/);
    expect(q).toMatch(/REVISED VERSION/);
    expect(q).toMatch(/earlier card stays exactly as it was/);
    expect(q).toMatch(/The user's words: make it shorter$/);
  });
});

describe('the collapsed summary', () => {
  it('every kind has a noun and a glyph; a stack exists only for several cards', () => {
    for (const k of BEHAVIOUR_KINDS) { expect(CARD_SUMMARY[k].noun.length).toBeGreaterThan(1); expect(CARD_SUMMARY[k].icon).toBeTruthy(); }
    expect(summaryTitleOf({ kind: 'invite', title: null })).toBe('Invite');
    expect(stacks(1)).toBe(false); expect(stacks(2)).toBe(true);
  });
});
