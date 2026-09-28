// W20.B · A CLAIM RENDERS IN EVERY CHAT (owner walk, Sep 28 — "can you send an invite for it?" answered
// "Here's the invite…" over nothing). Runs BOTH chat doors end to end over an in-memory Supabase fake
// with THE ONE conversation core stubbed (zero AI, zero network): what is asserted is the OUTCOME —
// the durable card turn each door writes (exactly once), the payload it returns, THE ONE STREAM's
// frames, and that the client half reads back exactly what the server half wrote.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const stub = vi.hoisted(() => ({
  turn: null as Record<string, unknown> | null,
  progress: [] as string[],
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

// ── an in-memory Supabase: eq/is/gte/lte/limit/order filters, inserts with the room_turns unique key ──
function fakeDb() {
  const t = stub.tables;
  const table = (name: string) => (t[name] ??= []);
  const q = (name: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: 'select' | 'update' | 'insert'; patch?: Row; rows?: Row[] } = { kind: 'select' };
    let wantSelect = false;
    const run = () => {
      if (op.kind === 'insert') {
        for (const r of op.rows ?? []) {
          if (name === 'room_turns' && r.dedupe_key
            && table(name).some((x) => x.user_id === r.user_id && x.room_key === r.room_key && x.dedupe_key === r.dedupe_key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
          table(name).push({ id: `${name}-${table(name).length + 1}`, created_at: new Date().toISOString(), archived_at: null, ...r });
        }
        return { data: null, error: null };
      }
      const hit = table(name).filter((r) => filters.every((f) => f(r)));
      if (op.kind === 'update') { for (const r of hit) Object.assign(r, op.patch); return { data: wantSelect ? hit : null, error: null }; }
      return { data: hit, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => { if (op.kind !== 'select') wantSelect = true; return api; },
      insert: (rows: Row | Row[]) => { op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return api; },
      update: (patch: Row) => { op = { kind: 'update', patch }; return api; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
      gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return api; },
      lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return api; },
      not: () => api, filter: () => api, in: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return api;
  };
  return {
    from: (name: string) => q(name),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: async () => ({ data: [], error: null }),
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeDb() }));
vi.mock('@/lib/converse', () => ({
  converse: vi.fn(async (_c: unknown, _u: string, _s: unknown, _t: string, opts?: { onProgress?: (l: string) => void }) => {
    for (const l of stub.progress) opts?.onProgress?.(l);
    return JSON.parse(JSON.stringify(stub.turn));
  }),
}));

import { POST as steer } from '@/app/api/items/steer/route';
import { POST as homeAsk } from '@/app/api/home/ask/route';
import { cardTurnOf, chatCardsOfComponent, chatCardsOfPayload, hasChatCards, CARD_TURN_FIELDS } from '@/lib/present/turn-card';
import { splitSseFrames } from '@/components/home/ask-stream-read';

const INVITE = { id: 'inv-1', invite: { type: 'calendar_invite', title: 'Implementation call', startISO: '2026-10-12T07:30:00.000Z', endISO: '2026-10-12T08:00:00.000Z', attendees: ['sam@acme.test'], timezone: 'Europe/Lisbon' } };
const EMAIL = { id: 'mail-1', draft: { to: ['sam@acme.test'], subject: 'Re: terms', body: 'Hi Sam — here are the terms.' } };
const BULK = { id: 'deed-1', deed: { verb: 'archive', count: 3 } };

const req = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const turns = () => stub.tables.room_turns ?? [];
const cardRows = () => turns().filter((r) => r.role === 'system' && r.component);

beforeEach(() => { stub.tables = {}; stub.progress = []; stub.turn = null; });

describe('the item door (app/api/items/steer) — every card kind', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['invite', { invite: INVITE }, 'invite_card'],
    ['emailDraft', { emailDraft: EMAIL }, 'email_draft_card'],
    ['bulkDeed', { bulkDeed: BULK }, 'bulk_deed_card'],
  ];
  for (const [field, extra, key] of cases) {
    it(`${field}: returned in the payload AND persisted as a ${key} turn (the claiming request only)`, async () => {
      stub.turn = { say: 'Here it is — review it on the card.', refs: [], ...extra };
      const res = await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-1', text: 'can you send an invite for it?', answerKey: 'aaaaaaaa-1111' }));
      const d = await res.json();
      expect(d[field]).toBeTruthy();
      const cards = cardRows();
      expect(cards).toHaveLength(1);
      expect((cards[0].component as { key: string }).key).toBe(key);
      expect(cards[0].room_key).toBe('inbox:item-1');
      // …and the client half reads back exactly what the server half wrote.
      expect(hasChatCards(chatCardsOfComponent(cards[0].component as never))).toBe(true);
      expect(hasChatCards(chatCardsOfPayload(d))).toBe(true);
      // EXACTLY ONCE: a duplicate delivery of the same question writes nothing new.
      await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-1', text: 'can you send an invite for it?', answerKey: 'aaaaaaaa-1111' }));
      expect(cardRows()).toHaveLength(1);
      expect(turns().filter((r) => r.role === 'user')).toHaveLength(1);
    });
  }

  it('THE ONE STREAM: progress labels, then one done frame carrying the card', async () => {
    stub.turn = { say: "Here's the invite. Review it and send when it looks right.", refs: [], invite: INVITE };
    stub.progress = ['Putting the invite together…'];
    const res = await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-2', text: 'send an invite', answerKey: 'bbbbbbbb-2222', stream: true }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const { events } = splitSseFrames(`${await res.text()}\n\n`);
    const evs = events as Array<Record<string, unknown>>;
    expect(evs.find((e) => e.type === 'progress')?.label).toBe('Putting the invite together…');
    const done = evs.find((e) => e.type === 'done') as Record<string, unknown>;
    expect((done.invite as { id: string }).id).toBe('inv-1');
    expect(cardRows()).toHaveLength(1);
  });

  it('a plain answer (no card) is saved as the answer row, no component', async () => {
    stub.turn = { say: 'The call is on Oct 12.', refs: [] };
    await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-3', text: 'when is it?', answerKey: 'cccccccc-3333' }));
    const sys = turns().filter((r) => r.role === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0].component).toBeNull();
  });
});

describe('the Home door (app/api/home/ask) — the same table', () => {
  it('writes the same component for an invite as the item door', async () => {
    stub.turn = { say: "Here's the invite.", refs: [], invite: INVITE };
    const roomKey = 'chat:12345678-1234-1234-1234-123456789abc';
    const res = await homeAsk(req('http://x/api/home/ask', { question: 'invite Sam', roomKey, entityId: 'ent-1' }));
    const d = await res.json();
    expect(d.invite.id).toBe('inv-1');
    const cards = cardRows();
    expect(cards).toHaveLength(1);
    expect(cards[0].component).toEqual(cardTurnOf({ invite: INVITE as never })!.component);
  });
});

describe('the inverse gate — every card field round-trips server → client', () => {
  const samples: Record<string, unknown> = {
    invite: INVITE, bulkDeed: BULK, emailDraft: EMAIL,
    collection: { id: 'col-1', spec: { kind: 'documents', framing: 'Two documents.', rows: [{ id: 'r1', title: 'Terms' }] } },
    event: { id: 'ev-1', spec: { id: 'ev-1', title: 'Implementation call', startISO: '2026-10-12T07:30:00.000Z', endISO: '2026-10-12T08:00:00.000Z', attendees: [], verbs: [] } },
    change: { id: 'chg-1', spec: { id: 'chg-1', summary: 'Remember the fact', kind: 'memory', status: 'pending' } },
  };
  it('the sample set IS the table', () => {
    expect(Object.keys(samples).sort()).toEqual([...CARD_TURN_FIELDS].sort());
  });
  for (const f of CARD_TURN_FIELDS) {
    it(`${f}: a durable component the hydrator reads back`, () => {
      const card = cardTurnOf({ [f]: samples[f] } as never);
      expect(card?.field).toBe(f);
      expect(hasChatCards(chatCardsOfComponent(card!.component))).toBe(true);
    });
  }
});
