import { describe, it, expect } from 'vitest';
import {
  parseIcs, unfoldIcs, parseIcsLine, ianaZoneOf, durationMs, inviteFromGraphEventMessage,
  uidKeys, sameMeetingUid, inviteIsCancelled,
} from '@/lib/calendar/ics';
import {
  GOOGLE_REQUEST, OUTLOOK_REQUEST, OUTLOOK_UID, VTIMEZONE_ONLY, RECURRING_REQUEST, CANCEL, ALL_DAY,
  FLOATING, NO_UID, GRAPH_EVENT_MESSAGE, exchangeEmbeddedUid,
} from '../fixtures/invites';

describe('ICS lexing', () => {
  it('unfolds CRLF + whitespace continuations', () => {
    const lines = unfoldIcs('A:one\r\n  two\r\nB:three');
    expect(lines).toEqual(['A:one two', 'B:three']);
  });
  it('splits name, quoted params and a value containing a colon', () => {
    const p = parseIcsLine('ATTENDEE;CN="Lee, Morgan";PARTSTAT=TENTATIVE:mailto:morgan.lee@acme.test');
    expect(p?.name).toBe('ATTENDEE');
    expect(p?.params.CN).toBe('Lee, Morgan');
    expect(p?.params.PARTSTAT).toBe('TENTATIVE');
    expect(p?.value).toBe('mailto:morgan.lee@acme.test');
  });
  it('reads durations', () => {
    expect(durationMs('PT1H30M')).toBe(90 * 60_000);
    expect(durationMs('P1D')).toBe(86_400_000);
    expect(durationMs('nonsense')).toBeNaN();
  });
  it('resolves IANA, path-prefixed and Windows zone names', () => {
    expect(ianaZoneOf('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(ianaZoneOf('/mozilla.org/20050126_1/Europe/Berlin')).toBe('Europe/Berlin');
    expect(ianaZoneOf('W. Europe Standard Time')).toBe('Europe/Berlin');
    expect(ianaZoneOf('Custom Zone Fixture')).toBeNull();
  });
});

describe('parseIcs — Google shape', () => {
  const i = parseIcs(GOOGLE_REQUEST)!;
  it('reads the identity, method and sequence', () => {
    expect(i.uid).toBe('7kq2abc9fixture0001@google.com');
    expect(i.method).toBe('REQUEST');
    expect(i.sequence).toBe(2);
  });
  it('places a TZID time in UTC (Lisbon in November = +0000)', () => {
    expect(i.startISO).toBe('2026-11-15T10:00:00.000Z');
    expect(i.endISO).toBe('2026-11-15T11:30:00.000Z');
    expect(i.allDay).toBe(false);
    expect(i.floating).toBe(false);
  });
  it('unescapes text and keeps the people', () => {
    expect(i.summary).toBe('[TBC] Acme @ HQ, quarterly review');
    expect(i.location).toBe('Acme HQ, Room 4');
    expect(i.organizer).toEqual({ address: 'sam.rivera@acme.test', name: 'Sam Rivera' });
    expect(i.attendees.map((a) => a.address)).toEqual(['sam.rivera@acme.test', 'jordan@example.test', 'morgan.lee@acme.test']);
    // A CN that is just the address again is not a name.
    expect(i.attendees[1].name).toBeNull();
    expect(i.attendees[2]).toMatchObject({ name: 'Lee, Morgan', partstat: 'TENTATIVE', role: 'OPT-PARTICIPANT' });
    expect(inviteIsCancelled(i)).toBe(false);
  });
});

describe('parseIcs — Outlook shape', () => {
  it('reads a Windows TZID (CEST in July = +0200) and the Exchange UID', () => {
    const i = parseIcs(OUTLOOK_REQUEST)!;
    expect(i.uid).toBe(OUTLOOK_UID);
    expect(i.startISO).toBe('2026-07-07T12:00:00.000Z');
    expect(i.endISO).toBe('2026-07-07T12:30:00.000Z');
    expect(i.location).toBe('Microsoft Teams Meeting');
  });
  it('places a zone known ONLY by its VTIMEZONE rules', () => {
    const i = parseIcs(VTIMEZONE_ONLY)!;
    expect(i.startISO).toBe('2026-07-07T12:00:00.000Z');
    // …and the STANDARD observance in winter.
    const winter = parseIcs(VTIMEZONE_ONLY.replace(/20260707/g, '20261201'))!;
    expect(winter.startISO).toBe('2026-12-01T13:00:00.000Z');
  });
});

describe('parseIcs — recurring, cancel, all-day, floating', () => {
  it('a series: the MASTER speaks; DURATION gives the end', () => {
    const i = parseIcs(RECURRING_REQUEST)!;
    expect(i.recurring).toBe(true);
    expect(i.rrule).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(i.recurrenceId).toBeNull();
    expect(i.summary).toBe('Weekly Acme standup');
    expect(i.endISO).toBe('2026-10-06T09:45:00.000Z');
  });
  it('a cancellation reads as cancelled', () => {
    const i = parseIcs(CANCEL)!;
    expect(i.method).toBe('CANCEL');
    expect(i.status).toBe('CANCELLED');
    expect(inviteIsCancelled(i)).toBe(true);
  });
  it('an all-day event keeps its dates (end exclusive)', () => {
    const i = parseIcs(ALL_DAY)!;
    expect(i.allDay).toBe(true);
    expect(i.startDate).toBe('2026-12-01');
    expect(i.endDate).toBe('2026-12-03');
    expect(i.startISO).toBeNull();
  });
  it('a floating time is placed in the fallback zone and SAYS so', () => {
    const i = parseIcs(FLOATING, { fallbackTz: 'Europe/Lisbon' })!;
    expect(i.floating).toBe(true);
    expect(i.startISO).toBe('2026-11-10T15:00:00.000Z');
  });
  it('no UID / no calendar → null, never a half-invite', () => {
    expect(parseIcs(NO_UID)).toBeNull();
    expect(parseIcs('hello')).toBeNull();
  });
});

describe('Graph eventMessage → the same shape', () => {
  it('maps identity, method, window, people and the provider event id', () => {
    const i = inviteFromGraphEventMessage(GRAPH_EVENT_MESSAGE)!;
    expect(i.source).toBe('graph');
    expect(i.uid).toBe(OUTLOOK_UID);
    expect(i.method).toBe('REQUEST');
    expect(i.startISO).toBe('2026-07-07T12:00:00.000Z');
    expect(i.providerEventId).toBe('AAMkAG-event-fixture');
    expect(i.attendees[0]).toMatchObject({ address: 'jordan@example.test', partstat: 'NEEDS-ACTION', role: 'REQ-PARTICIPANT' });
  });
  it('a cancelled meeting message reads CANCEL', () => {
    const i = inviteFromGraphEventMessage({ ...GRAPH_EVENT_MESSAGE, meetingMessageType: 'meetingCancelled' })!;
    expect(i.method).toBe('CANCEL');
    expect(inviteIsCancelled(i)).toBe(true);
  });
  it('no event / no iCalUId → null', () => {
    expect(inviteFromGraphEventMessage({ meetingMessageType: 'meetingRequest' })).toBeNull();
  });
});

describe('identity keys', () => {
  it('an Exchange id that EMBEDS a Google UID matches that UID', () => {
    const embedded = exchangeEmbeddedUid('7kq2abc9fixture0001@google.com');
    expect(uidKeys(embedded).has('7kq2abc9fixture0001@google.com')).toBe(true);
    expect(sameMeetingUid(embedded, '7kq2abc9fixture0001@google.com')).toBe(true);
  });
  it('an Exchange occurrence id matches its series id (date bytes zeroed)', () => {
    const series = OUTLOOK_UID.slice(0, 32) + '00000000' + OUTLOOK_UID.slice(40);
    const occurrence = OUTLOOK_UID.slice(0, 32) + '07EA0B0F' + OUTLOOK_UID.slice(40);
    expect(sameMeetingUid(series, occurrence)).toBe(true);
  });
  it('different meetings never match; case folds', () => {
    expect(sameMeetingUid('a@google.com', 'b@google.com')).toBe(false);
    expect(sameMeetingUid('ABC@acme.test', 'abc@acme.test')).toBe(true);
    expect(sameMeetingUid('', '')).toBe(false);
  });
});
