import { describe, it, expect } from 'vitest';
import {
  authorshipOf, authorshipStamp, isAuthoredByUser, ownAddressesOf, gmailFiledInSent, normAddress,
} from '@/lib/email-sync/authorship';
import { smtpFromProxyAddresses, ownedFromGmailSendAs } from '@/lib/email-sync/send-as';
import { planAuthorshipRepair, closeCausedByMisattribution } from '@/lib/email-sync/authorship-repair';
import { parseGmailMessage } from '@/lib/google/gmail';
import { parseOutlookMessage } from '@/lib/microsoft/outlook';

// Generic fakes only: the user is Sam at acme.test (+ a gmail login); the client is Jordan at globex.test;
// the principal Sam assists is Pat at acme.test; Sam's own assistant is Ari at acme.test.
const OWN = ownAddressesOf({
  profileEmail: 'sam.rivera@gmail.com',
  connections: [{ metadata: { email: 'Sam@Acme.test' }, provider_account_id: 'sam@acme.test' }],
});

const gmailRaw = (headers: Record<string, string>, extra: { labelIds?: string[]; calendar?: boolean } = {}) => ({
  id: 'g1', threadId: 't1', internalDate: String(Date.parse('2026-09-01T10:00:00Z')), labelIds: extra.labelIds ?? [], snippet: '',
  payload: {
    headers: Object.entries({ 'Message-ID': '<m1@x>', Subject: 'Hello', ...headers }).map(([name, value]) => ({ name, value })),
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('hi').toString('base64') } },
      ...(extra.calendar ? [{ mimeType: 'text/calendar; method=REQUEST', filename: '', body: { data: Buffer.from('BEGIN:VCALENDAR').toString('base64') } }] : []),
    ],
  },
});
const outlookRaw = (from: string, sender?: string, eventMessage = false) => ({
  id: 'o1', conversationId: 'c1', subject: 'Hello', bodyPreview: '', body: { content: 'hi', contentType: 'text' },
  from: { emailAddress: { name: 'X', address: from } },
  ...(sender ? { sender: { emailAddress: { name: 'Y', address: sender } } } : {}),
  toRecipients: [], ccRecipients: [], receivedDateTime: '2026-09-01T10:00:00Z', internetMessageId: '<o1@x>',
  ...(eventMessage ? { '@odata.type': '#microsoft.graph.eventMessageRequest' } : {}),
});

describe('THE AUTHORSHIP LAW — the owned set', () => {
  it('login + connected mailboxes, normalized; nothing learned from mail', () => {
    expect([...OWN].sort()).toEqual(['sam.rivera@gmail.com', 'sam@acme.test']);
    expect(normAddress(' "Sam" <SAM@ACME.TEST> ')).toBe('sam@acme.test');
  });
  it('provider send-as aliases join only when the provider reports them', () => {
    expect(smtpFromProxyAddresses(['SMTP:sam@acme.test', 'smtp:s.rivera@acme.test', 'X500:/o=x', 'SIP:sam@acme.test'])).toEqual(['sam@acme.test', 's.rivera@acme.test']);
    expect(ownedFromGmailSendAs([
      { sendAsEmail: 'sam.rivera@gmail.com', isPrimary: true },
      { sendAsEmail: 'sales@acme.test', verificationStatus: 'accepted' },
      { sendAsEmail: 'pending@acme.test', verificationStatus: 'pending' },
    ])).toEqual(['sam.rivera@gmail.com', 'sales@acme.test']);
  });
});

describe('THE AUTHORSHIP LAW — the four rules on real provider shapes', () => {
  it('Gmail: the user\'s own send is authored', () => {
    const m = parseGmailMessage(gmailRaw({ From: 'Sam Rivera <sam@acme.test>', To: 'jordan@globex.test' }, { labelIds: ['SENT'] }) as never);
    expect(authorshipOf(m, OWN)).toMatchObject({ authored: true, basis: 'own_from' });
  });
  it('Outlook: a forwarded meeting request filed in Sent keeps the ORGANIZER in from → NOT authored (the W7.5 poison row)', () => {
    const m = parseOutlookMessage(outlookRaw('jordan@globex.test', 'sam@acme.test', true) as never);
    expect(authorshipOf(m, OWN)).toMatchObject({ authored: false, basis: 'relayed_calendar' });
    const s = authorshipStamp(m, OWN, { filedInSent: true });
    expect(s.is_from_user).toBe(false);
    expect(s.metadata).toMatchObject({ filed_in_sent: true, authorship: 'relayed_calendar', odata_type: '#microsoft.graph.eventMessageRequest' });
  });
  it('Outlook: someone else\'s mail filed in Sent with no owned sender → NOT authored', () => {
    const m = parseOutlookMessage(outlookRaw('jordan@globex.test') as never);
    expect(authorshipStamp(m, OWN, { filedInSent: true })).toMatchObject({ is_from_user: false, metadata: { filed_in_sent: true, authorship: 'foreign_from' } });
  });
  it('Outlook: sent ON BEHALF OF a principal (sender = the user) IS authored, and records the principal', () => {
    const m = parseOutlookMessage(outlookRaw('pat@acme.test', 'sam@acme.test') as never);
    expect(m.metadata).toMatchObject({ sender_address: 'sam@acme.test' });
    const s = authorshipStamp(m, OWN, { filedInSent: true });
    expect(s).toMatchObject({ is_from_user: true, metadata: { authorship: 'on_behalf', sent_on_behalf_of: 'pat@acme.test' } });
  });
  it('Outlook: a delegate sending AS the user (from = the user) is the user\'s mail; the delegate is recorded', () => {
    const m = parseOutlookMessage(outlookRaw('sam@acme.test', 'ari@acme.test') as never);
    expect(authorshipStamp(m, OWN)).toMatchObject({ is_from_user: true, metadata: { authorship: 'own_from', sent_by_delegate: 'ari@acme.test' } });
  });
  it('Outlook: sender == from stores no sender fact', () => {
    const m = parseOutlookMessage(outlookRaw('sam@acme.test', 'sam@acme.test') as never);
    expect((m.metadata as Record<string, unknown>).sender_address).toBeUndefined();
  });
  it('Gmail: the Sender header is read — on-behalf-of authored; a relayed invite is not', () => {
    const behalf = parseGmailMessage(gmailRaw({ From: 'Pat <pat@acme.test>', Sender: 'Sam <sam@acme.test>' }) as never);
    expect(authorshipOf(behalf, OWN)).toMatchObject({ authored: true, basis: 'on_behalf', onBehalfOf: 'pat@acme.test' });
    const relayed = parseGmailMessage(gmailRaw({ From: 'Jordan <jordan@globex.test>', Sender: 'sam@acme.test' }, { calendar: true, labelIds: ['SENT'] }) as never);
    expect(authorshipOf(relayed, OWN)).toMatchObject({ authored: false, basis: 'relayed_calendar' });
    expect(gmailFiledInSent(relayed.labels)).toBe(true);
  });
  it('an alias send is authored only when the provider reported the alias', () => {
    const m = parseGmailMessage(gmailRaw({ From: 'Sam <sales@acme.test>' }) as never);
    expect(isAuthoredByUser(m, OWN)).toBe(false);
    const withAlias = ownAddressesOf({ profileEmail: 'sam@acme.test', sendAs: ['sales@acme.test'] });
    expect(isAuthoredByUser(m, withAlias)).toBe(true);
    // a connection's provider-reported send_as (metadata.send_as) is owned too
    expect(isAuthoredByUser(m, ownAddressesOf({ connections: [{ metadata: { email: 'sam@acme.test', send_as: ['sales@acme.test'] } }] }))).toBe(true);
  });
  it('no from → not authored; an empty owned set authors nothing', () => {
    expect(authorshipOf({ from_address: '' }, OWN)).toMatchObject({ authored: false, basis: 'no_from' });
    expect(isAuthoredByUser({ from_address: 'sam@acme.test' }, [])).toBe(false);
  });
});

describe('THE AUTHORSHIP REPAIR — pure plan', () => {
  const rows = [
    { id: 'own', from_address: 'sam@acme.test', from_name: 'Sam', connection_id: 'c1', received_at: '2026-09-01T10:00:00Z' },
    { id: 'fwd', from_address: 'jordan@globex.test', from_name: 'Jordan Blake', connection_id: 'c1', received_at: '2026-09-02T10:00:00Z', thread_id: 't1' },
    { id: 'old', from_address: 'sam@oldco.test', from_name: 'Sam', connection_id: 'gone', received_at: '2026-09-03T10:00:00Z' },
    { id: 'alias', from_address: 'sales@acme.test', from_name: 'Samuel Rivera', connection_id: 'c1', received_at: '2026-09-04T10:00:00Z' },
    { id: 'behalf', from_address: 'pat@acme.test', connection_id: 'c1', received_at: '2026-09-05T10:00:00Z', metadata: { sender_address: 'sam@acme.test' } },
  ];
  const plan = planAuthorshipRepair(rows, { ownAddresses: OWN, ownNames: ['samuel rivera'], liveConnectionIds: ['c1'] });
  it('flags only non-authored rows; holds back disconnected mailboxes + likely aliases', () => {
    expect(plan.map((m) => [m.id, m.hold])).toEqual([['fwd', null], ['old', 'orphan_connection'], ['alias', 'possible_alias']]);
  });
  it('an unknown identity flips nothing', () => {
    expect(planAuthorshipRepair(rows, { ownAddresses: [], ownNames: [], liveConnectionIds: ['c1'] })).toEqual([]);
  });
  it('a "replied" close is attributed only when EVERY closing candidate is misattributed', () => {
    const mis = new Set(['fwd']);
    const flagged = rows.map((r) => ({ id: r.id, thread_id: (r as { thread_id?: string }).thread_id ?? null, received_at: r.received_at }));
    const close = { id: 'i1', thread_id: 't1', created_at: '2026-09-01T12:00:00Z', resolved_at: '2026-09-02T10:01:00Z', resolved_reason: 'replied' };
    expect(closeCausedByMisattribution(close, flagged, mis)).toEqual({ caused: true, by: ['fwd'] });
    const withReal = [...flagged, { id: 'real', thread_id: 't1', received_at: '2026-09-02T09:00:00Z' }];
    expect(closeCausedByMisattribution(close, withReal, mis).caused).toBe(false);
    expect(closeCausedByMisattribution({ ...close, resolved_reason: 'user_marked' }, flagged, mis).caused).toBe(false);
  });
  it('an "evidence:email" close is attributed by the evidence\'s own time', () => {
    const flagged = [{ id: 'fwd', thread_id: 't9', received_at: '2026-09-02T10:00:00Z' }];
    const close = { id: 'c1', thread_id: null, created_at: '2026-08-01T00:00:00Z', resolved_at: '2026-09-02T10:00:00.000Z', resolved_reason: 'evidence:email' };
    expect(closeCausedByMisattribution(close, flagged, new Set(['fwd'])).caused).toBe(true);
    expect(closeCausedByMisattribution({ ...close, resolved_at: '2026-09-03T10:00:00Z' }, flagged, new Set(['fwd'])).caused).toBe(false);
  });
});
