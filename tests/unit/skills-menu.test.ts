// W21 · SKILLS IN CHAT — the menu's model (pure) and its rendered rows (renderToStaticMarkup, no DOM).
// The owner's coherence rule: an assigned skill is ALREADY ON, so it arrives checked; unchecking it is a
// per-message SKIP (never an unassign), checking an unassigned one is a per-message ADD (never an assign).
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  chipsOf, dropChip, filterMenu, isChecked, orderMenu, reconcilePick, receiptText, rowHint, assignLabel,
  skillOfferOf, skillsBody, skillsFollowedOf, skillTurnFields, stripTrigger, toggleSkill, triggerAt, usesLine,
  NO_PICK, followedFor, type ChatMenuSkill,
} from '@/components/skills/skill-menu-model';
import { SkillMenu } from '@/components/skills/skill-menu';

const SKILLS: ChatMenuSkill[] = [
  { id: 'a', name: 'Board memo', whenToUse: null, assigned: false },
  { id: 'b', name: 'Plain English', whenToUse: 'client text', assigned: true },
  { id: 'c', name: 'Report format', whenToUse: null, assigned: true },
  { id: 'd', name: 'Research method', whenToUse: 'vendor comparisons', assigned: false },
];
const byId = (id: string) => SKILLS.find((s) => s.id === id)!;

describe('the Skills menu model', () => {
  it('orders the actor\'s assigned skills first (stable), then the library', () => {
    expect(orderMenu(SKILLS).map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('assigned rows arrive checked, the rest unchecked', () => {
    expect(orderMenu(SKILLS).map((s) => isChecked(s, NO_PICK))).toEqual([true, true, false, false]);
    expect(rowHint(byId('b'), NO_PICK, 'Clara Acme')).toBe('always on for Clara');
  });

  it('unchecking an assigned skill is a SKIP; checking an unassigned one is an ADD', () => {
    const skipped = toggleSkill(NO_PICK, byId('b'));
    expect(skipped).toEqual({ add: [], skip: ['b'] });
    expect(isChecked(byId('b'), skipped)).toBe(false);
    expect(rowHint(byId('b'), skipped, 'Clara')).toBe('skipped for this message');
    const added = toggleSkill(skipped, byId('a'));
    expect(added).toEqual({ add: ['a'], skip: ['b'] });
    expect(rowHint(byId('a'), added, 'Clara')).toBe('this message only');
    // toggling again undoes; the frozen empty pick is never mutated
    expect(toggleSkill(added, byId('a'))).toEqual({ add: [], skip: ['b'] });
    expect(NO_PICK).toEqual({ add: [], skip: [] });
  });

  it('the secondary action names the assignment change it makes', () => {
    expect(assignLabel(byId('a'), 'Clara')).toBe('Always use for Clara');
    expect(assignLabel(byId('b'), 'Clara')).toBe('Remove from Clara');
  });

  it('chips read the picks ("skip <skill>"), drop one at a time, and map to the send body', () => {
    const pick = { add: ['a'], skip: ['b'] };
    const chips = chipsOf(pick, SKILLS);
    expect(chips.map((c) => c.label)).toEqual(['Board memo', 'skip Plain English']);
    expect(skillsBody(pick)).toEqual({ skills: { add: ['a'], skip: ['b'] } });
    expect(skillsBody(dropChip(pick, chips[0]))).toEqual({ skills: { skip: ['b'] } });
    expect(skillsBody(NO_PICK)).toEqual({});
    expect(skillsBody(undefined)).toEqual({});
  });

  it('a pick reconciles with a changed assignment (a redundant add / a moot skip drops)', () => {
    const now = SKILLS.map((s) => (s.id === 'a' ? { ...s, assigned: true } : s.id === 'b' ? { ...s, assigned: false } : s));
    expect(reconcilePick({ add: ['a', 'd'], skip: ['b', 'c'] }, now)).toEqual({ add: ['d'], skip: ['c'] });
  });

  it('filters by name or when-to-use, keeping the order', () => {
    expect(filterMenu(SKILLS, 'vendor').map((s) => s.id)).toEqual(['d']);
    expect(filterMenu(SKILLS, '').map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('the "uses" line: two shown, +N, all on hover; nothing assigned → nothing', () => {
    const l = usesLine(SKILLS.map((s) => ({ ...s, assigned: true })))!;
    expect(l.shown.map((s) => s.name)).toEqual(['Board memo', 'Plain English']);
    expect(l.more).toBe(2);
    expect(l.all).toBe('Board memo, Plain English, Report format, Research method');
    expect(usesLine(SKILLS.map((s) => ({ ...s, assigned: false })))).toBeNull();
  });

  it('"/" opens the list only at the start of a word; "@" keeps the mention menu', () => {
    expect(triggerAt('/rep', 4)).toEqual({ char: '/', q: 'rep' });
    expect(triggerAt('draft it /pl', 12)).toEqual({ char: '/', q: 'pl' });
    expect(triggerAt('and/or', 6)).toBeNull();
    expect(triggerAt('see https://x', 13)).toBeNull();
    expect(triggerAt('ask @sa', 7)).toEqual({ char: '@', q: 'sa' });
    expect(stripTrigger('draft it /pl', '/')).toBe('draft it ');
    expect(stripTrigger('ask @sa', '@')).toBe('ask ');
  });

  it('the receipt reads every turn shape — live payload, room row, component state, DM metadata', () => {
    const f = [{ id: 'b', name: 'Plain English' }, { id: 'c', name: 'Report format' }];
    for (const shape of [
      { skillsFollowed: f }, { skills_followed: f },
      { component: { key: 'x', state: { skillsFollowed: f } } },
      { metadata: { skills_followed: f } }, { metadata: { skillsFollowed: f } },
    ]) {
      expect(skillsFollowedOf(shape)).toEqual(f);
      expect(receiptText(skillsFollowedOf(shape))).toBe('followed: Plain English, Report format');
    }
    expect(skillsFollowedOf({ skillsFollowed: [] })).toBeUndefined();
    expect(skillsFollowedOf({ skillsFollowed: [{ id: 1 }] })).toBeUndefined();
    expect(receiptText(undefined)).toBeNull();
    expect(skillOfferOf({ skillOffer: { patternKey: 'p1', label: 'weekly update' } })).toEqual({ patternKey: 'p1', label: 'weekly update' });
    expect(skillTurnFields({ text: 'hi' })).toEqual({});
  });

  it('a reloaded room turn reads its receipt from the companion record by row id; its own field wins', () => {
    const f = [{ id: 'b', name: 'Plain English' }];
    expect(followedFor({ rowId: 'r1' }, { r1: f })).toEqual(f);
    expect(followedFor({ rowId: 'r2' }, { r1: f })).toBeUndefined();
    expect(followedFor({ skillsFollowed: [{ id: 'c', name: 'Report format' }], rowId: 'r1' }, { r1: f })).toEqual([{ id: 'c', name: 'Report format' }]);
    expect(followedFor({}, null)).toBeUndefined();
  });
});

describe('the Skills menu renders its state', () => {
  const html = (pick = {}) => renderToStaticMarkup(React.createElement(SkillMenu, {
    actorName: 'Clara', skills: orderMenu(SKILLS), pick, activeIdx: 0, onToggle: () => {}, onAssign: () => {},
  }));

  it('assigned first and checked, labelled "always on for <Name>"; the rest unchecked', () => {
    const out = html();
    const checks = [...out.matchAll(/data-checked="(true|false)" data-assigned="(true|false)"/g)].map((m) => [m[1], m[2]]);
    expect(checks).toEqual([['true', 'true'], ['true', 'true'], ['false', 'false'], ['false', 'false']]);
    expect(out.indexOf('Plain English')).toBeLessThan(out.indexOf('Board memo'));
    expect(out).toContain('always on for Clara');
    expect(out).toContain('Always use for Clara');
    expect(out).toContain('Remove from Clara');
    expect(out).toContain('Manage skills');
    expect(out).toContain('href="/settings?tab=team"');
  });

  it('a skip renders unchecked with its word; an add renders checked "this message only"', () => {
    const out = html({ add: ['a'], skip: ['b'] });
    expect(out).toContain('skipped for this message');
    expect(out).toContain('this message only');
  });
});
