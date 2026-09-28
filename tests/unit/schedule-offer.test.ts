// W20.B · THE SCHEDULE OFFER + A CLAIM WITHOUT A CARD + THE OFFER LEADS THE PAGE (owner walk, Sep 28).
// The counterparty stated "Oct 12, 9.30 AM CET" for the call; the item was judged "chase"; nothing was
// offered. Asserted over an in-memory Supabase (zero AI): the offer is written at the stated region's
// true instant, never twice, never over a booking, never over another invite, and withdrawn when the
// thread moves; the answer door never serves "Here's the invite" over nothing; the page leads with it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const stub = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

function fakeDb() {
  const table = (n: string) => (stub.tables[n] ??= []);
  const q = (name: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const run = () => {
      const hit = table(name).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of hit) Object.assign(r, patch);
      return { data: hit, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api, update: (p: Row) => { patch = p; return api; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
      gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return api; },
      lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return api; },
      limit: () => api, order: () => api, is: () => api,
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    };
    return api;
  };
  return { from: (n: string) => q(n) };
}

vi.mock('@/lib/prepare/addressee', () => ({
  loadUserForms: vi.fn(async () => ({})),
  isUserForm: (a: string) => /me@user\.test/.test(a),
}));
vi.mock('@/lib/utils/user-time', () => ({ userTimezone: vi.fn(async () => 'Europe/Lisbon') }));
vi.mock('@/lib/prepare/ground', () => ({ groundOf: vi.fn(async () => ({ emailId: 'm1', receivedAt: '2026-09-27T10:00:00Z' })) }));

import { prepareScheduleOffer, scheduleOfferDecision, SCHEDULE_OFFER_MARK } from '@/lib/prepare/schedule-offer';
import { claimFloorSay, CLAIM_WITHOUT_CARD_LINE } from '@/lib/present/turn-card';
import { composeItemPage } from '@/components/thread/item-page';

const NOW = '2026-09-28T12:00:00.000Z';
const BODY = 'Hi — great, confirming the implementation call, Oct 12, 9.30 AM CET. Please also send the signed offer back.\n\nOn Sep 25, Me wrote:\n> old words about Monday 10am';
const item = (extra: Row = {}) => ({
  id: 'item-1', user_id: 'user-1', status: 'pending', work_title: 'Confirm implementation call',
  source_data: { from: 'Sam <sam@acme.test>', body: BODY, received_at: '2026-09-27T10:00:00Z', subject: 'Re: implementation', ...extra },
});
const invite = () => (stub.tables.inbox_items[0].source_data as Row).prepared_invite as Row | undefined;

beforeEach(() => { stub.tables = { inbox_items: [item()], calendar_events: [] }; });

describe('the schedule offer (lib/prepare/schedule-offer)', () => {
  it('a future stated meeting time with nothing booked → an invite at the stated region\'s instant', async () => {
    const r = await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW);
    expect(r.did).toBe('invite');
    const inv = invite()!;
    expect(inv.startISO).toBe('2026-10-12T07:30:00.000Z');
    expect(inv.attendees).toEqual(['sam@acme.test']);
    expect(inv.offer).toBe(SCHEDULE_OFFER_MARK);
    expect(inv.proposed).toBe(false);
  });
  it('idempotent: a second pass writes nothing new', async () => {
    await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW);
    const first = JSON.stringify(invite());
    const r = await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW);
    expect(r.did).toBe('none');
    expect(JSON.stringify(invite())).toBe(first);
  });
  it('booked with them around that time → nothing offered', async () => {
    stub.tables.calendar_events = [{ id: 'ev', user_id: 'user-1', start_time: '2026-10-12T07:30:00.000Z', status: 'confirmed', attendees: [{ email: 'sam@acme.test' }] }];
    expect((await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW)).did).toBe('none');
    expect(invite()).toBeUndefined();
  });
  it('another invite (the schedule verdict\'s own) is never touched', async () => {
    stub.tables.inbox_items = [item({ prepared_invite: { title: 'x', startISO: '2026-10-20T10:00:00.000Z' } })];
    expect((await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW)).did).toBe('none');
    expect(invite()!.startISO).toBe('2026-10-20T10:00:00.000Z');
  });
  it('no stated time (only quoted history states one) → nothing', async () => {
    stub.tables.inbox_items = [item({ body: 'Thanks, will do — I will send the signed copy over shortly.\n\nOn Sep 25, Sam wrote:\n> call Oct 12, 9.30 AM CET' })];
    expect((await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW)).did).toBe('none');
  });
  it('the thread moves on (no time stated any more) → the unsent offer is withdrawn', async () => {
    await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW);
    (stub.tables.inbox_items[0].source_data as Row).body = 'Signed offer attached.';
    const r = await prepareScheduleOffer(fakeDb() as never, 'user-1', 'item-1', NOW);
    expect(r.did).toBe('withdrawn');
    expect(invite()).toBeUndefined();
  });
  it('a past stated time is not offered', () => {
    const d = scheduleOfferDecision({ ownWords: 'call on Sep 20, 9am CET', receivedAt: '2026-09-15T10:00:00Z', nowISO: NOW, fallbackTz: 'UTC', existing: null, bookedNear: false, hasCounterparty: true });
    expect(d.action).toBe('none');
  });
});

describe('A CLAIM WITHOUT A CARD DOES NOT SERVE (the one answer door)', () => {
  it('"Here\'s the invite…" with no card → the honest line', () => {
    expect(claimFloorSay({ say: "Here's the invite. Review it and send when it looks right.", refs: [] })).toBe(CLAIM_WITHOUT_CARD_LINE);
    expect(claimFloorSay({ say: "I've drafted the reply for Sam.", refs: [] })).toBe(CLAIM_WITHOUT_CARD_LINE);
  });
  it('…with the card attached it stands', () => {
    const say = "Here's the invite. Review it and send when it looks right.";
    expect(claimFloorSay({ say, refs: [], invite: { id: 'i', invite: {} } })).toBe(say);
  });
  it('an inline body carries its own artifact; a plain answer is untouched', () => {
    const inline = "Here's the reply — I couldn't keep it as a card just now, so copy it before you leave:\n\nHi Sam, thanks for the terms. We are aligned on the scope and the timeline, and I will send the signed copy back by Friday. Best.";
    expect(claimFloorSay({ say: inline, refs: [] })).toBe(inline);
    expect(claimFloorSay({ say: 'The call is on Oct 12 at 9:30 Paris time.', refs: [] })).toBe('The call is on Oct 12 at 9:30 Paris time.');
    expect(claimFloorSay({ say: "I couldn't put the invite together just now.", refs: [] })).toBe("I couldn't put the invite together just now.");
  });
});

describe('THE OFFER LEADS THE PAGE (components/thread/item-page — one widget per screen)', () => {
  const base = { brief: null, who: 'Sam', ask: null, title: null, source: 'source' as const };
  it('awaiting approval with a nudge AND the offered invite → the invite is the ONE widget', () => {
    const p = composeItemPage({ ...base, machine: { state: 'awaiting_approval' }, mounted: { nudge_draft: true, invite: true }, lead: 'invite' });
    expect(p.action).toBe('invite');
  });
  it('without the lead the row\'s own order stands', () => {
    const p = composeItemPage({ ...base, machine: { state: 'awaiting_approval' }, mounted: { nudge_draft: true, invite: true } });
    expect(p.artifact).toBe('nudge_draft');
  });
  it('a lead the state does not offer is never a substitute', () => {
    const p = composeItemPage({ ...base, machine: { state: 'looks_done' }, mounted: { looks_done: true, invite: true }, lead: 'invite' });
    expect(p.action).toBe('confirm');
  });
});
