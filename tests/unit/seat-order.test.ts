// W14.3 · THE TOP FIVE ARE WHAT MATTERS NOW — the seat clock, the seat tests and THE ORDER
// (lib/home/attention.ts). Zero AI, zero IO.
import { describe, it, expect } from 'vitest';
import { seatClockOf, seatVerdict, attentionRank, rankAttention, kindFlooredForSeat, type AttentionRow } from '@/lib/home/attention';

const NOW = new Date('2026-09-24T09:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const row = (key: string, activityAt: string, o: Partial<AttentionRow> = {}): AttentionRow => ({
  key, entityId: key, source: 'reply', whyNow: 'x', prepared: 'Clara', activityAt,
  ...seatClockOf({ activityAt, dueDate: o.dueDate ?? null }, NOW), ...o,
});

describe('the seat clock', () => {
  it('reads arrival, never judgment time: a 52-day-old item is not fresh', () => {
    expect(seatClockOf({ activityAt: ago(52) }, NOW).fresh).toBe(false);
    expect(seatClockOf({ activityAt: ago(1) }, NOW).fresh).toBe(true);
  });
  it('computes nothing without an activity (three-valued)', () => {
    expect(seatClockOf({ activityAt: null }, NOW)).toEqual({});
  });
  it('a deadline within 7 days keeps a quiet row alive and unstale', () => {
    expect(seatClockOf({ activityAt: ago(30), dueDate: '2026-09-27' }, NOW)).toMatchObject({ lifeSign: true, stale: false });
    expect(seatClockOf({ activityAt: ago(30) }, NOW)).toMatchObject({ lifeSign: false, stale: true });
  });
});

describe('the seat tests', () => {
  it('a stale row is held, never seated', () => {
    const r = rankAttention([row('s', ago(25))]);
    expect(r.served).toHaveLength(0);
    expect(r.refused[0].refusal).toBe('stale');
  });
  it('a floored notice or pitch is held', () => {
    expect(seatVerdict(row('n', ago(0), { kindFloored: true })).refusal).toBe('kind_floor');
    const it = (u: object) => ({ source_data: { understanding: { role: 'addressed', relevance: 'action', ...u } } });
    expect(kindFlooredForSeat(it({ mailKind: 'notification', ownership: 'none' }))).toBe(true);
    expect(kindFlooredForSeat(it({ mailKind: 'cold_outreach', ownership: 'you_owe' }))).toBe(true);
    expect(kindFlooredForSeat(it({ mailKind: 'notification', ownership: 'you_owe' }))).toBe(false);
  });
});

describe('THE ORDER', () => {
  it('a fresh arrival outranks an old overdue without life', () => {
    const old = row('old', ago(18), { dueDate: '2026-09-10', overdue: true });
    const fresh = row('fresh', ago(0.2));
    expect(attentionRank(old)).toBe(3);
    expect(rankAttention([old, fresh], 1).served.map((r) => r.key)).toEqual(['fresh']);
  });
  it('within a band: soonest due, then most recent activity, then caller order', () => {
    const a = row('a', ago(3), { dueDate: '2026-09-23', overdue: true });
    const b = row('b', ago(5), { dueDate: '2026-09-21', overdue: true });
    const c = row('c', ago(4)); const d = row('d', ago(2));
    expect(rankAttention([a, b, c, d]).served.map((r) => r.key)).toEqual(['b', 'a', 'd', 'c']);
  });
});
