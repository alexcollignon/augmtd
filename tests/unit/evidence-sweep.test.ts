// W7.1 HEARTBEAT THROUGHPUT — the evidence sweep's pure cores: the priority order, the fresh-only
// caps, the scope of the people in play, the lane merge, the cache-sig read. Zero IO, zero AI.
// Fixtures use fake identities only (Acme / Sam).
import { describe, it, expect } from 'vitest';
import {
  evidenceTier, expectsFresh, countsTowardCap, orderEvidenceQueue,
} from '@/lib/work/evidence-sweep';
import { scopeOf, chunked, mergePoolEmails, evidenceNewToPrior, evidenceSig, type PoolEmail, type Evidence } from '@/lib/work/evidence-nominator';
import { fulfillmentSigOf, isCurrentLawSig, FULFILLMENT_LAW_VERSION } from '@/lib/commitments/fulfillment';

const V = FULFILLMENT_LAW_VERSION;

describe('evidenceTier — which rows would spend a fresh judgment', () => {
  const cur = fulfillmentSigOf([{ type: 'calendar', id: 'c1' }, { type: 'email', id: 'e1' }]);
  it('no stored verdict → never judged under the current law (tier 0)', () => {
    expect(evidenceTier(null, cur)).toBe(0);
    expect(evidenceTier('', cur)).toBe(0);
  });
  it('a verdict stored under an OLDER law is tier 0 (the law-version bump invalidates it)', () => {
    expect(evidenceTier(`${V - 1}:ce1,ee1`, cur)).toBe(0);
  });
  it('same law, a different evidence set → tier 1 (a new piece re-judges)', () => {
    expect(evidenceTier(`${V}:ee1`, cur)).toBe(1);
  });
  it('same law, the same set → tier 2 (a cache hit, free)', () => {
    expect(evidenceTier(cur, cur)).toBe(2);
    expect(expectsFresh(2)).toBe(false);
    expect(expectsFresh(0)).toBe(true);
    expect(expectsFresh(1)).toBe(true);
  });
});

describe('the cache sig — one definition for the judge and the sweep', () => {
  it('is order-independent and law-versioned', () => {
    const a = fulfillmentSigOf([{ type: 'email', id: 'e1' }, { type: 'calendar', id: 'c1' }]);
    const b = fulfillmentSigOf([{ type: 'calendar', id: 'c1' }, { type: 'email', id: 'e1' }]);
    expect(a).toBe(b);
    expect(a.startsWith(`${V}:`)).toBe(true);
    expect(isCurrentLawSig(a)).toBe(true);
    expect(isCurrentLawSig(`${V - 1}:ee1`)).toBe(false);
    expect(isCurrentLawSig(null)).toBe(false);
  });
  it('equals the nominator\'s evidenceSig under the law prefix (the sweep can predict the judge\'s key)', () => {
    const ev: Evidence[] = [
      { type: 'email', id: 'e1', at: '2026-09-10T00:00:00Z', title: 'x' },
      { type: 'transcript', id: 't1', at: '2026-09-11T00:00:00Z', title: 'y' },
    ];
    expect(fulfillmentSigOf(ev)).toBe(`${V}:${evidenceSig(ev)}`);
  });
});

describe('countsTowardCap — the caps count SPEND only', () => {
  it('a cache hit never consumes a slot; a fresh call (success or outage) does', () => {
    expect(countsTowardCap({ fresh: false })).toBe(false);
    expect(countsTowardCap({ fresh: true })).toBe(true);
  });
});

describe('orderEvidenceQueue — the priority order', () => {
  const e = (id: string, tier: 0 | 1 | 2, dueDate: string | null, createdAt: string) => ({ id, tier, dueDate, createdAt });
  it('tier first: never-judged-under-this-law → moved evidence → cache hits', () => {
    const out = orderEvidenceQueue([e('c', 2, '2026-01-01', '2026-01-01'), e('b', 1, null, '2026-09-01'), e('a', 0, null, '2026-09-20')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('within a tier: oldest due first, undated after every dated row, then oldest row, then id', () => {
    const out = orderEvidenceQueue([
      e('undated-old', 0, null, '2026-08-01'),
      e('due-late', 0, '2026-09-20', '2026-09-01'),
      e('due-early', 0, '2026-09-10', '2026-09-15'),
      e('undated-new', 0, null, '2026-09-15'),
      e('z-tie', 0, '2026-09-20', '2026-09-01'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['due-early', 'due-late', 'z-tie', 'undated-old', 'undated-new']);
  });
  it('never the updated_at-desc order: a stable head of cache hits cannot starve an unjudged tail', () => {
    const head = Array.from({ length: 50 }, (_, i) => e(`hit${String(i).padStart(2, '0')}`, 2 as const, null, '2026-09-22'));
    const tail = e('unjudged', 0, '2026-09-16', '2026-09-01');
    expect(orderEvidenceQueue([...head, tail])[0].id).toBe('unjudged');
  });
  it('is pure (input untouched) and total', () => {
    const input = [e('b', 1, null, 'x'), e('a', 1, null, 'x')];
    const out = orderEvidenceQueue(input);
    expect(input.map((x) => x.id)).toEqual(['b', 'a']);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('the scope — the people and threads in play', () => {
  it('normalizes + dedupes addresses, drops non-addresses, collects threads', () => {
    const s = scopeOf([
      { counterpartyEmail: 'SAM@Acme-Example.com', threadId: 't1' },
      { counterpartyEmail: 'sam@acme-example.com', threadId: 't1' },
      { counterpartyEmail: null, threadId: 't2' },
      { counterpartyEmail: 'not an address', threadId: null },
    ]);
    expect(s.addresses).toEqual(['sam@acme-example.com']);
    expect(s.threadIds).toEqual(['t1', 't2']);
  });
  it('chunked: every element in exactly one chunk, in order', () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 3)).toEqual([]);
    expect(chunked([1], 0)).toEqual([[1]]);
  });
  it('mergePoolEmails: the scoped lane and the newest window merge without duplicates, newest first', () => {
    const m = (id: string, at: string): PoolEmail => ({ id, at, subject: '', from: null, to: [], threadId: null, attachmentCount: null, fromUser: true });
    const out = mergePoolEmails([m('old-scoped', '2026-09-01T00:00:00Z'), m('both', '2026-09-20T00:00:00Z')], [m('both', '2026-09-20T00:00:00Z'), m('newest', '2026-09-22T00:00:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['newest', 'both', 'old-scoped']);
  });
});

describe('evidenceNewToPrior — the judge\'s prior never anchors against evidence it never saw', () => {
  it('a prior with no stamp (cached before the evidence / the stamp) meets new evidence', () => {
    expect(evidenceNewToPrior('ce1', null)).toBe(true);
    expect(evidenceNewToPrior('ce1', undefined)).toBe(true);
  });
  it('a prior made against a different set meets new evidence; the same set does not', () => {
    expect(evidenceNewToPrior('ce1,ee2', 'ce1')).toBe(true);
    expect(evidenceNewToPrior('ce1', 'ce1')).toBe(false);
  });
  it('no evidence → nothing new (the prompt stays byte-identical)', () => {
    expect(evidenceNewToPrior('', null)).toBe(false);
  });
});
