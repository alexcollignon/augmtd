import { describe, it, expect } from 'vitest';
import { vetDraft, draftThroughVet, commitmentComposeTask, composeDraftRow } from '@/lib/prepare/truth';
import { poolRowsToArtifacts, stampTruth, isLiveArtifact, commitmentTruthFacts } from '@/lib/prepare/read';
import { enforceRelativeTimeTruth, relativeDayRange, dayDiff, absoluteDayLabel } from '@/lib/room/self-voice';

// W12.1 · EVERY DRAFT PASSES THE SAME TRUTH — the pure floors behind scripts/smoke-compose-truth.ts.

const OWNER = 'Just a quick nudge on the small edit we discussed — changing the label in the second tab of the attached interim report. Let me know when you\'ve had a chance to take a look.';
const DELIVERY = 'I\'ll change the label in the second tab today and send the updated report by Friday.';

describe('vetDraft — the one vet', () => {
  it('fails the owner\'s words on you_owe work, attachment first', () => {
    expect(vetDraft(OWNER, { obligationOpen: true, staged: false })?.floor).toBe('attachment');
  });
  it('fails a chase on you_owe and passes it on awaiting', () => {
    const chase = OWNER.replace(' of the attached interim report', '');
    expect(vetDraft(chase, { obligationOpen: true, staged: false })?.floor).toBe('chase');
    expect(vetDraft(chase, { obligationOpen: false, staged: false })).toBeNull();
  });
  it('is silent when something is staged, and passes an honest delivery', () => {
    expect(vetDraft(OWNER, { obligationOpen: true, staged: true })).toBeNull();
    expect(vetDraft(DELIVERY, { obligationOpen: true, staged: false })).toBeNull();
  });
});

describe('draftThroughVet — regenerate once, else serve nothing', () => {
  it('serves the passing regeneration and names the failure to it', async () => {
    const seen: Array<string | null> = [];
    const r = await draftThroughVet(async (o) => { seen.push(o); return seen.length === 1 ? OWNER : DELIVERY; }, { obligationOpen: true, staged: false });
    expect(r.body).toBe(DELIVERY);
    expect(seen[1]).toMatch(/attached/);
  });
  it('serves nothing after two failures', async () => {
    const r = await draftThroughVet(async () => OWNER, { obligationOpen: true, staged: false });
    expect(r.body).toBe('');
    expect(r.failed).not.toBeNull();
  });
});

describe('commitmentComposeTask — direction frames the message', () => {
  it('you_owe delivers; awaiting chases', () => {
    expect(commitmentComposeTask({ direction: 'you_owe', description: 'x' }, 'Sam')).toMatch(/DELIVERS it/);
    expect(commitmentComposeTask({ direction: 'awaiting', description: 'x' }, 'Sam')).toMatch(/follow-up asking Sam/);
  });
});

describe('composeDraftRow — the reader serves what the door pools', () => {
  it('a delivery row reads back as a live reply_draft', () => {
    const row = composeDraftRow({ userId: 'u', commitmentId: 'c', direction: 'you_owe', body: DELIVERY, recipientLabel: 'Sam', preparedFrom: null, addresseeStamp: {} });
    const arts = stampTruth(poolRowsToArtifacts([{ id: 'r', task_id: null, created_at: '2026-09-23T10:00:00Z', ...row }], 'commitment'),
      commitmentTruthFacts({ description: 'x', created_at: '2026-08-28T10:00:00Z', status: 'open', direction: 'you_owe' }));
    expect(arts[0].kind).toBe('reply_draft');
    expect(isLiveArtifact(arts[0])).toBe(true);
  });
});

describe('enforceRelativeTimeTruth — time truth in the brief', () => {
  const today = '2026-09-23';
  const events = [{ day: '2026-08-28', who: 'Sam Rivera' }, { day: '2026-09-17', who: null }];
  it('rewrites the attributed false claim to its absolute date', () => {
    expect(enforceRelativeTimeTruth('Sam asked us nine days ago.', { today, events }).text).toBe('Sam asked us on Aug 28.');
  });
  it('keeps a verified claim and drops an unverifiable unattributed one', () => {
    expect(enforceRelativeTimeTruth('A message landed six days ago.', { today, events }).text).toBe('A message landed six days ago.');
    expect(enforceRelativeTimeTruth('It moved three days ago, and stalled.', { today, events }).text).toBe('It moved, and stalled.');
  });
  it('parses the vocabulary', () => {
    expect(relativeDayRange('yesterday', today)).toEqual([1, 1]);
    expect(relativeDayRange('nine days ago', today)).toEqual([8, 10]);
    expect(dayDiff('2026-09-23', '2026-08-28')).toBe(26);
    expect(absoluteDayLabel('2025-12-01', today)).toBe('Dec 1, 2025');
  });
});
