// W8.2 ONE CONVERSATION, ONE LIVE ITEM — the pure cores of the conversation delta + the extraction
// truth floors (docs/laws-registry.md `one-conversation-one-live-item`). Zero AI, zero IO.
import { describe, it, expect } from 'vitest';
import {
  quoteInText, validateDelta, verifiedUpdateDue, keepAll, capOpen, buildDeltaPrompt, judgeConversationDelta,
  type DeltaInput, type DeltaOpenItem,
} from '@/lib/work/conversation-delta';
import { dueFloorAgainstSource, nameFormsAgree, foldCounterparty, emailSpellsName } from '@/lib/commitments/extract';

const open: DeltaOpenItem[] = [
  { id: 'a1', description: 'Send the interim report', direction: 'you_owe', counterparty: 'Sam Rivera', due_date: '2026-09-10', created_at: '2026-08-03T10:00:00Z', status: 'open' },
  { id: 'a2', description: 'Confirm pricing for the pilot', direction: 'you_owe', counterparty: 'Sam Rivera', due_date: null, created_at: '2026-08-05T10:00:00Z', status: 'open' },
  { id: 'a3', description: 'Share the signed contract', direction: 'awaiting', counterparty: 'Sam Rivera', due_date: null, created_at: '2026-08-06T10:00:00Z', status: 'open' },
];
const input = (over: Partial<DeltaInput> = {}): DeltaInput => ({
  open,
  candidates: [{ description: 'Send the final report with the appendix', direction: 'you_owe', counterparty: 'Sam Rivera' }],
  message: { kind: 'email', id: 'e9', text: 'Hi — attached is the interim report. We decided to drop the pilot, so no need to confirm pricing. Please send the final report by Friday.', at: '2026-09-15T09:00:00Z', authoredByUser: true },
  todayIso: '2026-09-23',
  ...over,
});

describe('quoteInText — the quote law', () => {
  it('accepts a verbatim span, folding accents, case, curly quotes and spaces', () => {
    expect(quoteInText('attached is the  INTERIM report', 'Hi — attached is the interim report.')).toBe(true);
    expect(quoteInText('it’s décidé', "Well it's decide today")).toBe(true);
  });
  it('refuses a paraphrase, a tiny fragment, a non-string', () => {
    expect(quoteInText('the report is attached', 'Hi — attached is the interim report.')).toBe(false);
    expect(quoteInText('the', 'the report')).toBe(false);
    expect(quoteInText(null, 'x')).toBe(false);
  });
  it('joins ellipsis fragments only in order', () => {
    expect(quoteInText('attached is … no need to confirm', input().message.text)).toBe(true);
    expect(quoteInText('no need to confirm … attached is', input().message.text)).toBe(false);
  });
});

describe('validateDelta — the code half', () => {
  it('a non-keep verdict without a verified quote keeps the item', () => {
    const p = validateDelta({ open: [{ id: 'C2', verdict: 'moot', quote: 'the pricing is no longer relevant' }] }, input());
    expect(p.items[1].action).toBe('keep');
    expect(p.downgraded[0].why).toMatch(/quote/);
  });
  it('moot + delivered with verified quotes', () => {
    const p = validateDelta({ open: [
      { id: 'C1', verdict: 'delivered', quote: 'attached is the interim report' },
      { id: 'C2', verdict: 'moot', quote: 'no need to confirm pricing' },
    ] }, input());
    expect(p.items.map((i) => i.action)).toEqual(['delivered', 'moot', 'keep']);
  });
  it('a delivered nomination by someone other than the debtor keeps the item', () => {
    const p = validateDelta({ open: [{ id: 'C3', verdict: 'delivered', quote: 'attached is the interim report' }] }, input());
    expect(p.items[2].action).toBe('keep'); // a3 is awaiting (they owe) — the user wrote this message
  });
  it('supersession onto a new candidate; unknown labels ignored; self/cycle kept', () => {
    const p = validateDelta({ open: [
      { id: 'C1', verdict: 'superseded', by: 'N1', quote: 'send the final report by Friday' },
      { id: 'C9', verdict: 'moot', quote: 'no need to confirm pricing' },
    ] }, input());
    expect(p.items[0]).toMatchObject({ action: 'superseded', by: { kind: 'candidate', index: 0 } });
    const cyc = validateDelta({ open: [
      { id: 'C1', verdict: 'superseded', by: 'C2', quote: 'send the final report by Friday' },
      { id: 'C2', verdict: 'superseded', by: 'C1', quote: 'no need to confirm pricing' },
    ] }, input());
    expect(cyc.items[0].action).toBe('keep');
    expect(cyc.items[1].action).toBe('keep');
  });
  it('duplicate_of folds only onto an open item of the same direction', () => {
    expect(validateDelta({ new: [{ id: 'N1', verdict: 'duplicate', of: 'C1' }] }, input()).candidates[0]).toEqual({ index: 0, action: 'duplicate', of: 'a1' });
    expect(validateDelta({ new: [{ id: 'N1', verdict: 'duplicate', of: 'C3' }] }, input()).candidates[0].action).toBe('new');
    expect(validateDelta({ new: [{ id: 'N1', verdict: 'duplicate', of: 'C7' }] }, input()).candidates[0].action).toBe('new');
  });
  it('an update writes only a stated due, never one before the message', () => {
    const p = validateDelta({ open: [{ id: 'C1', verdict: 'update', quote: 'send the final report by Friday', due_date: '2026-09-18' }] }, input());
    expect(p.items[0]).toMatchObject({ action: 'update', due_date: '2026-09-18' });
    const q = validateDelta({ open: [{ id: 'C1', verdict: 'update', quote: 'send the final report by Friday', due_date: '2026-09-01' }] }, input());
    expect(q.items[0].action).toBe('keep');
  });
  it('garbage keeps everything', () => {
    expect(validateDelta(null, input()).failed).toBe(true);
    expect(keepAll(input()).items.every((i) => i.action === 'keep')).toBe(true);
  });
});

describe('the pass', () => {
  it('failure keeps everything; no open work makes no call', async () => {
    const failed = await judgeConversationDelta(input(), async () => { throw new Error('outage'); });
    expect(failed.failed).toBe(true);
    expect(failed.items.every((i) => i.action === 'keep')).toBe(true);
    expect(failed.candidates.every((c) => c.action === 'new')).toBe(true);
    let called = 0;
    const none = await judgeConversationDelta(input({ open: [] }), async () => { called++; return '{}'; });
    expect(called).toBe(0);
    expect(none.failed).toBe(false);
  });
  it('the prompt carries labels (never ids), today, and the excerpt rule', () => {
    const p = buildDeltaPrompt(input());
    expect(p).toContain('[C1]');
    expect(p).toContain('[N1]');
    expect(p).toContain('Today is 2026-09-23');
    expect(p).toMatch(/clipped BY THIS SYSTEM/);
    expect(p).not.toContain('a1');
  });
  it('the cap keeps the oldest and reports the rest', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ created_at: `2026-08-${String(i + 1).padStart(2, '0')}` }));
    const { kept, leftBehind } = capOpen(rows, 20);
    expect(kept.length).toBe(20);
    expect(leftBehind.length).toBe(5);
    expect(kept[0].created_at).toBe('2026-08-01');
  });
  it('verifiedUpdateDue: stated explicitly or as the coming weekday', () => {
    expect(verifiedUpdateDue('2026-09-30', 'by September 30 please', '2026-09-15T09:00:00Z')).toBe('2026-09-30');
    expect(verifiedUpdateDue('2026-09-18', 'by Friday please', '2026-09-15T09:00:00Z')).toBe('2026-09-18');
    expect(verifiedUpdateDue('2026-09-25', 'by Friday please', '2026-09-15T09:00:00Z')).toBeNull();
    expect(verifiedUpdateDue('2026-09-10', 'by September 10', '2026-09-15T09:00:00Z')).toBeNull();
  });
});

describe('extraction truth floors', () => {
  it('a due before its own source is null; a title naming that past date is no commitment', () => {
    expect(dueFloorAgainstSource('2026-08-08', '2026-08-10T09:00:00Z', 'Share updated report')).toEqual({ due: null, drop: false, floored: true });
    expect(dueFloorAgainstSource('2026-08-08', '2026-08-10T09:00:00Z', 'Attend the August 8 review').drop).toBe(true);
    expect(dueFloorAgainstSource('2026-08-10', '2026-08-10T09:00:00Z', 'x').floored).toBe(false);
    expect(dueFloorAgainstSource('2026-08-09', '2026-08-10T02:00:00Z', 'x').floored).toBe(false); // one day of timezone tolerance
    expect(dueFloorAgainstSource(null, '2026-08-10T09:00:00Z', 'x').due).toBeNull();
  });
  it('name forms: accents, short surnames, initials — never a bare first name', () => {
    expect(nameFormsAgree('Léa Costa', 'Lea Maria Costa')).toBe(true);
    expect(nameFormsAgree('Sam R.', 'Sam Rivera')).toBe(true);
    expect(nameFormsAgree('Sam Rivera', 'Sam Costa')).toBe(false);
    expect(nameFormsAgree('Sam', 'Sam Rivera')).toBe(false);
    expect(emailSpellsName('sam.rivera@acme.test', 'Sam Rivera')).toBe(true);
    expect(emailSpellsName('sales@acme.test', 'Sam Rivera')).toBe(false);
  });
  it('the counterparty fold: registry first, then the conversation, ambiguity stays raw', () => {
    const reg = [{ name: 'Léa Maria Costa', aliases: ['lea@acme.test'] }, { name: 'Sam Rivera', aliases: [] }, { name: 'Me Myself', aliases: [], state: { self: true } }];
    expect(foldCounterparty('Lea Costa', reg)).toBe('Léa Maria Costa');
    expect(foldCounterparty('lea@acme.test', reg)).toBe('Léa Maria Costa');
    expect(foldCounterparty('sam.rivera@acme.test', reg)).toBe('Sam Rivera');
    expect(foldCounterparty('dana.lee@acme.test', [], ['Dana Lee'])).toBe('Dana Lee');
    expect(foldCounterparty('Dana', [], ['Dana Lee'])).toBe('Dana Lee');
    expect(foldCounterparty('Dana', [], ['Dana Lee', 'Dana Park'])).toBe('Dana');
    expect(foldCounterparty('Alex Kim', [{ name: 'Alex Kim Park' }, { name: 'Alex Kim Lee' }])).toBe('Alex Kim');
    expect(foldCounterparty('Me Myself', reg)).toBe('Me Myself'); // the self is never a fold target
  });
});
