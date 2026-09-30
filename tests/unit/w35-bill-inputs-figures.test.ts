// W35 · THE BILL HAS ONE PAYER · INPUTS HAVE A KIND · FIGURES ON RECORD · THE LAST REVISION — the zero-AI
// half of each fix (docs/laws-registry: bill-has-one-payer · inputs-have-a-kind · figures-on-record ·
// quote-names-its-actor · one-conduct-every-producer).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addressedNoticeDebt, extractionGate, PAYMENT_REQUEST_RULE } from '@/lib/commitments/extract';
import { quoteActor } from '@/lib/commitments/quote-actor';
import { askAnswersOf, inputOf, settleInputKind } from '@/lib/prepare/input-kind';
import { applyAttachVerdict, askPreamble, buildTruth } from '@/lib/prepare/requirements';
import { coerceVerdict } from '@/lib/work/judge';
import { WORK_MEANING, JUDGE_VERSION } from '@/lib/work/surface-registry';
import { amountOf, figuresOnRecord } from '@/lib/room/figures';
import { figuresBlock } from '@/lib/room/grounding';
import { sameWhoAs, dropEmptyRemainder, BRIEFING_PROMPT_VERSION } from '@/lib/briefing/compose';
import { lastRevision, unappliedCorrections } from '@/lib/workflows/execute-step';

const src = (p: string) => readFileSync(p, 'utf8');
const long = 'Our records show that invoice 2214 remains unpaid. Please arrange payment at your earliest convenience.';

describe('THE BILL HAS ONE PAYER — the extraction gate', () => {
  it('a notice read as the user\'s own debt, addressed to them, reaches the extraction', () => {
    for (const mailKind of ['notification', 'receipt'] as const) {
      const g = extractionGate({ source: 'email', text: long, isFromUser: false, understanding: { role: 'addressed', ownership: 'you_owe', relevance: 'action', mailKind, bulk: true } });
      expect(g).toMatchObject({ extract: true, basis: 'addressed-notice-debt' });
    }
  });
  it('never an unsolicited kind, a notice nobody owes, a CC-only copy, a broadcast footer, or no understanding', () => {
    const u = { role: 'addressed' as const, ownership: 'you_owe' as const, mailKind: 'notification' as const };
    expect(addressedNoticeDebt({ isFromUser: false, understanding: { ...u, mailKind: 'newsletter' } })).toBe(false);
    expect(addressedNoticeDebt({ isFromUser: false, understanding: { ...u, mailKind: 'cold_outreach' } })).toBe(false);
    expect(addressedNoticeDebt({ isFromUser: false, understanding: { ...u, ownership: 'none' } })).toBe(false);
    expect(addressedNoticeDebt({ isFromUser: false, understanding: { ...u, role: 'bystander' } })).toBe(false);
    expect(addressedNoticeDebt({ isFromUser: false, understanding: u, ccOnly: true })).toBe(false);
    expect(addressedNoticeDebt({ isFromUser: false, understanding: u, bulkFooter: true })).toBe(false);
    expect(addressedNoticeDebt({ isFromUser: false, understanding: null })).toBe(false);
    expect(addressedNoticeDebt({ isFromUser: true, understanding: u })).toBe(false);
  });
  it('the ONE rule names every branch and rides the extraction prompt; the judge states it in verbs', () => {
    const r = PAYMENT_REQUEST_RULE('Taylor');
    expect(r).toMatch(/ONLY when it asks Taylor to pay/);
    expect(r).toMatch(/already made or confirmed/);
    expect(r).toMatch(/collected automatically/);
    expect(r).toMatch(/only copied/);
    expect(r).toMatch(/SOMEONE ELSE as the one who pays or processes it/);
    expect(src('lib/commitments/extract.ts')).toMatch(/- \$\{PAYMENT_REQUEST_RULE\(who\)\}/);
    const j = src('lib/work/judge.ts');
    expect(j).toMatch(/A BILL OR PAYMENT REQUEST[^`]*work="none"[^`]*work="forward"/);
    expect(WORK_MEANING.forward).toMatch(/names someone other than the user as the one who must act on it/);
    expect(JUDGE_VERSION).toBeGreaterThanOrEqual(26);
  });
  it('a request opened by its own verb is never read as a vocative ("Pode, por favor, …")', () => {
    const ctx = { user: { name: 'Taylor', aliases: [] as string[] }, others: ['ana@umbrella.test'] };
    expect(quoteActor('Pode, por favor, efetuar a transferência até sexta?', ctx)).toBe('addressee');
    expect(quoteActor('Puede, por favor, enviar el contrato?', ctx)).toBe('addressee');
    expect(quoteActor('Sam, please send the report', ctx)).toBe('named-addressee');
    expect(quoteActor('Taylor, please send the report', ctx)).toBe('addressee');
  });
});

describe('INPUTS HAVE A KIND', () => {
  it('the judge keeps the stated kind on each requirement', async () => {
    const v = await coerceVerdict({ work: 'reply', requires: [{ label: 'the signed NDA', input: 'attach' }, { label: 'the maximum budget', input: 'answer' }, { label: 'the deck' }], reason: 'r' }, [], { todayStr: '2026-09-30', nowHHMM: '10:00', itemText: '' });
    expect(v!.requires).toEqual([{ label: 'the signed NDA', input: 'attach' }, { label: 'the maximum budget', input: 'answer' }, { label: 'the deck' }]);
    expect(src('lib/work/judge.ts')).toMatch(/"requires":\[\{"label":"…","input":"attach\|answer"\}\]/);
  });
  it('inputOf / askAnswersOf read tolerant shapes', () => {
    expect(inputOf('Answer')).toBe('answer');
    expect(inputOf('file')).toBeNull();
    expect(askAnswersOf({ items: ['a'], answer: ['IBAN', ' '] })).toEqual(['IBAN']);
    expect(askAnswersOf(null)).toEqual([]);
  });
  it('the judge states, the check verifies: a fact is an answer, a sign-off is nothing, a failed check keeps the stated kind', () => {
    expect(settleInputKind('answer', 'attachable')).toBe('attach');
    expect(settleInputKind('attach', 'answer')).toBe('answer');
    expect(settleInputKind('answer', 'neither')).toBeNull();
    expect(settleInputKind('answer', null)).toBe('answer');
    expect(settleInputKind(null, null)).toBe('attach');
  });
  it('a verdict sorts attach / answer / sign-off, and never keeps a secret', () => {
    const reqs = [{ label: 'the audit report' }, { label: 'IBAN', input: 'answer' as const }, { label: 'confirmation of the time', input: 'answer' as const }, { label: 'the portal password', input: 'answer' as const }];
    const v = applyAttachVerdict(reqs, { attachable: [1], answer: [2, 4], secret: [] })!;
    expect(v.kept).toEqual([{ label: 'the audit report', input: 'attach' }, { label: 'IBAN', input: 'answer' }]);
    expect(v.secrets.map((r) => r.label)).toEqual(['the portal password']);
  });
  it('the answers ride the SAME ask card (state.answer), are never searched, and a produce task writes its own content', () => {
    const r = src('lib/prepare/requirements.ts');
    expect(r).toMatch(/answer: uncovered\.filter\(\(m2\) => m2\.input === 'answer'\)\.map\(\(m2\) => m2\.label\)/);
    expect(r).toMatch(/requires = split\.kept\.filter\(\(r\) => r\.input !== 'answer'\);/);
    expect(r).toMatch(/if \(args\.work === 'produce' && answers\.length\) \{\s*toWrite = \[\.\.\.toWrite, \.\.\.answers\.map/);
    expect(r).toMatch(/const typed = await typedSupplyRows\(/);
    const card = src('components/home/input-card.tsx');
    expect(card).toMatch(/lead: spec\.answers\?\.includes\(label\) \? 'fact' : askItemShape\(label\)/);
    expect(src('components/home/item-rail.tsx')).toMatch(/askAnswersOf\(t\.component\.state\)/);
  });
  it('the ask speaks the right door, and the drafter never guesses an answer', () => {
    expect(askPreamble({ labels: ['the maximum budget'], itemTitle: 'Phase 2 scoping', work: 'reply', answers: 1 })).toMatch(/just tell me it here/);
    expect(askPreamble({ labels: ['the IBAN', 'the signed form'], itemTitle: 'Refund', work: 'reply', answers: 1 })).toMatch(/type the facts here, attach the rest/);
    expect(askPreamble({ labels: ['the deck'], itemTitle: 'Pitch', work: 'send_file' })).toMatch(/attach it or tell me where to look/);
    const t = buildTruth([{ label: 'IBAN', status: 'have', input: 'answer', supplied: 'XX00' }], [{ label: 'the maximum budget', status: 'missing', input: 'answer' }, { label: 'the deck', status: 'missing' }]);
    expect(t).toMatch(/GIVEN BY THE USER[^\n]*IBAN/);
    expect(t).toMatch(/STILL TO COME FROM THE USER[^\n]*the maximum budget[^\n]*\[PLACEHOLDER\]/);
    expect(t).toMatch(/MISSING \(NOT in hand\): the deck\./);
  });
});

describe('FIGURES ON RECORD', () => {
  it('reads amounts in any grouping, symbol before or after, with k/m', () => {
    expect(amountOf('40,000')).toBe(40000);
    expect(amountOf('40.000')).toBe(40000);
    expect(amountOf('1.200,50')).toBe(1200.5);
    expect(amountOf('1,200.50')).toBe(1200.5);
    expect(amountOf('45', 'k')).toBe(45000);
  });
  it('states two different amounts in one currency, with who and when; one amount (or a repeat) says nothing', () => {
    const two = [
      { who: 'Lee', at: '2026-09-25', text: 'Finance approved phase 2 at €40,000, including the two extra workshops.' },
      { who: 'Lee', at: '2026-09-29', text: 'For the kickoff deck please put the phase 2 budget as 45.000 € — the number our CFO has in the plan.' },
    ];
    expect(figuresOnRecord(two).map((f) => [f.currency, f.value, f.who])).toEqual([['EUR', 40000, 'Lee'], ['EUR', 45000, 'Lee']]);
    const block = figuresBlock(two)!;
    expect(block).toMatch(/^FIGURES ON RECORD/);
    expect(block).toMatch(/does NOT replace an earlier figure/);
    expect(block).toMatch(/€40,000 — Lee, 2026-09-25/);
    expect(figuresBlock([{ who: 'A', at: null, text: 'Invoice of €3,480 is due. Total €3,480.' }])).toBeNull();
    expect(figuresBlock([{ who: 'A', at: null, text: 'Budget €40,000 and a $45,000 quote.' }])).toBeNull();
  });
  it('the room grounding carries the block and the move never adopts one of two figures', () => {
    expect(src('lib/room/grounding.ts')).toMatch(/figuresBlock\(figureSources\),/);
    expect(src('lib/room/brief.ts')).toMatch(/a move never adopts one of two conflicting figures/);
  });
});

describe('TWO VALUES, BOTH NAMED — the Home briefing', () => {
  it('marks a candidate from the same person as an earlier one (folded)', () => {
    expect(sameWhoAs(['Kim (Globex Finance)', 'Sam', 'kim (globex finance) ', null, 'Sam'])).toEqual([0, 0, 1, 0, 2]);
  });
  it('an empty remainder clause ("the other 0 can wait") is dropped; a real count stays', () => {
    expect(dropEmptyRemainder('Sam needs the timeline. The other 0 can wait.')).toBe('Sam needs the timeline.');
    expect(dropEmptyRemainder('Start with {A1}; the other 2 can wait.')).toBe('Start with {A1}; the other 2 can wait.');
  });
  it('the briefing carries the ONE conduct rule text and the mark', () => {
    const c = src('lib/briefing/compose.ts');
    expect(c).toMatch(/\$\{CONDUCT_RULES\.conflicting_values\}/);
    expect(c).toMatch(/same person as \{A\$\{samePersonAs\[i\]\}\}/);
    expect(BRIEFING_PROMPT_VERSION).toBeGreaterThanOrEqual(11);
  });
});

describe('THE LAST REVISION IS THE DELIVERABLE — the verify gate', () => {
  it('a self-revised gate ships its last draft, never the first verdict', () => {
    const raw = 'Draft one keeps 100%.\n\n===GATE_VERDICT===\n\n```json\n{"status":"corrected","findings":[]}\n```\n\nWait, let me reconsider. Here is the fully corrected version:\n\nDraft two works toward the 98% target.';
    expect(lastRevision(raw)).toBe('Draft two works toward the 98% target.');
    expect(lastRevision('A.\n\n===GATE_VERDICT===\n{"status":"passed","findings":[{"quote":"a}b"}]}\nFinal.')).toBe('Final.');
    expect(lastRevision('One draft.\n\nTwo paragraphs.')).toBe('One draft.\n\nTwo paragraphs.');
    const two = 'D1.\n\n===GATE_VERDICT===\n```json\n{}\n```\n\nWait, let me reconsider. The source says 98%.\n\nLet me provide the correct output:\n\nFinal draft.';
    expect(lastRevision(two)).toBe('Final draft.');
    expect(src('lib/workflows/execute-step.ts')).toMatch(/const body = lastRevision\(raw\.slice\(0, cut\)\);/);
  });
  it('a correction the verdict claims but the draft still carries is caught (one corrective re-run)', () => {
    const f = [
      { source: 'rule' as const, action: 'corrected' as const, quote: 'Great news for Acme:' },
      { source: 'grounding' as const, action: 'corrected' as const, quote: 'expects 100% by next month' },
      { source: 'grounding' as const, action: 'masked' as const, quote: 'the client list' },
      { source: 'grounding' as const, action: 'corrected' as const, quote: 'short' },
    ];
    const bad = unappliedCorrections(f, 'Great news: the pilot hit 94% and our team expects 100%   by next month!');
    expect(bad.map((x) => x.quote)).toEqual(['expects 100% by next month']);
    expect(unappliedCorrections(f, 'Great news: the pilot hit 94%, working toward the 98% target.')).toEqual([]);
    expect(src('lib/workflows/execute-step.ts')).toMatch(/const unapplied = result\.verdict\.reported \? unappliedCorrections\(/);
  });
});
