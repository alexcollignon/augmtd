import { describe, it, expect } from 'vitest';
import { resolveRequestOf, resolveEmphasisOf } from '@/lib/work/item-actions';
import { bookedEventFor, scheduledSeatOf, scheduledWordOf, type BookingFacts, type CalendarRowLike } from '@/lib/work/scheduled';
import { deriveState, type DeriveInputs } from '@/lib/work/machine';
import { seatVerdict, whyNowOf, type AttentionRow } from '@/lib/home/attention';
import { draftReadinessOf, mayClaimReady } from '@/lib/prepare/card-readiness';
import { isLiveArtifact, type PreparedArtifact } from '@/lib/prepare/read';

// W15.2 · EVERY ITEM CAN BE CLOSED, AND SAYS WHERE IT STANDS — the pure halves (the smoke suite
// scripts/smoke-item-actions.ts gates the wiring and runs the two readers over a fake).
const NOW = '2026-09-24T09:00:00.000Z';
const base = (o: Partial<DeriveInputs> = {}): DeriveInputs => ({ open: true, verdict: { work: 'reply' }, judgedAt: NOW, prepared: [], liveAsk: false, sentStamp: false, nowISO: NOW, ...o });
const facts: BookingFacts = { addresses: ['sam@acme.test'], names: [], text: 'Join the call', verdictWork: 'reply', afterISO: '2026-09-20T00:00:00Z' };
const ev = (o: Partial<CalendarRowLike> = {}): CalendarRowLike => ({ id: 'e1', start_time: '2026-09-30T11:00:00Z', end_time: '2026-09-30T11:30:00Z', attendees: [{ email: 'sam@acme.test' }], status: 'confirmed', timezone: 'UTC', ...o });

describe('W15.2 · Done · Dismiss go through each kind\'s own door', () => {
  it('inbox kinds use complete / dismiss; commitments and follow-ups use the commitment PATCH', () => {
    expect(resolveRequestOf('email', 'x', 'done').url).toBe('/api/inbox/x/complete');
    expect(resolveRequestOf('email', 'x', 'dismiss').url).toBe('/api/inbox/x/dismiss');
    expect(resolveRequestOf('commitment', 'y', 'done').init.method).toBe('PATCH');
    expect(resolveRequestOf('followup', 'z', 'dismiss').url).toBe('/api/commitments/z');
  });
  it('Done leads only on looks_done / settled; a prepared primary keeps the pair secondary', () => {
    expect(resolveEmphasisOf('looks_done')).toBe('done');
    expect(resolveEmphasisOf('settled')).toBe('done');
    expect(resolveEmphasisOf('awaiting_approval')).toBe('none');
    expect(resolveEmphasisOf('awaiting_decision')).toBe('none');
  });
});

describe('W15.2 · scheduled is not overdue', () => {
  it('a booked future event with the counterparty makes a meeting obligation scheduled', () => {
    const booked = bookedEventFor(facts, [ev()], NOW);
    const s = deriveState(base({ booked }));
    expect(s.state).toBe('scheduled');
    expect(scheduledWordOf(s.scheduledLine)).toBe('scheduled — Wed, Sep 30, 11:00');
  });
  it('after the event it looks done; "Not yet" on that event keeps it down', () => {
    const booked = bookedEventFor(facts, [ev({ start_time: '2026-09-23T10:00:00Z', end_time: '2026-09-23T10:30:00Z' })], NOW);
    expect(deriveState(base({ booked })).state).toBe('looks_done');
    expect(deriveState(base({ booked, refusedBookings: ['e1'] })).state).not.toBe('looks_done');
  });
  it('never seated before its day, never overdue', () => {
    const row = { key: 'k', entityId: 'e', source: 'commitment', whyNow: '', overdue: true, dueToday: true, ...scheduledSeatOf('2026-09-30T11:00:00Z', '2026-09-24') } as AttentionRow;
    expect(seatVerdict(row).seated).toBe(false);
    expect(row.overdue).toBe(false);
    expect(whyNowOf({ source: 'commitment', overdue: true, dueDate: '2026-09-20', stateWord: 'scheduled — Wed, Sep 30, 11:00' }, new Date(NOW))).not.toMatch(/overdue/);
  });
});

describe('W15.2 · no empty "ready"; settled work carries no card', () => {
  it('an empty body is never ready nor sendable', () => {
    expect(mayClaimReady(draftReadinessOf({ recipients: ['a@b.test'], body: '' }))).toBe(false);
    expect(mayClaimReady(draftReadinessOf({ recipients: ['a@b.test'], body: 'Hi' }))).toBe(true);
  });
  it('a settled or empty artifact is never live', () => {
    const a: PreparedArtifact = { kind: 'reply_draft', title: null, content: 'Hi', by: null, at: null, attachment: null, provenance: null };
    expect(isLiveArtifact(a)).toBe(true);
    expect(isLiveArtifact({ ...a, settled: true })).toBe(false);
    expect(isLiveArtifact({ ...a, content: ' ' })).toBe(false);
  });
});
