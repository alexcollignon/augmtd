import { describe, it, expect } from 'vitest';
import { rowWhyOf, dueWordsOf, spokenFirstName, ROW_JARGON, heldIntro, sentenceCase } from '@/lib/home/held-words';
import { receiptKindOfItem } from '@/components/thread/item-page';
import { readyWordOf, TRIAGE_SOURCE_WORD } from '@/lib/triage/words';

// W16.3 · the triage card's pill is the item page's widget; its why is the reader's words. Generic fakes only.
const TODAY = '2026-09-24';

describe('the pill is the item page widget', () => {
  it('a live draft awaiting approval is ready; a withdrawn one is not', () => {
    expect(receiptKindOfItem('awaiting_approval', ['reply_draft'])).toBe('reply_draft');
    expect(receiptKindOfItem('awaiting_approval', [])).toBeNull();
  });
  it('looks done / scheduled / preparing / no state never wear a prepared pill', () => {
    for (const st of ['looks_done', 'scheduled', 'preparing', 'settled', null]) expect(receiptKindOfItem(st, ['reply_draft', 'invite'])).toBeNull();
  });
  it('one word per kind', () => {
    expect(readyWordOf('reply_draft')).toBe('draft ready');
    expect(readyWordOf('decision')).toBeNull();
  });
});

describe('the row why speaks the item facts', () => {
  it('ladder: park, looks done, due, who asked, calendar, waiting', () => {
    expect(rowWhyOf({ cls: 'quieter_threads', todayISO: TODAY, parkedDue: true })).toBe('you asked to see this today');
    expect(rowWhyOf({ cls: 'quieter_threads', todayISO: TODAY, machineState: 'looks_done' })).toBe('looks done — confirm');
    expect(rowWhyOf({ cls: 'quieter_threads', todayISO: TODAY, dueDate: '2026-09-13' })).toBe('was due Sep 13');
    expect(rowWhyOf({ cls: 'quieter_threads', todayISO: TODAY, userOwes: true, who: 'Sam Lee', receivedAt: '2026-09-22T09:00:00Z' })).toBe('Sam asked you on Sep 22');
    expect(rowWhyOf({ cls: 'brought_forward', todayISO: TODAY, who: 'Sam' })).toBe('you meet Sam soon');
    expect(rowWhyOf({ cls: 'quieter_threads', todayISO: TODAY, overflow: true })).toBe('waiting for you');
  });
  it('dates and names plainly', () => {
    expect(dueWordsOf('2026-09-24', TODAY)).toBe('due today');
    expect(dueWordsOf('2026-10-13', TODAY)).toBe('due Oct 13');
    expect(spokenFirstName('sam@acme.test')).toBeNull();
    expect(sentenceCase('waiting for you')).toBe('Waiting for you');
  });
  it('no machinery words', () => {
    for (const cls of ['not_judged', 'judged_quiet', 'brought_forward', 'quieter_threads', 'notices']) {
      expect(rowWhyOf({ cls, todayISO: TODAY, overflow: true, dueDate: '2026-07-16' })).not.toMatch(ROW_JARGON);
    }
    expect(heldIntro({ total: 5, classes: [], bands: { waiting: { count: 3, urgent: 0 }, watched: { count: 0 }, handled: { count: 2 } }, servedCount: 5 }, 0)).not.toMatch(ROW_JARGON);
    expect(Object.values(TRIAGE_SOURCE_WORD)).not.toContain('mail');
  });
});
