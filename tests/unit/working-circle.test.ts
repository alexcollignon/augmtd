// W11.2 THE WORKING CIRCLE · ONE ROW PER CONVERSATION · LOOKS DONE — the pure pieces.
// Zero IO, zero AI. Fake identities only (Acme / Sam / Jo).
import { describe, it, expect } from 'vitest';
import { inferCircle, countingCircle, circleRows, sameOrganisation, type CircleMail } from '@/lib/evidence/circle';
import { actorRole, buildActorContext, teammateAddressesOf } from '@/lib/evidence/actor';
import { looksDoneEvidenceOf, looksDoneLive, looksDoneLine } from '@/lib/evidence/looks-done';
import { foldByConversation, conversationKeyOf, conversationSentence, foldedIntoOf } from '@/lib/home/conversation-fold';
import { rankAttention, attentionRank, type AttentionRow } from '@/lib/home/attention';
import { foldHeldRows } from '@/lib/home/held-list';
import type { Evidence } from '@/lib/evidence/match';

const ME = 'me@augmtd-example.com';
const PARTNER = 'sam@partner-example.com';
const CLIENT = 'kim@acme-example.com';
const known = { own: [ME], teammates: ['jo@augmtd-example.com'], teamDomains: ['augmtd-example.com'] };
const side = (t: string, x = PARTNER, y = CLIENT): CircleMail[] => [
  { from: ME, to: [y], cc: [x], threadId: t, fromUser: true },
  { from: x, to: [y], cc: [ME], threadId: t, fromUser: false },
];

describe('inferCircle', () => {
  it('infers a same-side co-sender and never the counterparty', () => {
    const c = inferCircle(['a', 'b', 'c', 'd'].flatMap((t) => side(t)), known);
    expect(c.map((x) => x.address)).toEqual([PARTNER]);
    expect(c[0].auto).toBe(true);
  });
  it('needs two threads to suggest, and a public domain never counts on its own', () => {
    expect(inferCircle(side('a'), known)).toEqual([]);
    const pub = inferCircle(['a', 'b', 'c', 'd', 'e'].flatMap((t) => side(t, 'pat.example@gmail.com')), known);
    expect(pub[0].publicDomain).toBe(true);
    expect(pub[0].auto).toBe(false);
  });
  it('never pairs two addresses of the same organisation', () => {
    expect(sameOrganisation('a@acme-example.com', 'b@acme-example.com')).toBe(true);
    expect(inferCircle(['a', 'b', 'c'].flatMap((t) => side(t, 'lee@acme-example.com')), known)).toEqual([]);
  });
  it('lets the user decide: removed wins, confirmed counts, suggested waits', () => {
    const c = inferCircle([...['a', 'b'].flatMap((t) => side(t))], known);
    expect(countingCircle(c, [])).toEqual([]);
    expect(countingCircle(c, [{ address: PARTNER, state: 'confirmed', at: '' }])).toEqual([PARTNER]);
    expect(circleRows(c, [{ address: PARTNER, state: 'removed', at: '' }])[0].state).toBe('removed');
  });
});

describe('the ladder reads the circle', () => {
  it('a circle address is a teammate; the counterparty rung still outranks it', () => {
    const ctx = buildActorContext({ profileEmail: ME, circle: [PARTNER] });
    expect(actorRole({ address: PARTNER }, ctx)).toBe('teammate');
    expect(actorRole({ address: PARTNER }, ctx, { addresses: [PARTNER], personIds: [] })).toBe('counterparty');
    expect(teammateAddressesOf(ctx)).toContain(PARTNER);
    expect(actorRole({ address: PARTNER }, buildActorContext({ profileEmail: ME }))).toBe('unknown');
  });
});

describe('looks done', () => {
  const e: Evidence = { type: 'email', id: 'e1', at: '2026-09-21T10:00:00Z', title: 'Re: changes', by: 'teammate', key: 'object', deed: 'message_sent', actor: { role: 'teammate', name: 'Sam' } };
  it('rises on user-side evidence the judge did not close on, and only then', () => {
    expect(looksDoneEvidenceOf([e], 'unclear', 'user')?.by).toBe('teammate');
    expect(looksDoneEvidenceOf([e], 'delivered', 'user')).toBeNull();
    expect(looksDoneEvidenceOf([{ ...e, key: 'entity' }], 'unclear', 'user')).toBeNull();
    expect(looksDoneEvidenceOf([e], 'unclear', 'counterparty')).toBeNull();
  });
  it('a refusal is sticky for its evidence', () => {
    expect(looksDoneLive({ sig: 'e1', refusedSig: 'e1' })).toBe(false);
    expect(looksDoneLive({ sig: 'e1,e2', refusedSig: 'e1' })).toBe(true);
    expect(looksDoneLine(looksDoneEvidenceOf([e], 'unclear', 'user')!)).toBe('Sam sent “Re: changes” Sep 21');
  });
  it('ranks below real work', () => {
    expect(attentionRank({ key: 'a', entityId: 'a', source: 'commitment', whyNow: '', looksDone: true, dueToday: true })).toBe(6);
  });
});

describe('one row per conversation', () => {
  const r = (id: string, o: Partial<AttentionRow> = {}): AttentionRow => ({ key: id, entityId: id, source: 'commitment', whyNow: '', ...o });
  it('folds a conversation under its most urgent member and drops nothing', () => {
    const k = conversationKeyOf({ threadId: 't1' });
    const out = rankAttention([r('a', { conversationKey: k }), r('b', { conversationKey: k, dueToday: true }), r('c')], 5);
    expect(out.served.map((x) => x.entityId)).toEqual(['b', 'c']);
    expect(out.folded.map((x) => [x.row.entityId, x.into])).toEqual([['a', 'b']]);
    expect(foldedIntoOf(out.conversations).get('a')).toBe('b');
  });
  it('keys by thread, else source message; rows with no key never fold', () => {
    expect(conversationKeyOf({ threadId: 't', sourceEmailId: 'm' })).toBe('t:t');
    expect(conversationKeyOf({ sourceEmailId: 'm' })).toBe('m:m');
    expect(foldByConversation([1, 2], () => null)).toHaveLength(2);
  });
  it('words the row once', () => {
    expect(conversationSentence('Kim', ['a thing', 'b thing'])).toBe('Kim — 2 open on this thread: a thing; b thing');
  });
  it('the held list folds by conversation before who+subject', () => {
    const f = foldHeldRows([{ s: 'x', c: 't:1' }, { s: 'y', c: 't:1' }, { s: 'x', c: null }], (x) => ({ who: 'Kim', subject: x.s, conversation: x.c }));
    expect(f.map((g) => g.members.length)).toEqual([2, 1]);
  });
});
