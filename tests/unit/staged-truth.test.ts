// W13 · A STAGED FILE IS THE DELIVERABLE, OR IT ISN'T STAGED — the pure halves of the staging role,
// the work-done completion forms, the reader's base withdrawal and the card's staged chips.
import { describe, expect, it } from 'vitest';
import {
  stagingRole, stagedRowVerdict, requestNamesFile, dateInFilename, effectiveFileAt, buildTruth, kindOf,
} from '@/lib/prepare/requirements';
import { completionClaimIn, attachmentClaimIn, vetDraft } from '@/lib/prepare/truth';
import { stampTruth, baseFileIdsOf, commitmentTruthFacts, type PreparedArtifact } from '@/lib/prepare/read';
import { stagedFilesOf } from '@/lib/prepare/email-card';

const REQUEST_AT = '2026-09-10T14:59:47Z';
const OLD = { filename: 'Acme_Interim_Report_20260910.pptx', fileAt: '2026-09-11T13:26:00Z' };
const LIVE = 'The interim report now includes slides 7 and 8 with detail on the remaining functions. Document is attached.';

describe('the staging role', () => {
  it('reads the earliest date a file can have (its name beats a late index)', () => {
    expect(dateInFilename(OLD.filename)).toBe('2026-09-10T00:00:00.000Z');
    expect(effectiveFileAt(OLD)).toBe('2026-09-10T00:00:00.000Z');
    expect(effectiveFileAt({ fileAt: null, filename: 'deck.pdf' })).toBeNull();
  });
  it('never lets a file from on/before the request satisfy new work — it is the base', () => {
    expect(stagingRole({ kind: 'new_work', fileAt: effectiveFileAt(OLD), requestAt: REQUEST_AT, namedByRequest: true })).toBe('base');
    expect(stagingRole({ kind: 'new_work', fileAt: REQUEST_AT, requestAt: REQUEST_AT, namedByRequest: true })).toBe('base');
    expect(stagingRole({ kind: 'new_work', fileAt: null, requestAt: REQUEST_AT, namedByRequest: true })).toBe('base');
    expect(stagingRole({ kind: 'new_work', fileAt: '2026-09-12T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: false })).toBe('deliverable');
  });
  it('lets an older file satisfy an existing-artifact ask only when the request names it', () => {
    expect(stagingRole({ kind: 'existing', fileAt: '2026-08-01T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: true })).toBe('deliverable');
    expect(stagingRole({ kind: 'existing', fileAt: '2026-08-01T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: false })).toBe('suggest');
    expect(requestNamesFile(OLD.filename, 'slides 7&8 in the interim report')).toBe(true);
    expect(requestNamesFile('Report_2026.pdf', 'send the report')).toBe(false);
  });
  it('classifies rows staged before the kind existed for the repair', () => {
    const f = effectiveFileAt(OLD);
    expect(stagedRowVerdict({ kind: null, fileAt: f, requestAt: REQUEST_AT, namedByRequest: true })).toBe('suspect');
    expect(stagedRowVerdict({ kind: 'new_work', fileAt: f, requestAt: REQUEST_AT, namedByRequest: true })).toBe('violation');
    expect(stagedRowVerdict({ kind: null, fileAt: f, requestAt: REQUEST_AT, namedByRequest: false })).toBe('violation');
    expect(kindOf('new_work')).toBe('new_work');
    expect(kindOf('maybe')).toBeNull();
  });
  it('tells the drafter the base is context, never the answer', () => {
    const t = buildTruth([], [{ label: 'slides 7&8', status: 'missing', base: { source: 'kb', id: 'x', filename: OLD.filename } }]);
    expect(t).toMatch(/BASE ONLY/);
    expect(t).not.toMatch(/STAGED \(attached/);
  });
});

describe('completion honesty', () => {
  it('catches the work-done forms and the bare "is attached"', () => {
    expect(completionClaimIn(LIVE)).toBe('now includes');
    expect(attachmentClaimIn(LIVE)).toBe('Document is attached');
    for (const t of ["We've added the rows.", 'The slides have been updated.', 'Os slides foram atualizados.', 'Die Folien wurden ergänzt.', 'Le rapport est prêt.']) {
      expect(completionClaimIn(t), t).not.toBeNull();
    }
  });
  it('leaves futures, negations and "ready to" alone', () => {
    for (const t of ['I will update the deck.', 'I have not updated it yet.', 'Let me know when it is ready.', 'We are ready to proceed.', 'Die Folien wurden nicht ergänzt.']) {
      expect(completionClaimIn(t), t).toBeNull();
    }
  });
  it('judges a base riding the draft as NOT the work', () => {
    expect(vetDraft(LIVE, { obligationOpen: true, staged: true, stagedIsWork: false })?.floor).toBe('completion');
    expect(vetDraft(LIVE, { obligationOpen: true, staged: true })).toBeNull();
  });
  it('withdraws a machine draft that sends the base as the answer (never the user\'s own words)', () => {
    const facts = { ...commitmentTruthFacts({ description: 'x', created_at: REQUEST_AT, status: 'open', direction: 'you_owe' })!, baseFileIds: baseFileIdsOf([{ metadata: { role: 'base', attachment: { fileId: 'b' } } }]) };
    const art = (hand: boolean) => ({ kind: 'reply_draft', title: null, content: 'Hi', by: null, at: null, provenance: null,
      attachment: { fileId: 'b', filename: OLD.filename }, ...(hand ? { hand: { editedAt: 'x' } } : {}) } as PreparedArtifact);
    expect(stampTruth([art(false)], facts)[0].baseAsAnswer).toBe(true);
    expect(stampTruth([art(true)], facts)[0].falseClaim).toBeFalsy();
  });
});

describe('the card\'s staged chips', () => {
  it('keeps KB-held files with real ids, deduped', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(stagedFilesOf([{ fileId: id, filename: 'a', source: 'kb' }, { fileId: id, filename: 'a' }, { fileId: id.replace('1', '9'), source: 'gdrive' }])).toHaveLength(1);
    expect(stagedFilesOf(undefined)).toHaveLength(0);
  });
});
