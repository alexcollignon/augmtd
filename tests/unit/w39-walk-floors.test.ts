// W39 · THE OCT 1 WALK'S FLOORS — the pure outcomes (zero AI, zero network). The seats are
// scripts/smoke-w39-walk-floors.ts's; this file CALLS the functions.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mayFillEmptySeat, fillEmptySeat, mayReplaceInPlace } from '@/lib/room/no-mutation';
import { composeItemPage } from '@/components/thread/item-page';
import { dropUnseatedClaims, seatKindsOf } from '@/lib/room/seat-claims';
import { GATE_OUTCOME_WORDS } from '@/lib/workflows/process-state';
import { askItemShape } from '@/lib/room/go-ahead';
import { AskRows } from '@/components/thread/ask-rows';
import { sharedWordsLine } from '@/components/meetings/linked-work-panel';
import { toReaderVoice } from '@/lib/workflows/reader-voice';

describe('1 · THE EMPTY ACTION SEAT IS A SKELETON (no-mutation-and-address, W39)', () => {
  type V = { brief: string | null; prepared: Array<{ kind: string; content: string }>; machineState: { state: string } | null };
  const painted: V = { brief: 'Sam asked for the revised quote.', prepared: [], machineState: { state: 'awaiting_input' } };
  const landing: V = { brief: 'A recomposed opening.', prepared: [{ kind: 'reply_draft', content: 'Hi Sam — here it is.' }], machineState: { state: 'awaiting_approval' } };

  it('a painted view still holds a background/open landing whole (the law is unchanged)', () => {
    expect(mayReplaceInPlace('open', true)).toBe(false);
    expect(mayReplaceInPlace('user', true)).toBe(true);
  });
  it('only an EMPTY seat may be filled — never a widget, a placeholder, or an unreported seat', () => {
    expect(mayFillEmptySeat('empty')).toBe(true);
    expect(mayFillEmptySeat('widget')).toBe(false);
    expect(mayFillEmptySeat('placeholder')).toBe(false);
    expect(mayFillEmptySeat(null)).toBe(false);
  });
  it('the fill takes ONLY the seat fields — the opening the reader met keeps its words', () => {
    const filled = fillEmptySeat(painted, landing, ['prepared', 'machineState'] as const);
    expect(filled.brief).toBe(painted.brief);
    expect(filled.prepared).toEqual(landing.prepared);
    expect(filled.machineState).toEqual({ state: 'awaiting_approval' });
  });
  it('after the fill the item page seats the draft card (the walk: no card while Clara said ready)', () => {
    const before = composeItemPage({ machine: painted.machineState, mounted: {}, brief: painted.brief, who: 'Sam', ask: null, title: null, source: 'source' });
    expect(before.action).toBeNull();
    const after = composeItemPage({ machine: landing.machineState, mounted: { reply_draft: true }, brief: painted.brief, who: 'Sam', ask: null, title: null, source: 'source' });
    expect(after.action).toBe('email');
  });
});

describe('1b · A CLAIM RENDERS on the item exchange', () => {
  it('a claim of a draft the seat does not render is not shown', () => {
    for (const t of ['The reply is drafted and ready.', 'Clara drafted the reply on "Quote" — it\'s ready to review.', "I've drafted a reply to Sam."]) {
      expect(dropUnseatedClaims(t, seatKindsOf(null)).dropped.length).toBe(1);
    }
  });
  it('…and shows the moment the card does', () => {
    expect(dropUnseatedClaims('The reply is drafted and ready.', seatKindsOf('reply_draft')).dropped).toEqual([]);
  });
  it('an offer, a question or plain speech is never touched', () => {
    for (const t of ['I can draft it if you want.', 'Should I draft a reply?', 'Sam wants the figures by Friday.']) {
      expect(dropUnseatedClaims(t, seatKindsOf(null))).toEqual({ text: t, dropped: [] });
    }
  });
  it('the rest of the message keeps its words', () => {
    expect(dropUnseatedClaims('Thanks, that fills the gap. The reply is drafted and ready.', seatKindsOf(null)).text).toBe('Thanks, that fills the gap.');
  });
});

describe('3 · an answer is not a send', () => {
  it('the supply outcome says the answer was added', () => {
    expect(GATE_OUTCOME_WORDS.supplied.line).toBe('Answer added — the run continued.');
    expect(GATE_OUTCOME_WORDS.supplied.line).not.toMatch(/\bSent\b/);
    expect(GATE_OUTCOME_WORDS.supplied.chip).not.toMatch(/\bsent\b/i);
  });
});

describe('4 · the input kind drives the doors', () => {
  const render = (label: string, lead: 'fact' | 'document') => renderToStaticMarkup(createElement(AskRows, {
    rows: [label], doors: [{ lead, onType: () => undefined, onAttach: () => undefined, onPointToIt: () => undefined }],
  }));
  it('a signed contract is a document and offers no Type it', () => {
    expect(askItemShape('The signed contract')).toBe('document');
    const html = render('The signed contract', askItemShape('The signed contract'));
    expect(html).toContain('Attach');
    expect(html).not.toContain('Type it');
  });
  it('a figure on a document is a fact and leads with Type it', () => {
    expect(askItemShape('The invoice number')).toBe('fact');
    expect(askItemShape('Le montant du contrat')).toBe('fact');
    const html = render('The IBAN', 'fact');
    expect(html).toContain('Type it');
    expect(html).toContain('Attach');
  });
  it('a document row with no other door keeps typing (never a dead row)', () => {
    const html = renderToStaticMarkup(createElement(AskRows, { rows: ['The signed contract'], doors: [{ lead: 'document', onType: () => undefined }] }));
    expect(html).toContain('Type it');
  });
});

describe('5 · a linked row says why it is linked, in words', () => {
  it('names the shared words, never a bare percentage', () => {
    expect(sharedWordsLine(['Budget'])).toBe('Shares “budget” with this meeting’s title');
    expect(sharedWordsLine(['Budget', 'Review'])).toBe('Shares “budget” and “review” with this meeting’s title');
    expect(sharedWordsLine([])).toBeNull();
    expect(sharedWordsLine(['Budget'])).not.toMatch(/%/);
  });
});

describe('6 · the reader is "you"', () => {
  it('rewrites the builder\'s third person', () => {
    expect(toReaderVoice("Summarises new files from the user's documents every Monday.")).toBe('Summarises new files from your documents every Monday.');
    expect(toReaderVoice('Sends the user a digest.')).toBe('Sends you a digest.');
    expect(toReaderVoice('The user has a summary each week.')).toBe('You have a summary each week.');
    expect(toReaderVoice('Files invoices into the finance folder.')).toBe('Files invoices into the finance folder.');
  });
});

describe('W39b · a typed answer is the ask\'s answer, end to end', async () => {
  const { poolRowsToArtifacts, isTypedAnswerRow } = await import('@/lib/prepare/read');
  const { matchTypedLabel, buildTruth } = await import('@/lib/prepare/requirements');
  const typedRow = { id: 'r1', task_id: 'require:purchase order number to appear on the invoice', type: 'text', title: 'purchase order number to appear on the invoice', content: 'PO-0000-0001', metadata: { via: 'typed_supply', input: 'answer', source: 'requirement_resolution', requirement: 'purchase order number to appear on the invoice' }, created_at: '2026-10-01T10:00:00Z' };
  it('the reader never serves a typed answer as prepared work (no "ready to review" deliverable)', () => {
    expect(isTypedAnswerRow(typedRow)).toBe(true);
    expect(poolRowsToArtifacts([typedRow], 'email')).toEqual([]);
    const realDeliverable = { ...typedRow, id: 'r2', task_id: 'prepare-pass-deliverable', metadata: { source: 'preparation_pass' } };
    expect(poolRowsToArtifacts([realDeliverable], 'email').map((a) => a.kind)).toEqual(['deliverable']);
  });
  it('the answer survives the judge re-wording its label — and never matches a different fact', () => {
    const typed = [{ taskId: typedRow.task_id, label: 'purchase order number to appear on the invoice', text: 'PO-0000-0001' }];
    expect(matchTypedLabel('Purchase order number to appear on invoice', typed)?.text).toBe('PO-0000-0001');
    expect(matchTypedLabel('purchase order number for the invoice', typed)?.text).toBe('PO-0000-0001');
    expect(matchTypedLabel('signed contract', typed)).toBeNull();
    expect(matchTypedLabel('invoice due date', typed)).toBeNull();
    const two = [...typed, { taskId: 'require:x', label: 'purchase order number to appear on the receipt', text: 'X' }];
    expect(matchTypedLabel('purchase order number', two)).toBeNull(); // two equally good → never a guess
  });
  it('the drafter receives the VALUE as given content, not just its label', () => {
    const t = buildTruth([{ label: 'PO number', status: 'have', input: 'answer', supplied: 'PO-0000-0001' }], []);
    expect(t).toMatch(/GIVEN BY THE USER[^\n]*PO number: "PO-0000-0001"/);
    expect(t).toMatch(/never a placeholder/);
  });
});

describe('W39b · the claim net reads a claim anywhere in the sentence', () => {
  it('catches "I recorded your number and staged the reply draft" and "Clara found the file and drafted the send"', () => {
    expect(dropUnseatedClaims('I recorded your PO-0000-0001 and staged the reply draft.', seatKindsOf(null)).dropped.length).toBe(1);
    expect(dropUnseatedClaims('Clara found the file and drafted the send on "Quote".', seatKindsOf(null)).dropped.length).toBe(1);
    expect(dropUnseatedClaims('I recorded your PO-0000-0001 and staged the reply draft.', seatKindsOf('reply_draft')).dropped).toEqual([]);
  });
  it('never an offer, a future, a negation or a condition', () => {
    for (const t of ["I'll draft the reply once the contract is in.", "I haven't drafted the reply yet.", 'Once the reply is drafted you can review it.', 'I can have the reply drafted today.']) {
      expect(dropUnseatedClaims(t, seatKindsOf(null)).dropped).toEqual([]);
    }
  });
});

describe('W39c · the reader\'s own words persist, in order; an empty conversation fills', async () => {
  const { orphanQuestion, isAskDeedKey, actionFollowsExchange } = await import('@/components/home/room-chat');
  it('an ask deed (typed answer / go-ahead) is never an orphan question ("No answer was saved")', () => {
    expect(isAskDeedKey('supply:t1:require:po number')).toBe(true);
    expect(isAskDeedKey('proceed:t1')).toBe(true);
    expect(isAskDeedKey('ask:r1')).toBe(false);
    expect(orphanQuestion([{ role: 'user', deed: true as const }], false)).toBeNull();
    expect(orphanQuestion([{ role: 'user' }], false)).not.toBeNull();
  });
  it('the work a deed produced follows the reader\'s words; an ask or a gate never moves', () => {
    const ex = [{ role: 'user', deed: true as const }];
    expect(actionFollowsExchange('reply_draft', ex)).toBe(true);
    expect(actionFollowsExchange('ask', ex)).toBe(false);
    expect(actionFollowsExchange('gate', ex)).toBe(false);
    expect(actionFollowsExchange('reply_draft', [{ role: 'user' }])).toBe(false);
  });
});
