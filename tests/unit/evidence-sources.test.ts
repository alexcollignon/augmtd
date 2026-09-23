// W8.1 EVIDENCE FROM EVERYWHERE — the registry's pure pieces: the one shape every mapper emits, the
// actor ladder, identity keys, the matcher over a test-only source row, the teammate attribution.
// Zero IO, zero AI. Fake identities only (Acme / Sam / Jo).
import { describe, it, expect } from 'vitest';
import {
  EVIDENCE_SOURCES, mailEventOf, calendarEventOf, transcriptEventOf, deedEventOf, sourceEnabled, attachPersons, personIndex,
  mailOpensReverseDoor, deedWords, MAIL_DOOR_RECENT_MS,
  type PoolEmail,
} from '@/lib/evidence/sources';
import { actorRole, buildActorContext, teamDomainsOf, isPublicMailDomain, actorLabel } from '@/lib/evidence/actor';
import { matchEvents, matchOne, SETTLE_MATCH, EVIDENCE_PER_TYPE } from '@/lib/evidence/match';
import { mergeKeys, registryPerson, meetingAttendeesOf, attendeeAddressByName, personAddresses } from '@/lib/evidence/identity';
import { EVIDENCE_DEEDS, type EvidenceEvent, type ActorContext } from '@/lib/evidence/types';
import { matchEvidence, keysOfWork, type OpenWork } from '@/lib/work/evidence-nominator';
import { attributionOf, evidenceReason } from '@/lib/work/evidence-settle';
import { TOOL_FEATURE } from '@/lib/workspace/tool-capabilities';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';

const NOW = '2026-09-22T12:00:00.000Z';
const CP = 'sam@acme-example.com';
const CTX: ActorContext = buildActorContext({
  profileEmail: 'me@augmtd-example.com',
  connections: [{ metadata: { email: 'me.personal@gmail.com' } }],
  teammates: [{ email: 'jo@augmtd-example.com', name: 'Jo Teammate' }, { email: 'kai@partner-example.com', name: 'Kai' }],
});

const isShape = (e: EvidenceEvent) =>
  typeof e.source === 'string' && typeof e.type === 'string' && typeof e.id === 'string' && typeof e.at === 'string'
  && EVIDENCE_DEEDS.includes(e.deed) && ['user', 'teammate', 'counterparty', 'unknown'].includes(e.actor.role)
  && Array.isArray(e.participants) && typeof e.objects === 'object' && typeof e.title === 'string';

describe('the registry', () => {
  it('every row is well-formed: unique keys, a TOOL_FEATURE key or null, known deeds, distinct sig letters', () => {
    const keys = EVIDENCE_SOURCES.map((r) => r.source);
    expect(new Set(keys).size).toBe(keys.length);
    const letters = EVIDENCE_SOURCES.map((r) => r.type[0]);
    expect(new Set(letters).size).toBe(letters.length);
    for (const r of EVIDENCE_SOURCES) {
      expect(r.feature === null || r.feature in TOOL_FEATURE).toBe(true);
      expect(r.deeds.every((d) => EVIDENCE_DEEDS.includes(d))).toBe(true);
      expect(typeof r.loadPool).toBe('function');
    }
  });
  // ⟲ RE-POINTED (W8.7, owner decision): calendar + transcript evidence is gated on its DATA existing,
  // never on the `meetings` UI-module flag — the user's own synced calendar is evidence whatever modules
  // are shown. A feature gates a row only when it means "this source is not collected" (email off).
  it('rows are gated on DATA, not UI modules (meetings off → calendar + transcripts still on; email off → mail off; our ledger always on)', () => {
    const meetingsOff = { ...DEFAULT_FEATURES, meetings: false };
    expect(EVIDENCE_SOURCES.filter((r) => sourceEnabled(r, meetingsOff)).map((r) => r.source)).toEqual(['mail', 'calendar', 'transcript', 'deeds']);
    const emailOff = { ...DEFAULT_FEATURES, email: false, meetings: false };
    expect(EVIDENCE_SOURCES.filter((r) => sourceEnabled(r, emailOff)).map((r) => r.source)).toEqual(['calendar', 'transcript', 'deeds']);
    expect(EVIDENCE_SOURCES.find((r) => r.source === 'calendar')?.feature).toBeNull();
    expect(EVIDENCE_SOURCES.find((r) => r.source === 'transcript')?.feature).toBeNull();
    expect(EVIDENCE_SOURCES.every((r) => sourceEnabled(r, null))).toBe(true); // unreadable map never switches a row off
  });
});

describe('every mapper emits the one shape', () => {
  it('mail · calendar · transcript · deeds', () => {
    const m: PoolEmail = { id: 'm1', at: '2026-09-10T10:00:00Z', subject: 's', from: 'me@augmtd-example.com', to: [CP], threadId: 't1', attachmentCount: 1, fromUser: true };
    const c = calendarEventOf({ id: 'c1', start_time: '2026-09-11T09:00:00Z', end_time: '2026-09-11T10:00:00Z', title: 'Sync', attendees: [{ email: CP, name: 'Sam Vendor', status: 'accepted' }], organizer: 'me@augmtd-example.com', status: 'confirmed' }, CTX, NOW)!;
    const t = transcriptEventOf({ id: 'r1', start_time: '2026-09-11T09:05:00Z', title: 'Rec' }, [{ email: CP }], 'c1');
    const d = deedEventOf({ id: 'a1', action_type: 'send_email', payload: { to: [CP], subject: 'deck' }, result: 'Sent.', created_at: '2026-09-12T10:00:00Z' })!;
    for (const e of [mailEventOf(m, CTX), c, t, d]) expect(isShape(e)).toBe(true);
    expect(c.deed).toBe('meeting_held');
    expect(c.actor.role).toBe('user');
    expect(d.source).toBe('deeds');
  });
  it('a cancelled event, a declined attendee, a failed or unrecorded commit never become evidence', () => {
    expect(calendarEventOf({ id: 'c', start_time: 'x', status: 'cancelled' }, CTX, NOW)).toBeNull();
    const c = calendarEventOf({ id: 'c', start_time: '2026-09-11T09:00:00Z', end_time: '2026-09-11T10:00:00Z', attendees: [{ email: CP, status: 'declined' }], status: 'confirmed' }, CTX, NOW)!;
    expect(c.participants).toEqual([]);
    expect(deedEventOf({ id: 'a', action_type: 'send_email', payload: {}, result: 'Failed to send', created_at: 'x' })).toBeNull();
    expect(deedEventOf({ id: 'a', action_type: 'send_email', payload: {}, result: null, created_at: 'x' })).toBeNull();
    expect(deedEventOf({ id: 'a', action_type: 'change_memory', payload: {}, result: 'ok', created_at: 'x' })).toBeNull();
  });
  it('a non-authored mail is never the user\'s, whatever its from (the authorship law)', () => {
    const relayed = mailEventOf({ id: 'm', at: 'x', subject: '', from: 'me@augmtd-example.com', to: [], threadId: null, attachmentCount: null, fromUser: false }, CTX);
    expect(relayed.actor.role).not.toBe('user');
  });
});

describe('THE ACTOR LADDER', () => {
  it('user · teammate (members) · teammate (same corporate domain) · counterparty · unknown', () => {
    expect(actorRole({ address: 'ME@augmtd-example.com' }, CTX)).toBe('user');
    expect(actorRole({ address: 'me.personal@gmail.com' }, CTX)).toBe('user');
    expect(actorRole({ address: 'kai@partner-example.com' }, CTX)).toBe('teammate');       // an active member, other domain
    expect(actorRole({ address: 'new.hire@augmtd-example.com' }, CTX)).toBe('teammate');   // same corporate domain
    expect(actorRole({ address: CP }, CTX)).toBe('unknown');
    expect(actorRole({ address: CP }, CTX, { addresses: [CP], personIds: [] })).toBe('counterparty');
  });
  it('a public mail provider is never a team domain (the user on gmail does not make gmail a colleague)', () => {
    expect(isPublicMailDomain('gmail.com')).toBe(true);
    expect(teamDomainsOf(['me.personal@gmail.com', 'me@augmtd-example.com'])).toEqual(['augmtd-example.com']);
    expect(actorRole({ address: 'stranger@gmail.com' }, CTX)).toBe('unknown');
  });
  it('precedence: user > counterparty > teammate (work owed BY a colleague is settled by that colleague)', () => {
    expect(actorRole({ address: 'jo@augmtd-example.com' }, CTX, { addresses: ['jo@augmtd-example.com'], personIds: [] })).toBe('counterparty');
    expect(actorRole({ address: 'me@augmtd-example.com' }, CTX, { addresses: ['me@augmtd-example.com'], personIds: [] })).toBe('user');
    expect(actorRole({ personId: 'p-self' }, { ...CTX, selfPersonId: 'p-self' })).toBe('user');
  });
  it('attribution names the teammate, never the user', () => {
    expect(actorLabel({ role: 'teammate', address: 'jo@augmtd-example.com' }, CTX)).toBe('Jo Teammate');
    expect(attributionOf({ role: 'teammate', name: 'Jo Teammate', at: '2026-09-03T10:00:00Z', deed: 'message_sent' })).toBe('Jo Teammate sent it Sep 3');
    expect(attributionOf({ role: undefined })).toBeNull();
    expect(evidenceReason('email', 'teammate')).toBe('evidence:teammate');
    expect(evidenceReason('calendar')).toBe('evidence:calendar');
  });
});

describe('THE MATCHER over the one shape', () => {
  const work: OpenWork = { kind: 'commitment', id: 'k1', afterISO: '2026-09-01T00:00:00Z', counterpartyEmail: CP, threadId: 'tC', fulfiller: 'user', description: 'send Sam the deck' };
  it('a TEST-ONLY source row nominates with no matcher edit (the one shape is the whole contract)', () => {
    const chat: EvidenceEvent = { source: 'fixture_chat', type: 'message', id: 'x1', at: '2026-09-05T10:00:00Z', deed: 'message_sent', actor: { role: 'user' }, participants: [{ address: CP }], objects: {}, title: 'deck link' };
    const ev = matchEvidence({ events: [chat] }, work, NOW, SETTLE_MATCH);
    expect(ev.map((e) => [e.type, e.id, e.by, e.key])).toEqual([['message', 'x1', 'user', 'person']]);
    expect(matchEvidence({ events: [chat] }, work, NOW)).toEqual([]); // the legacy view never sees a type it cannot render
  });
  it('a TEAMMATE\'s delivery on the client thread nominates you_owe work with role teammate (settle path only)', () => {
    const mate = mailEventOf({ id: 'm-mate', at: '2026-09-03T10:00:00Z', subject: 'Re: changes', from: 'jo@augmtd-example.com', fromName: 'Jo Teammate', to: [CP], threadId: 'tC', attachmentCount: 0, fromUser: false }, CTX);
    const ev = matchEvidence({ events: [mate] }, work, NOW, SETTLE_MATCH);
    expect(ev.map((e) => [e.id, e.by, e.actor?.role, e.actor?.name])).toEqual([['m-mate', 'teammate', 'teammate', 'Jo Teammate']]);
    expect(matchEvidence({ events: [mate] }, work, NOW)).toEqual([]);                                      // views keep the old rungs
    expect(matchEvidence({ events: [mate] }, { ...work, fulfiller: 'counterparty' }, NOW, SETTLE_MATCH)).toEqual([]); // not the counterparty's deed
  });
  it('person identity: a deed to the person\'s OTHER address (by person id) nominates', () => {
    const reg = [{ id: 'p-sam', name: 'Sam Vendor', aliases: ['sam vendor', CP, 'sam@acme-other.com'], state: null, nextTouch: null, lastEventAt: null, quietDays: null }];
    const e = attachPersons([mailEventOf({ id: 'm2', at: '2026-09-06T10:00:00Z', subject: 's', from: 'me@augmtd-example.com', to: ['sam@acme-other.com'], threadId: 'tZ', attachmentCount: 0, fromUser: true }, CTX)], personIndex(reg));
    expect(e[0].participants[0].personId).toBe('p-sam');
    const ev = matchEvidence({ events: e }, { ...work, counterpartyEmail: null, threadId: null, keys: { personIds: ['p-sam'] } }, NOW, SETTLE_MATCH);
    expect(ev.map((x) => x.id)).toEqual(['m2']);
    expect(personAddresses(registryPerson(reg, 'Sam Vendor'))).toEqual([CP, 'sam@acme-other.com']);
    expect(registryPerson(reg, 'Sàm Véndor')?.id).toBe('p-sam'); // accent fold, exact
    expect(registryPerson(reg, 'Sam')).toBeNull();                // never a partial-name guess against the registry
  });
  it('a calendar meeting HELD with the counterparty nominates a "call Sam" commitment', () => {
    const held = calendarEventOf({ id: 'c-call', start_time: '2026-09-14T15:45:00Z', end_time: '2026-09-14T16:30:00Z', title: 'Sam x Me // walkthrough', attendees: [{ email: CP, name: 'Sam Vendor', status: 'accepted' }, { email: 'me@augmtd-example.com' }], organizer: 'me@augmtd-example.com', status: 'confirmed' }, CTX, NOW)!;
    const ev = matchEvidence({ events: [held] }, { ...work, afterISO: '2026-09-10T19:26:10Z', description: 'Call Sam to walk through the platform' }, NOW, SETTLE_MATCH);
    expect(ev.map((e) => [e.type, e.id, e.status])).toEqual([['calendar', 'c-call', 'held']]);
  });
  it('the meeting\'s own attendee list resolves a bare-name counterparty (own → linked → the one containing event)', () => {
    const att = [{ email: 'kl.example@client-example.com', name: 'Kim-Lee Example' }, { email: 'me@augmtd-example.com', name: 'Me' }];
    expect(meetingAttendeesOf({ attendees: [] }, new Map(), [{ attendees: att }])).toEqual(att);
    expect(meetingAttendeesOf({ attendees: [], calendar_event_id: 'e1' }, new Map([['e1', att]]), [])).toEqual(att);
    expect(meetingAttendeesOf({ attendees: [] }, new Map(), [{ attendees: att }, { attendees: [] }])).toEqual([]); // two containing events → refuse
    expect(attendeeAddressByName(att, 'Kim-Lee')).toBe('kl.example@client-example.com');
  });
  it('object keys: the work\'s own thread, event and house ref; entity-only hits take at most one slot per type', () => {
    const k = keysOfWork({ kind: 'inbox', id: 'i1', counterpartyEmail: null, threadId: 't9', keys: { entityIds: ['ent1'] } });
    expect(k.externalRefs).toEqual(['inbox:i1']);
    const reply = deedEventOf({ id: 'a2', action_type: 'send_reply', payload: { itemId: 'i1', to: 'x@y.com' }, result: 'Sent.', created_at: '2026-09-05T00:00:00Z' })!;
    expect(matchOne(reply, { afterISO: '2026-09-01T00:00:00Z', fulfiller: 'user', keys: k }, NOW, SETTLE_MATCH)?.key).toBe('object');
    const ents: EvidenceEvent[] = [1, 2, 3].map((i) => ({ source: 'mail', type: 'email', id: `n${i}`, at: `2026-09-0${i + 1}T00:00:00Z`, deed: 'message_sent', actor: { role: 'user' }, participants: [{ address: 'other@x.com' }], objects: { entityId: 'ent1' }, title: '' }));
    const ev = matchEvents(ents, { afterISO: '2026-09-01T00:00:00Z', fulfiller: 'user', keys: k }, NOW, SETTLE_MATCH);
    expect(ev.length).toBe(1);
    expect(ev[0].key).toBe('entity');
    expect(EVIDENCE_PER_TYPE).toBe(3);
  });
  it('merged keys dedupe and normalize', () => {
    expect(mergeKeys({ addresses: ['SAM@acme-example.com', CP, 'not-an-address'] }).addresses).toEqual([CP]);
  });
});

describe('W8.7 — the remaining hooks', () => {
  const nowMs = Date.parse(NOW);
  const recent = new Date(nowMs - 86_400_000).toISOString();
  const row = (over: Record<string, unknown>) => ({ id: 'e1', received_at: recent, subject: 's', from_address: CP, to_addresses: [CP], cc_addresses: [], thread_id: 't', metadata: {}, is_from_user: false, ...over });
  it('the sync mail door opens for user-authored mail and TEAMMATE mail only, recent only (the ladder decides)', () => {
    expect(mailOpensReverseDoor(row({ is_from_user: true, from_address: 'me@augmtd-example.com' }), null, nowMs)).toBe('user');
    expect(mailOpensReverseDoor(row({ from_address: 'jo@augmtd-example.com' }), CTX, nowMs)).toBe('teammate');
    expect(mailOpensReverseDoor(row({ from_address: 'new.hire@augmtd-example.com' }), CTX, nowMs)).toBe('teammate'); // corporate domain
    expect(mailOpensReverseDoor(row({ from_address: CP }), CTX, nowMs)).toBeNull();                                   // a counterparty's inbound
    expect(mailOpensReverseDoor(row({ from_address: 'jo@augmtd-example.com' }), null, nowMs)).toBeNull();             // no ladder facts → no door
    expect(mailOpensReverseDoor(row({ from_address: 'me@augmtd-example.com' }), CTX, nowMs)).toBeNull();              // non-authored own address (authorship law)
    const old = new Date(nowMs - MAIL_DOOR_RECENT_MS - 60_000).toISOString();
    expect(mailOpensReverseDoor(row({ from_address: 'jo@augmtd-example.com', received_at: old }), CTX, nowMs)).toBeNull();
  });
  it('the judge and the room render a teammate as theirs and a commit-door deed as a deed (deed words from the vocabulary)', async () => {
    const { laterEvidenceBlock } = await import('@/lib/work/judge');
    const { evidenceLinesOf } = await import('@/lib/room/grounding');
    const mate = mailEventOf({ id: 'm-mate', at: '2026-09-03T10:00:00Z', subject: 'Re: changes', from: 'jo@augmtd-example.com', fromName: 'Jo Teammate', to: [CP], threadId: 'tC', attachmentCount: 0, fromUser: false }, CTX);
    const deed = deedEventOf({ id: 'a1', action_type: 'send_email', payload: { to: [CP], subject: 'the deck' }, result: 'Sent.', created_at: '2026-09-04T10:00:00Z' })!;
    const work: OpenWork = { kind: 'commitment', id: 'k1', afterISO: '2026-09-01T00:00:00Z', counterpartyEmail: CP, threadId: 'tC', fulfiller: 'user', description: 'send Sam the deck' };
    const ev = matchEvidence({ events: [mate, deed] }, work, NOW, SETTLE_MATCH);
    const block = laterEvidenceBlock(ev, 'UTC');
    expect(block).toContain('a teammate (Jo Teammate) sent "Re: changes"');
    expect(block).toContain('DONE BY THE USER THROUGH AUGMTD');
    expect(block).toContain('- sent "the deck"');
    expect(block).not.toContain('SENT BY THE USER');                       // a teammate's mail is never the user's
    const lines = evidenceLinesOf(ev, 'UTC');
    expect(lines.some((l) => l.startsWith('a teammate (Jo Teammate) SENT "Re: changes"'))).toBe(true);
    expect(lines.some((l) => l.startsWith('the user SENT "the deck" through AUGMTD'))).toBe(true);
    expect(deedWords({ deed: 'meeting_booked', status: 'booked' })).toBe('booked a meeting');
    expect(deedWords({ deed: 'status_changed' })).toBe('changed the event');
  });
});
