import { describe, it, expect } from 'vitest';
import {
  leanSelect, foldLean, foldLeanRows, isLeanSource, projectedKeysOf, rulesReadBody, hydrateSource, readLeanPool,
  LEAN_SOURCE_KEYS, HEAVY_SOURCE_KEYS, NEVER_STORED_KEYS, CLASSIFY_KEYS, DECK_KEYS, FYI_KEYS, BOARD_KEYS, ANCHOR_KEYS, ONE_READER_KEYS, PREPARED_KEYS, DEED_KEYS,
} from '@/lib/home/lean-source';

// THE HOT-PATH LAW's pure helper (docs/event-spine-plan.md P0). Generic fakes only.

type Row = Record<string, unknown>;
function fakeClient(table: Map<string, Row>, opts: { fail?: boolean } = {}) {
  const calls: Array<{ cols: string; ops: string[] }> = [];
  return {
    calls,
    from: () => ({
      select: (cols: string) => {
        const call = { cols, ops: [] as string[] }; calls.push(call);
        let ids: string[] = [];
        const b: Record<string, unknown> = {
          eq: () => { call.ops.push('eq'); return b; },
          in: (_c: string, v: string[]) => { call.ops.push('in'); ids = v; return b; },
          order: () => { call.ops.push('order'); return b; },
          then: (res: (v: unknown) => unknown) => {
            if (opts.fail) return Promise.resolve(res({ data: null, error: { message: 'boom' } }));
            const want = cols.split(',').map((c) => c.trim().replace('source_data->', ''));
            return Promise.resolve(res({ data: ids.map((id) => table.get(id)).filter(Boolean).map((r) => Object.fromEntries(want.map((k) => [k, (r as Row)[k] ?? null]))), error: null }));
          },
        };
        return b;
      },
    }),
  };
}

describe('lean-source — the projection', () => {
  it('names one JSON path per key of the reader set, body only on request', () => {
    expect(leanSelect('id', { keys: ['subject'] })).toBe('id, source_data->subject');
    expect(leanSelect('id', { keys: ['subject'], withBody: true })).toBe('id, source_data->subject, source_data->body');
  });
  it('refuses a base list carrying source_data or *, and a colliding key', () => {
    expect(() => leanSelect('id, source_data')).toThrow();
    expect(() => leanSelect('*')).toThrow();
    expect(() => leanSelect('id, subject', { keys: ['subject'] })).toThrow();
  });
  it('every reader set is body-free and inside the declared universe', () => {
    const lean = new Set<string>(LEAN_SOURCE_KEYS);
    for (const set of [CLASSIFY_KEYS, DECK_KEYS, FYI_KEYS, BOARD_KEYS, ANCHOR_KEYS, ONE_READER_KEYS, PREPARED_KEYS, DEED_KEYS]) {
      for (const k of set) {
        expect(lean.has(k)).toBe(true);
        expect((HEAVY_SOURCE_KEYS as readonly string[]).includes(k)).toBe(false);
        expect((NEVER_STORED_KEYS as readonly string[]).includes(k)).toBe(false);
      }
    }
  });
});

describe('lean-source — the fold', () => {
  it('rebuilds source_data from the projected keys; null means absent', () => {
    const r = foldLean({ id: 'a', work_title: 'T', subject: 'Hello Sam', draft: null }, { keys: ['subject', 'draft'] });
    expect(r.source_data).toEqual({ subject: 'Hello Sam' });
    expect(r.work_title).toBe('T');
    expect('subject' in r).toBe(false);
    expect(isLeanSource(r.source_data)).toBe(true);
    expect([...(projectedKeysOf(r.source_data) ?? [])].sort()).toEqual(['draft', 'subject']);
  });
  it('passes a whole row through untouched (never narrows a fact it was handed)', () => {
    const whole = { id: 'b', source_data: { subject: 'x', body: 'y' } };
    expect(foldLean(whole)).toBe(whole);
    expect(isLeanSource(whole.source_data)).toBe(false);
  });
});

describe('lean-source — rulesReadBody', () => {
  it('is true only for an enabled deterministic rule with a body_* condition', () => {
    expect(rulesReadBody([{ enabled: true, ai_match: false, conditions: [{ field: 'body_contains' }] }])).toBe(true);
    expect(rulesReadBody([{ enabled: true, ai_match: true, conditions: [{ field: 'body_contains' }] }])).toBe(false);
    expect(rulesReadBody([{ enabled: false, ai_match: false, conditions: [{ field: 'body_excludes' }] }])).toBe(false);
    expect(rulesReadBody([{ enabled: true, ai_match: false, conditions: [{ field: 'subject_contains' }] }])).toBe(false);
    expect(rulesReadBody(undefined)).toBe(false);
  });
});

describe('lean-source — the served-row hydrate', () => {
  const table = new Map<string, Row>(Array.from({ length: 30 }, (_, i) => [`i${i}`, { id: `i${i}`, subject: `s${i}`, body: `b${i}` }]));
  it('reads only the missing key, for at most max rows, and reports what it left behind', async () => {
    const rows = foldLeanRows([...table.values()].map((r) => ({ id: r.id, subject: r.subject })), { keys: ['subject'] });
    const c = fakeClient(table);
    const warn = console.warn; console.warn = () => {};
    const h = await hydrateSource(c, 'u', rows, ['body'], 10);
    console.warn = warn;
    expect(h).toEqual({ read: 10, leftBehind: 20 });
    expect(c.calls[0].cols).toBe('id, source_data->body');
    expect(rows.slice(0, 10).every((r) => r.source_data.body === `b${String(r.id).slice(1)}`)).toBe(true);
    expect(rows.slice(10).some((r) => 'body' in r.source_data)).toBe(false);
    const again = await hydrateSource(c, 'u', rows.slice(0, 10), ['body'], 10);
    expect(again.read).toBe(0);
  });
  it('leaves whole (non-lean) rows alone', async () => {
    const c = fakeClient(table);
    const h = await hydrateSource(c, 'u', [{ id: 'i1', source_data: { subject: 'x' } }], ['body']);
    expect(h.read).toBe(0);
    expect(c.calls.length).toBe(0);
  });
});

describe('lean-source — the paged pool', () => {
  const table = new Map<string, Row>(Array.from({ length: 2500 }, (_, i) => [`r${String(i).padStart(4, '0')}`, { id: `r${String(i).padStart(4, '0')}`, subject: `s${i}` }]));
  const order = [...table.keys()].reverse();
  const pageIds = (from: number, to: number) => Promise.resolve({ data: order.slice(from, to + 1).map((id) => ({ id })), error: null });
  it('pages the ids, projects each row once by id (no sort), and keeps the id order', async () => {
    const c = fakeClient(table);
    const rows = await readLeanPool(c, 'u', pageIds, 'id', { keys: ['subject'], maxRows: 6000, chunk: 500 });
    expect(rows.length).toBe(2500);
    expect(rows.map((r) => r.id)).toEqual(order);
    expect(c.calls.length).toBe(5);
    expect(c.calls.every((x) => x.ops.includes('in') && !x.ops.includes('order'))).toBe(true);
  });
  it('honours its bound', async () => {
    const rows = await readLeanPool(fakeClient(table), 'u', pageIds, 'id', { keys: ['subject'], maxRows: 1500 });
    expect(rows.length).toBe(1500);
  });
  it('throws when a chunk fails (never a silently short pool)', async () => {
    await expect(readLeanPool(fakeClient(table, { fail: true }), 'u', pageIds, 'id', { keys: ['subject'], maxRows: 6000 })).rejects.toThrow();
  });
});
