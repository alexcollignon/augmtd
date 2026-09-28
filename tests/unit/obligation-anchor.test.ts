import { describe, expect, it } from 'vitest';
import { obligationAnchorOf, statedMeetingDateOf, heldMeetingSettles, askStatesBound } from '@/lib/work/obligation-anchor';
import { bookedEventFor, type CalendarRowLike } from '@/lib/work/scheduled';
import { bookingFactsOf, deriveState, gateBooked } from '@/lib/work/machine';
import { looksDoneScopeOf, looksDoneEvidenceOf } from '@/lib/evidence/looks-done';
import type { Evidence } from '@/lib/evidence/match';

// THE OWNER-WALK SHAPE (W20.C): born Sep 16 on an earlier ask, re-pointed to a Sep 27 message that
// asks for a call on Oct 12; a Sep 21 meeting with the same counterparty stands in the held window.
const REPOINTED = {
  created_at: '2026-09-16T08:00:00Z',
  last_activity_at: '2026-09-27T09:00:00Z',
  work_title: 'Confirm implementation call',
  source_data: {
    from_address: 'sam@acme.test', from_name: 'Sam Lee', subject: 'Implementation',
    received_at: '2026-09-27T09:00:00Z',
    understanding: { role: 'addressed', relevance: 'reply', ask: 'Confirm the implementation call on Oct 12', deadline: '2026-10-12' },
  },
};
const ev = (id: string, start: string, end: string): CalendarRowLike => ({
  id, start_time: start, end_time: end, title: 'Acme sync', attendees: [{ email: 'sam@acme.test' }], status: 'confirmed', timezone: 'UTC',
});
const verdict = { work: 'reply' };

describe('obligationAnchorOf — THE ONE ANCHOR', () => {
  it('inbox: the latest of the current message and the newest inbound, never the birth', () => {
    expect(obligationAnchorOf('inbox', REPOINTED)).toBe('2026-09-27T09:00:00Z');
    expect(obligationAnchorOf('inbox', { ...REPOINTED, last_activity_at: '2026-09-28T10:00:00Z' })).toBe('2026-09-28T10:00:00Z');
    expect(obligationAnchorOf('inbox', { ...REPOINTED, last_activity_at: '2026-09-20T10:00:00Z' })).toBe('2026-09-27T09:00:00Z');
  });
  it('inbox: created_at only when no message clock parses (a backfilled birth never hides a reply)', () => {
    expect(obligationAnchorOf('inbox', { created_at: '2026-09-16T08:00:00Z', source_data: {} })).toBe('2026-09-16T08:00:00Z');
    expect(obligationAnchorOf('inbox', { created_at: '2026-09-16T08:00:00Z', last_activity_at: '2026-09-10T08:00:00Z', source_data: {} })).toBe('2026-09-10T08:00:00Z');
    expect(obligationAnchorOf('inbox', null)).toBe('');
  });
  it('commitment: created_at', () => {
    expect(obligationAnchorOf('commitment', { created_at: '2026-09-16T08:00:00Z', last_activity_at: '2026-09-27T00:00:00Z' })).toBe('2026-09-16T08:00:00Z');
  });
});

describe('the held-meeting rule', () => {
  it('a named future date bounds the meeting; a "by" date does not', () => {
    expect(statedMeetingDateOf('2026-10-12', '2026-09-27T09:00:00Z', 'Confirm the call on Oct 12')).toBe('2026-10-12');
    expect(statedMeetingDateOf('2026-10-02', '2026-09-27T09:00:00Z', 'Book a call by Friday')).toBeNull();
    expect(statedMeetingDateOf('2026-09-20', '2026-09-27T09:00:00Z', 'Call on Sep 20')).toBeNull(); // stale — before the ask
    expect(askStatesBound('bis Freitag')).toBe(true);
    expect(askStatesBound('Call on Oct 12')).toBe(false);
  });
  it('before the anchor or before the named date → not the deed', () => {
    expect(heldMeetingSettles('2026-09-21T10:00:00Z', '2026-09-27T09:00:00Z', '2026-10-12')).toBe(false);
    expect(heldMeetingSettles('2026-09-30T10:00:00Z', '2026-09-27T09:00:00Z', '2026-10-12')).toBe(false);
    expect(heldMeetingSettles('2026-10-12T07:30:00Z', '2026-09-27T09:00:00Z', '2026-10-12')).toBe(true);
    expect(heldMeetingSettles('2026-09-30T10:00:00Z', '2026-09-27T09:00:00Z', null)).toBe(true);
  });
});

describe('W20.C — the machine never reads "You met on Sep 21" on an Oct 12 ask', () => {
  it('the owner-walk shape does NOT look done', () => {
    const NOW = '2026-10-01T12:00:00Z';
    const facts = bookingFactsOf('inbox', REPOINTED, verdict)!;
    expect(facts.afterISO).toBe('2026-09-27T09:00:00Z');
    expect(facts.meetingDate).toBe('2026-10-12');
    const booked = gateBooked(bookedEventFor(facts, [ev('sep21', '2026-09-21T10:00:00Z', '2026-09-21T10:30:00Z')], NOW), facts);
    expect(booked?.held).toBeNull();
    const st = deriveState({ open: true, verdict, judgedAt: null, prepared: [], liveAsk: false, sentStamp: false, booked, nowISO: NOW });
    expect(st.state).not.toBe('looks_done');
  });
  it('the OLD anchor (created_at) would have raised it — the regression this wave removes', () => {
    const NOW = '2026-10-01T12:00:00Z';
    const facts = bookingFactsOf('inbox', REPOINTED, verdict)!;
    const old = bookedEventFor({ ...facts, afterISO: REPOINTED.created_at, meetingDate: null }, [ev('sep21', '2026-09-21T10:00:00Z', '2026-09-21T10:30:00Z')], NOW);
    expect(old.held?.id).toBe('sep21');
  });
  it('a meeting after the anchor on the asked date DOES look done, scoped held_meeting', () => {
    const NOW = '2026-10-13T12:00:00Z';
    const facts = bookingFactsOf('inbox', REPOINTED, verdict)!;
    const booked = gateBooked(bookedEventFor(facts, [ev('oct12', '2026-10-12T09:30:00Z', '2026-10-12T10:00:00Z')], NOW), facts);
    expect(booked?.held?.id).toBe('oct12');
    expect(booked?.held?.scope).toBe('held_meeting');
    const st = deriveState({ open: true, verdict, judgedAt: null, prepared: [], liveAsk: false, sentStamp: false, booked, nowISO: NOW });
    expect(st.state).toBe('looks_done');
    expect(st.heldEventId).toBe('oct12');
    expect(st.heldScope).toBe('held_meeting');
    expect(st.heldAt).toBe('2026-10-12T09:30:00Z');
  });
  it('a meeting after the anchor but before the asked date does not', () => {
    const NOW = '2026-10-01T12:00:00Z';
    const facts = bookingFactsOf('inbox', REPOINTED, verdict)!;
    const booked = gateBooked(bookedEventFor(facts, [ev('sep30', '2026-09-30T10:00:00Z', '2026-09-30T10:30:00Z')], NOW), facts);
    expect(booked?.held).toBeNull();
  });
});

describe('the settle door passes the same gate', () => {
  const held = (at: string, key: 'object' | 'person'): Evidence => ({
    type: 'calendar', id: `e-${at}`, at, title: 'Acme sync', key, status: 'held', deed: 'meeting_held', source: 'calendar',
  } as unknown as Evidence);
  it('looksDoneScopeOf refuses a held meeting before the anchor or the named date', () => {
    const opts = { meetingShaped: true, anchorISO: '2026-09-27T09:00:00Z', meetingDate: '2026-10-12' };
    expect(looksDoneScopeOf(held('2026-09-21T10:00:00Z', 'person'), opts)).toBeNull();
    expect(looksDoneScopeOf(held('2026-09-21T10:00:00Z', 'object'), opts)).toBeNull();
    expect(looksDoneScopeOf(held('2026-10-12T09:30:00Z', 'person'), opts)).toBe('held_meeting');
    expect(looksDoneEvidenceOf([held('2026-09-21T10:00:00Z', 'person')], 'unclear', 'user', opts)).toBeNull();
  });
});
