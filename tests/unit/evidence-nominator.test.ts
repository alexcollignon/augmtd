// EVIDENCE SETTLES (W3.1) — the nominator's pure cores. Zero IO, zero AI. Fixtures use fake
// identities only (Acme / Sam).
import { describe, it, expect } from 'vitest';
import {
  addressesOf, matchEvidence, evidenceSig, attendeeAddressByName, registryAddress, sameAddress,
  EVIDENCE_PER_TYPE, type EvidencePool, type OpenWork,
} from '@/lib/work/evidence-nominator';

const NOW = '2026-09-22T12:00:00.000Z';
const CP = 'sam@acme-example.com';

const pool: EvidencePool = {
  emails: [
    { id: 'e-old', at: '2026-08-01T10:00:00Z', subject: 'before it arose', from: 'me@example.com', to: [CP], threadId: 't9', attachmentCount: 0, fromUser: true },
    { id: 'e1', at: '2026-09-10T10:00:00Z', subject: 'the deck', from: 'me@example.com', to: ['SAM@Acme-Example.com'], threadId: 't2', attachmentCount: 1, fromUser: true },
    { id: 'e2', at: '2026-09-12T10:00:00Z', subject: 'cc only', from: 'me@example.com', to: ['other@x.com', CP], threadId: 't3', attachmentCount: null, fromUser: true },
    { id: 'e3', at: '2026-09-14T10:00:00Z', subject: 'newest', from: 'me@example.com', to: [CP], threadId: 't4', attachmentCount: 0, fromUser: true },
    { id: 'e4', at: '2026-09-15T10:00:00Z', subject: 'fourth', from: 'me@example.com', to: [CP], threadId: 't5', attachmentCount: 0, fromUser: true },
    { id: 'e-other', at: '2026-09-13T10:00:00Z', subject: 'to someone else', from: 'me@example.com', to: ['nobody@x.com'], threadId: 't6', attachmentCount: 0, fromUser: true },
    { id: 'e-same-thread', at: '2026-09-11T10:00:00Z', subject: 'same thread, no cp in to', from: 'me@example.com', to: ['forward@x.com'], threadId: 't1', attachmentCount: 0, fromUser: true },
    { id: 'e-inbound', at: '2026-09-16T10:00:00Z', subject: 'they wrote', from: CP, to: ['me@example.com'], threadId: 't7', attachmentCount: 0, fromUser: false },
  ],
  events: [
    { id: 'c-held', at: '2026-09-11T09:00:00Z', end: '2026-09-11T10:00:00Z', title: 'Sync with Sam', attendees: [CP, 'me@example.com'], cancelled: false },
    { id: 'c-booked', at: '2026-09-30T09:00:00Z', end: '2026-09-30T10:00:00Z', title: 'Next call', attendees: [CP], cancelled: false },
    { id: 'c-cancelled', at: '2026-09-12T09:00:00Z', end: '2026-09-12T10:00:00Z', title: 'Cancelled', attendees: [CP], cancelled: true },
    { id: 'c-before', at: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z', title: 'Before', attendees: [CP], cancelled: false },
  ],
  transcripts: [
    { id: 'tr1', at: '2026-09-11T09:05:00Z', title: 'Sync with Sam (recording)', attendees: [CP] },
    { id: 'tr-none', at: '2026-09-11T09:05:00Z', title: 'Other meeting', attendees: ['x@y.com'] },
  ],
};

const work: OpenWork = { kind: 'commitment', id: 'k1', afterISO: '2026-09-01T00:00:00Z', counterpartyEmail: CP, threadId: 't1', fulfiller: 'user', description: 'send Sam the deck' };

describe('addressesOf', () => {
  it('reads calendar objects, transcript strings and "Name <email>" forms, normalized + deduped', () => {
    expect(addressesOf([{ email: 'Sam@Acme-Example.com', name: 'Sam' }, 'Sam Vendor <sam@acme-example.com>', 'plain@x.com', { name: 'no email' }, 42]))
      .toEqual(['sam@acme-example.com', 'plain@x.com']);
  });
});

describe('matchEvidence', () => {
  it('nominates only evidence strictly AFTER the work arose, with the counterparty, newest first, top N per type', () => {
    const ev = matchEvidence(pool, work, NOW);
    const emails = ev.filter((e) => e.type === 'email').map((e) => e.id);
    expect(emails).toEqual(['e4', 'e3', 'e2']); // e1 dropped by the per-type cap (newest first), e-old before, e-other unrelated
    expect(emails.length).toBe(EVIDENCE_PER_TYPE);
    expect(ev.find((e) => e.id === 'e-inbound')).toBeUndefined(); // a you_owe is settled by the USER's deed
  });
  it('a same-thread user message counts even when the recipient list does not carry the address (the forward case is judged, not dropped)', () => {
    const ev = matchEvidence(pool, { ...work, afterISO: '2026-09-10T12:00:00Z' }, NOW);
    expect(ev.filter((e) => e.type === 'email').map((e) => e.id)).toEqual(['e4', 'e3', 'e2']);
    const ev2 = matchEvidence(pool, { ...work, afterISO: '2026-09-10T12:00:00Z', counterpartyEmail: null }, NOW);
    expect(ev2.map((e) => e.id)).toEqual(['e-same-thread']); // no address → thread only, no meetings
  });
  it('calendar: held vs booked by the clock; cancelled and pre-dating events never nominate', () => {
    const cal = matchEvidence(pool, work, NOW).filter((e) => e.type === 'calendar');
    expect(cal.map((e) => [e.id, e.status])).toEqual([['c-booked', 'booked'], ['c-held', 'held']]);
  });
  it('transcripts match by attendee address only', () => {
    const tr = matchEvidence(pool, work, NOW).filter((e) => e.type === 'transcript');
    expect(tr.map((e) => e.id)).toEqual(['tr1']);
  });
  it('an AWAITING obligation is settled by the counterparty\'s inbound, never by the user\'s own mail', () => {
    const ev = matchEvidence(pool, { ...work, fulfiller: 'counterparty', threadId: null }, NOW);
    expect(ev.filter((e) => e.type === 'email').map((e) => e.id)).toEqual(['e-inbound']);
  });
  it('no afterISO → nothing (an undated origin cannot bound "later")', () => {
    expect(matchEvidence(pool, { ...work, afterISO: '' }, NOW)).toEqual([]);
  });
});

describe('evidenceSig', () => {
  it('is order-independent and changes when a new piece arrives', () => {
    const a = matchEvidence(pool, work, NOW);
    const b = [...a].reverse();
    expect(evidenceSig(a)).toBe(evidenceSig(b));
    expect(evidenceSig(a)).not.toBe(evidenceSig(a.slice(1)));
  });
});

describe('identity helpers', () => {
  it('sameAddress is case-blind and null-safe', () => {
    expect(sameAddress('Sam@Acme-Example.com', CP)).toBe(true);
    expect(sameAddress(null, CP)).toBe(false);
  });
  it('attendeeAddressByName resolves exactly one alias-aware hit or nothing', () => {
    const att = [{ email: 'sam.vendor@acme-example.com', name: 'Sam Vendor' }, { email: 'me@example.com', name: 'Me' }];
    expect(attendeeAddressByName(att, 'Sam')).toBe('sam.vendor@acme-example.com');
    expect(attendeeAddressByName(att, 'Nobody Here')).toBeNull();
    expect(attendeeAddressByName([{ email: 'a@x.com', name: 'Sam A' }, { email: 'b@x.com', name: 'Sam B' }], 'Sam')).toBeNull(); // ambiguous → refuse
  });
  it('registryAddress: the stored address wins; else the person entity\'s first address alias; else null', () => {
    const list = [{ id: 'p1', name: 'Sam Vendor', aliases: ['sam vendor', 'sam@acme-example.com'], state: null, nextTouch: null, lastEventAt: null, quietDays: null }];
    expect(registryAddress(list, 'Sam Vendor <SAM@acme-example.com>')).toBe('sam@acme-example.com');
    expect(registryAddress(list, 'Sam Vendor')).toBe('sam@acme-example.com');
    expect(registryAddress(list, 'Unknown Person')).toBeNull();
    expect(registryAddress(list, null)).toBeNull();
  });
});
