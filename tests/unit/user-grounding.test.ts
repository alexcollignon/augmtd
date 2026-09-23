// W2.2 ONE USER GROUNDING — the pure half (renderer, live filter, ordering, budget). Zero IO.
import { describe, it, expect } from 'vitest';
import {
  renderUserGrounding, isLiveWorkItem, sortOwed, USER_GROUNDING_BUDGET,
  type UserGroundingFacts, type OwedRow,
} from '@/lib/room/user-grounding';
import { placedTags, resolveAskRefs } from '@/lib/home/ask-refs';
import { EXCERPT_MARK } from '@/lib/utils/clip-for-prompt';

const owed = (over: Partial<OwedRow>): OwedRow => ({
  id: 'x', ref: 'inbox', kind: 'reply', title: 'A title', who: 'Sam', due: null, bucket: 'this_week',
  project: null, href: '/item/x', priority: 20, ...over,
});
const base = (over: Partial<UserGroundingFacts> = {}): UserGroundingFacts => ({
  todayStr: '2026-09-22', owed: [], waiting: [], projects: [], people: [],
  scheduleBlock: null, calendarWindowBlock: null, deeds: [], notes: [], ...over,
});

describe('isLiveWorkItem', () => {
  it('keeps todo/waiting/in_progress owned by the user, drops done/automated/team', () => {
    expect(isLiveWorkItem({ state: 'todo', automated: false, actor: 'you' })).toBe(true);
    expect(isLiveWorkItem({ state: 'in_progress', automated: false, actor: 'you' })).toBe(true);
    expect(isLiveWorkItem({ state: 'waiting', automated: false, actor: 'you' })).toBe(true);
    expect(isLiveWorkItem({ state: 'done', automated: false, actor: 'you' })).toBe(false);
    expect(isLiveWorkItem({ state: 'todo', automated: true, actor: 'you' })).toBe(false);
    expect(isLiveWorkItem({ state: 'done', automated: false, actor: 'team' })).toBe(false);
  });
});

describe('sortOwed', () => {
  it('orders overdue → today → later, then by priority', () => {
    const rows = [
      owed({ id: 'a', bucket: 'this_week', priority: 90 }),
      owed({ id: 'b', bucket: 'overdue', priority: 10 }),
      owed({ id: 'c', bucket: 'today', priority: 50 }),
      owed({ id: 'd', bucket: 'today', priority: 80 }),
    ].sort(sortOwed);
    expect(rows.map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });
});

describe('renderUserGrounding', () => {
  it('tags replies [R#], promises [C#], other work [W#], projects [E#] — and every tag resolves by id', () => {
    const facts = base({
      owed: [
        owed({ id: 'r1', kind: 'reply' }),
        owed({ id: 'c1', ref: 'commitment', kind: 'commitment', title: 'Send the deck' }),
        owed({ id: 'w1', kind: 'action', title: 'Pay the invoice', bucket: 'overdue' }),
        owed({ id: 'm1', ref: 'meeting', kind: 'meeting', title: 'Follow up on pricing' }),
      ],
      projects: [{ id: 'e1', name: 'Acme Rollout', aliases: [], tracked: true, category: 'client', summary: 'Kickoff done.', momentum: 'active', quietDays: 1, youOwe: ['the SOW'], nextMove: 'Send SOW' }],
    });
    const { text, refs } = renderUserGrounding(facts);
    expect(text).toContain('[R1] reply owed');
    expect(text).toContain('[C1] you promised');
    expect(text).toContain('[W1] action owed');
    expect(text).toContain('[W2] meeting follow-up');
    expect(text).toContain('OVERDUE');
    expect(text).toContain('[E1] Acme Rollout');
    expect(refs.get('R1')?.id).toBe('r1');
    expect(refs.get('C1')?.href).toBe('/item/c1?kind=commitment');
    expect(refs.get('W2')?.kind).toBe('meeting');
    expect(refs.get('E1')?.kind).toBe('entity');
    // The ask lane's own resolver walks these tags — an answer citing them lands on the right doors.
    const answer = 'Pay the invoice first [W1], then the deck [C1] for Acme [E1].';
    const { refs: served } = resolveAskRefs(answer, (t) => refs.get(t));
    expect(served.map((r) => r.tag)).toEqual(['W1', 'C1', 'E1']);
    expect(placedTags(text).length).toBe(5);
  });

  it('names-only project depth renders no state, no summary, no next move', () => {
    const facts = base({
      projects: [{ id: 'e1', name: 'Acme Rollout', aliases: [], tracked: true, category: null, summary: null, momentum: null, quietDays: null, youOwe: [], nextMove: null }],
    });
    const { text } = renderUserGrounding(facts, { projectDepth: 'names' });
    expect(text).toContain('names only');
    expect(text).toContain('[E1] Acme Rollout');
    expect(text).not.toContain('Where it stands');
    expect(text).not.toContain('next:');
  });

  it('speaks a clear deck honestly and never claims work it does not hold', () => {
    const { text, refs } = renderUserGrounding(base());
    expect(text).toContain('WORK YOU OWE: nothing judged live right now');
    expect(refs.size).toBe(0);
  });

  it('is excerpt-honest: a long summary ends in the clip mark, never a bare cut', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i + 1} about the work.`).join(' ');
    const facts = base({
      projects: [{ id: 'e1', name: 'Acme', aliases: [], tracked: true, category: null, summary: long, momentum: null, quietDays: null, youOwe: [], nextMove: null }],
    });
    const { text } = renderUserGrounding(facts);
    expect(text).toContain(EXCERPT_MARK);
  });

  it('stays within budget and DECLARES what it dropped', () => {
    const facts = base({
      owed: Array.from({ length: 200 }, (_, i) => owed({ id: `o${i}`, title: `Obligation ${i} with a reasonably long title to fill the page` })),
      projects: Array.from({ length: 120 }, (_, i) => ({ id: `e${i}`, name: `Project ${i}`, aliases: [], tracked: i < 5, category: 'client', summary: 'A summary line that takes some room on the page for the budget test.', momentum: 'active', quietDays: 2, youOwe: [], nextMove: null })),
      people: Array.from({ length: 40 }, (_, i) => ({ name: `Person ${i}`, momentum: 'you_owe', summary: 'They are waiting on something from the user.' })),
    });
    const { text, omitted } = renderUserGrounding(facts);
    expect(text.length).toBeLessThanOrEqual(USER_GROUNDING_BUDGET);
    expect(text).toMatch(/\(\+\d+ more not shown/);
    expect(Object.values(omitted).some((n) => n > 0)).toBe(true);
    // The floor: even under budget pressure the owed section keeps its minimum seats.
    expect(placedTags(text).filter((t) => /^[RCW]/.test(t)).length).toBeGreaterThanOrEqual(6);
  });

  it('a smaller budget still keeps the section floors', () => {
    const facts = base({ owed: Array.from({ length: 40 }, (_, i) => owed({ id: `o${i}` })) });
    const { text } = renderUserGrounding(facts, { budget: 800 });
    expect(placedTags(text).length).toBeGreaterThanOrEqual(6);
  });
});
