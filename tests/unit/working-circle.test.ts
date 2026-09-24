// W11.2 THE WORKING CIRCLE · LOOKS DONE — the pure pieces. (+ W13.4 ONE ITEM, ONE ROW: the W11.2
// conversation fold is retired — every live item is its own row.)
// Zero IO, zero AI. Fake identities only (Acme / Sam / Jo).
import { describe, it, expect } from 'vitest';
import { inferCircle, countingCircle, circleRows, sameOrganisation, autoVerdict, orgOf, type CircleMail } from '@/lib/evidence/circle';
import { actorRole, buildActorContext, teammateAddressesOf } from '@/lib/evidence/actor';
import { looksDoneEvidenceOf, looksDoneLive, looksDoneLine } from '@/lib/evidence/looks-done';
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

describe('W12.2 · the counterparty is an organisation', () => {
  const CLIENT_MATE = 'lee@acme-example.com';
  const base = ['a', 'b', 'c', 'd'].flatMap((t) => side(t));
  it('never suggests the client\'s colleague the user copies when writing to someone else', () => {
    const c = inferCircle([...base, ...['x1', 'x2'].map((t) => ({ from: ME, to: [PARTNER], cc: [CLIENT_MATE], threadId: t, fromUser: true }))], known);
    expect(c.map((x) => x.address)).toEqual([PARTNER]);
  });
  it('never suggests the client\'s colleague writing to the partner with the user copied, nor counts it against the partner', () => {
    const c = inferCircle([...base, ...['y1', 'y2', 'y3'].map((t) => ({ from: CLIENT_MATE, to: [PARTNER], cc: [ME], threadId: t, fromUser: false }))], known);
    expect(c.map((x) => x.address)).toEqual([PARTNER]);
    expect(c[0].counterThreads).toBe(0);
    expect(c[0].auto).toBe(true);
  });
  it('a public address is its own organisation; the high bar is a verdict of the counts', () => {
    expect(orgOf('pat.example@gmail.com')).toBe('pat.example@gmail.com');
    expect(orgOf(CLIENT)).toBe('acme-example.com');
    expect(autoVerdict({ threads: 20, counterThreads: 2, alongside: 125, publicDomain: false })).toBe(true);
    expect(autoVerdict({ threads: 20, counterThreads: 6, alongside: 125, publicDomain: false })).toBe(false);
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

describe('one item, one row (W13.4 — the conversation fold is retired)', () => {
  const r = (id: string, o: Partial<AttentionRow> = {}): AttentionRow => ({ key: id, entityId: id, source: 'commitment', whyNow: '', ...o });
  it('seats every live item as its own row, most urgent first, and holds back only over the budget', () => {
    const out = rankAttention([r('a'), r('b', { dueToday: true }), r('c')], 5);
    expect(out.served.map((x) => x.entityId)).toEqual(['b', 'a', 'c']);
    expect(out.held).toEqual([]);
    expect(Object.keys(out).sort()).toEqual(['held', 'refused', 'served']);
  });
  it('served + held accounts for every row', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => r(id));
    const out = rankAttention(rows, 5);
    expect(out.served.length + out.held.length).toBe(rows.length);
    expect(new Set([...out.served, ...out.held].map((x) => x.entityId)).size).toBe(rows.length);
  });
  it('the held list folds only same who+subject echoes — distinct asks stay distinct rows', () => {
    const f = foldHeldRows([{ s: 'x' }, { s: 'y' }, { s: 'x' }], (x) => ({ who: 'Kim', subject: x.s }));
    expect(f.map((g) => g.members.length)).toEqual([2, 1]);
  });
});
