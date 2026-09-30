// W28 — records first in code (the web tools withheld on a turn the user's records answer), and the
// user's sign-off on drafts they send.
import { describe, it, expect } from 'vitest';
import { namedEntities, recordsFirstDecision, WEB_TOOL_NAMES } from '@/lib/work/web-gate';
import { enforceUserSignOff } from '@/lib/inbox/sign-off';

describe('records first', () => {
  it('finds the named things, not sentence openers or coworker names', () => {
    expect(namedEntities('Can you look into Globex for me?')).toEqual(['Globex']);
    expect(namedEntities('Max, what do we know about Acme Logistics?')).toEqual(['Acme Logistics']);
    expect(namedEntities('summarise my week')).toEqual([]);
  });
  it('withholds the web only when the records resolve the name and nothing public is asked', () => {
    expect(recordsFirstDecision({ userText: 'Can you look into Globex for me?', resolved: ['Globex'] })).toEqual({ offerWeb: false, entity: 'Globex' });
    expect(recordsFirstDecision({ userText: 'Research the latest news on Globex', resolved: ['Globex'] }).offerWeb).toBe(true);
    expect(recordsFirstDecision({ userText: 'Can you look into Globex for me?', resolved: [] }).offerWeb).toBe(true);
    expect(WEB_TOOL_NAMES).toContain('web_search');
  });
});

describe('the sign-off is the user\'s', () => {
  it('re-signs a coworker, "Me" or a template name; leaves a real signature alone', () => {
    expect(enforceUserSignOff('Hi Sam,\n\nThanks.\n\nBest,\nClara', 'Taylor Reed', ['Clara', 'Luca'])).toBe('Hi Sam,\n\nThanks.\n\nBest,\nTaylor');
    expect(enforceUserSignOff('Thanks,\nMe', 'Taylor Reed')).toBe('Thanks,\nTaylor');
    expect(enforceUserSignOff('Best,\nTay', 'Taylor Reed', ['Clara'])).toBe('Best,\nTay');
    expect(enforceUserSignOff('Best,\nClara', null, ['Clara'])).toBe('Best,\nClara');
  });
});
