// W23.B · THE DOORS — the receipt, the stop and the title as the Home door (app/api/home/ask) and the item
// door (app/api/items/steer) persist and serve them, over an in-memory Supabase with THE ONE conversation
// core stubbed (zero AI, zero network). What is asserted is the OUTCOME:
//   D1 · the done payload carries `activity` + `durationMs`; both are persisted with the answer turn (the
//        turn_meta companion record) and read back by GET /api/room/turns
//   D2 · a stopped turn is persisted ONCE as the answer, marked stopped — never a failure turn; a duplicate
//        delivery writes nothing
//   D3 · a cancelled stream aborts the turn's signal, and the work still persists after the reader left
//   D4 · a new Home chat is titled after its FIRST answer, in after() (the response never waits), once;
//        a user's rename wins; the room turns read and /api/rooms/recent expose `title`
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const stub = vi.hoisted(() => ({
  turn: null as Record<string, unknown> | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  afters: [] as Array<() => unknown>,
  signals: [] as Array<AbortSignal | undefined>,
  titleCalls: 0,
  titleReply: 'Quarterly Pricing Review',
  holdTurn: null as null | Promise<void>,
}));

// ── an in-memory Supabase: the filters these doors use, upsert on the item_plans key, unique room_turns keys ──
function fakeDb() {
  const t = stub.tables;
  const table = (name: string) => (t[name] ??= []);
  const q = (name: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: 'select' | 'update' | 'insert' | 'upsert' | 'delete'; patch?: Row; rows?: Row[] } = { kind: 'select' };
    let wantSelect = false;
    let lim: number | null = null;
    let range: [number, number] | null = null;
    const run = () => {
      if (op.kind === 'insert' || op.kind === 'upsert') {
        const out: Row[] = [];
        for (const r of op.rows ?? []) {
          if (name === 'item_plans') {
            const ex = table(name).find((x) => x.user_id === r.user_id && x.kind === r.kind && x.entity_id === r.entity_id);
            if (ex) {
              if (op.kind === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value' } };
              Object.assign(ex, r); out.push(ex); continue;
            }
          }
          if (name === 'room_turns' && r.dedupe_key
            && table(name).some((x) => x.user_id === r.user_id && x.room_key === r.room_key && x.dedupe_key === r.dedupe_key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
          const row = { id: `${name}-${table(name).length + 1}`, created_at: new Date(Date.now() + table(name).length).toISOString(), archived_at: null, ...r };
          table(name).push(row); out.push(row);
        }
        return { data: wantSelect ? out : null, error: null };
      }
      const hit = table(name).filter((r) => filters.every((f) => f(r)));
      if (op.kind === 'update') { for (const r of hit) Object.assign(r, op.patch); return { data: wantSelect ? hit : null, error: null }; }
      if (op.kind === 'delete') { t[name] = table(name).filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      let rows = hit;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (lim != null) rows = rows.slice(0, lim);
      return { data: rows, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => { if (op.kind !== 'select') wantSelect = true; return api; },
      insert: (rows: Row | Row[]) => { op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return api; },
      upsert: (rows: Row | Row[]) => { op = { kind: 'upsert', rows: Array.isArray(rows) ? rows : [rows] }; return api; },
      update: (patch: Row) => { op = { kind: 'update', patch }; return api; },
      delete: () => { op = { kind: 'delete' }; return api; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return api; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return api; },
      like: (k: string, pat: string) => { const pre = pat.replace(/%$/, '').replace(/\\(.)/g, '$1'); filters.push((r) => String(r[k] ?? '').startsWith(pre)); return api; },
      gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return api; },
      gt: (k: string, v: string) => { filters.push((r) => String(r[k]) > v); return api; },
      lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return api; },
      not: () => api, filter: () => api, or: () => api, contains: () => api,
      order: () => api,
      limit: (n: number) => { lim = n; return api; },
      range: (a: number, b: number) => { range = [a, b]; return api; },
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

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: (() => unknown) | Promise<unknown>) => { stub.afters.push(typeof task === 'function' ? task : () => task); },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeDb() }));
vi.mock('@/lib/converse', () => ({
  converse: vi.fn(async (_c: unknown, _u: string, _s: unknown, _t: string, opts?: { signal?: AbortSignal; onProgress?: (l: string) => void }) => {
    stub.signals.push(opts?.signal);
    opts?.onProgress?.('Checking your calendar…');
    if (stub.holdTurn) await stub.holdTurn;
    const t = JSON.parse(JSON.stringify(stub.turn));
    if (opts?.signal?.aborted) return { ...t, say: t.say || 'Stopped.', stopped: true };
    return t;
  }),
}));
vi.mock('@/lib/ai/factory', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/factory')>()),
  getAIClient: vi.fn(async (_u: string, task: string) => ({ client: {}, model: `stub-${task}`, endpoint: { provider: 'stub' }, tier: 'standard' })),
  aiCreate: vi.fn(async (_c: unknown, req: { max_tokens?: number; model: string }) => {
    stub.titleCalls++;
    expect(req.model).toBe('stub-classification');   // the volume slot, never the conversation model
    expect(req.max_tokens).toBeLessThanOrEqual(60);
    return { choices: [{ message: { content: `"${stub.titleReply}." 🚀` } }], usage: { prompt_tokens: 50, completion_tokens: 6 } };
  }),
}));
vi.mock('@/lib/ai/log-usage', () => ({ logAIUsage: vi.fn(async () => {}) }));

import { POST as steer } from '@/app/api/items/steer/route';
import { POST as homeAsk } from '@/app/api/home/ask/route';
import { GET as roomTurns } from '@/app/api/room/turns/route';
import { GET as roomsRecent } from '@/app/api/rooms/recent/route';
import { converseStreamResponse } from '@/lib/present/converse-stream';
import { cleanTitle, ensureHomeChatTitle } from '@/lib/converse/chat-title';
import { splitSseFrames } from '@/components/home/ask-stream-read';

const ROOM = 'chat:12345678-1234-1234-1234-123456789abc';
const ACTIVITY = [{ label: 'Checking your calendar…', atMs: 120 }, { label: 'Putting the invite together…', atMs: 2400 }];
const req = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const getReq = (url: string) => new NextRequest(url);
const turns = () => stub.tables.room_turns ?? [];
const plans = (kind: string) => (stub.tables.item_plans ?? []).filter((r) => r.kind === kind);
const runAfters = async () => { const a = stub.afters.splice(0); for (const f of a) await f(); };

beforeEach(() => {
  stub.tables = {}; stub.turn = null; stub.afters = []; stub.signals = []; stub.titleCalls = 0;
  stub.titleReply = 'Quarterly Pricing Review'; stub.holdTurn = null;
});

describe('D1 · THE RECEIPT RIDES THE ANSWER AND SURVIVES THE RELOAD', () => {
  it('item door: done payload carries activity + durationMs; persisted beside the answer; read back by GET /api/room/turns', async () => {
    stub.turn = { say: 'The call is on Oct 12.', refs: [], activity: ACTIVITY, durationMs: 4321 };
    const res = await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-1', text: 'when is it?', answerKey: 'aaaaaaaa-1111', stream: true }));
    const { events } = splitSseFrames(`${await res.text()}\n\n`);
    const done = (events as Array<Record<string, unknown>>).find((e) => e.type === 'done')!;
    expect(done.activity).toEqual(ACTIVITY);
    expect(done.durationMs).toBe(4321);
    const answer = turns().find((r) => r.role === 'system')!;
    expect(plans('turn_meta')).toHaveLength(1);
    expect(plans('turn_meta')[0].entity_id).toBe(`inbox:item-1|${answer.id}`);
    const read = await (await roomTurns(getReq('http://x/api/room/turns?key=inbox:item-1'))).json();
    const served = (read.turns as Array<Record<string, unknown>>).find((x) => x.id === answer.id)!;
    expect(served.activity).toEqual(ACTIVITY);
    expect(served.durationMs).toBe(4321);
    expect(served.stopped).toBeUndefined();
  });

  it('Home door: the JSON payload carries it and the chat room reads it back', async () => {
    stub.turn = { say: 'Here is the plan.', refs: [], activity: ACTIVITY, durationMs: 9000 };
    const d = await (await homeAsk(req('http://x/api/home/ask', { question: 'plan my week', roomKey: ROOM }))).json();
    expect(d.activity).toEqual(ACTIVITY);
    expect(d.durationMs).toBe(9000);
    const read = await (await roomTurns(getReq(`http://x/api/room/turns?key=${ROOM}`))).json();
    const served = (read.turns as Array<Record<string, unknown>>).find((x) => x.role === 'system')!;
    expect(served.durationMs).toBe(9000);
  });
});

describe('D2 · A STOPPED TURN IS THE ANSWER, WRITTEN ONCE, MARKED STOPPED', () => {
  it('item door: the partial is the claimed question\'s answer (never a failure); a duplicate delivery writes nothing', async () => {
    stub.turn = { say: 'The first part of the', refs: [], stopped: true, durationMs: 800 };
    const d = await (await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-2', text: 'draft the plan', answerKey: 'bbbbbbbb-2222' }))).json();
    expect(d.stopped).toBe(true);
    expect(d.failure).toBeUndefined();
    await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-2', text: 'draft the plan', answerKey: 'bbbbbbbb-2222' }));
    const sys = turns().filter((r) => r.role === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0].text).toBe('The first part of the');
    expect(plans('turn_meta')).toHaveLength(1);
    expect((plans('turn_meta')[0].tasks as Row).stopped).toBe(true);
    const read = await (await roomTurns(getReq('http://x/api/room/turns?key=inbox:item-2'))).json();
    expect((read.turns as Array<Record<string, unknown>>).find((x) => x.role === 'system')?.stopped).toBe(true);
  });

  it('Home door: the stopped answer persists once; a stopped FIRST answer earns no title', async () => {
    stub.turn = { say: 'Stopped.', refs: [], stopped: true, durationMs: 300 };
    const d = await (await homeAsk(req('http://x/api/home/ask', { question: 'write me a plan', roomKey: ROOM }))).json();
    expect(d.stopped).toBe(true);
    expect(turns().filter((r) => r.role === 'system')).toHaveLength(1);
    expect((plans('turn_meta')[0].tasks as Row).stopped).toBe(true);
    await runAfters();
    expect(stub.titleCalls).toBe(0);
  });

  it('a failure is still never persisted (W22 unchanged)', async () => {
    stub.turn = { say: 'That took too long — try again.', refs: [], failure: { kind: 'timeout', retry: true } };
    await homeAsk(req('http://x/api/home/ask', { question: 'plan my week', roomKey: ROOM }));
    expect(turns().filter((r) => r.role === 'system')).toHaveLength(0);
    expect(plans('turn_meta')).toHaveLength(0);
  });
});

describe('D3 · A CANCELLED STREAM STOPS THE TURN', () => {
  it('the door hands the core an abort signal; cancelling the stream aborts it; the answer still lands', async () => {
    let release!: () => void;
    stub.holdTurn = new Promise<void>((r) => { release = r; });
    stub.turn = { say: 'Partial words', refs: [] };
    const res = await steer(req('http://x/api/items/steer', { kind: 'email', id: 'item-3', text: 'long one', answerKey: 'cccccccc-3333', stream: true }));
    const reader = res.body!.getReader();
    await reader.read();                     // the stream is open (first frame)
    await vi.waitFor(() => expect(stub.signals.length).toBe(1));
    expect(stub.signals[0]?.aborted).toBe(false);
    await reader.cancel();                   // the user pressed Stop / closed the tab
    expect(stub.signals[0]?.aborted).toBe(true);
    release();
    // the work outlives the reader (held open by after() in production) and persists once, stopped
    await vi.waitFor(() => expect(turns().filter((r) => r.role === 'system')).toHaveLength(1));
    await vi.waitFor(() => expect((plans('turn_meta')[0]?.tasks as Row | undefined)?.stopped).toBe(true));
  });

  it('converseStreamResponse: cancel → abort, and keepAlive receives the work promise', async () => {
    const abort = new AbortController();
    const kept: Array<Promise<unknown>> = [];
    let finish!: () => void;
    const res = converseStreamResponse(() => new Promise((r) => { finish = () => r({ ok: true }); }), { abort, keepAlive: (p) => kept.push(p) });
    expect(kept).toHaveLength(1);
    await res.body!.cancel();
    expect(abort.signal.aborted).toBe(true);
    finish();
    await expect(kept[0]).resolves.toBeUndefined();
  });
});

describe('D4 · A CHAT NAMES ITSELF AFTER ITS FIRST ANSWER', () => {
  it('scheduled in after() (the answer never waits), ONE volume-slot call, stored once, served by the reads', async () => {
    stub.turn = { say: 'Here are three options for the pricing review.', refs: [] };
    await homeAsk(req('http://x/api/home/ask', { question: 'help me prepare the quarterly pricing review', roomKey: ROOM }));
    // the response is back and no title call has run yet
    expect(stub.titleCalls).toBe(0);
    expect(plans('room_title')).toHaveLength(0);
    await runAfters();
    expect(stub.titleCalls).toBe(1);
    expect(plans('room_title')).toHaveLength(1);
    expect(plans('room_title')[0].tasks).toMatchObject({ title: 'Quarterly Pricing Review', auto: true });
    // idempotent: a second first-answer (a retry) makes no model call and writes nothing
    await homeAsk(req('http://x/api/home/ask', { question: 'help me prepare the quarterly pricing review', roomKey: ROOM }));
    await runAfters();
    expect(stub.titleCalls).toBe(1);
    expect(plans('room_title')).toHaveLength(1);
    // the reads expose it (the panel writes the user's own turn — a conversation needs the user's voice)
    stub.tables.room_turns.push({ id: 'u-turn', user_id: 'user-1', room_key: ROOM, role: 'user', text: 'help me prepare the quarterly pricing review', created_at: new Date(Date.now() - 1000).toISOString(), archived_at: null });
    const read = await (await roomTurns(getReq(`http://x/api/room/turns?key=${ROOM}`))).json();
    expect(read.title).toBe('Quarterly Pricing Review');
    const recent = await (await roomsRecent(getReq('http://x/api/rooms/recent'))).json();
    const row = (recent.conversations as Array<Record<string, unknown>>).find((c) => c.key === ROOM);
    expect(row?.title).toBe('Quarterly Pricing Review');
    expect((recent.chats as Array<Record<string, unknown>>).find((c) => c.key === ROOM)?.title).toBe('Quarterly Pricing Review');
  });

  it('only after the FIRST answer: a later turn schedules nothing', async () => {
    stub.turn = { say: 'Sure.', refs: [] };
    await homeAsk(req('http://x/api/home/ask', { question: 'and next?', roomKey: ROOM, history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello.' }] }));
    await runAfters();
    expect(stub.titleCalls).toBe(0);
  });

  it('a user rename wins — before (no model call) and after (the rename overwrites the generated title)', async () => {
    const db = fakeDb() as never;
    stub.tables.item_plans = [{ id: 'p1', user_id: 'user-1', kind: 'room_title', entity_id: ROOM, tasks: { title: 'My Own Name' } }];
    expect(await ensureHomeChatTitle(db, 'user-1', ROOM, { question: 'q', answer: 'a' })).toBe('exists');
    expect(stub.titleCalls).toBe(0);
    expect((plans('room_title')[0].tasks as Row).title).toBe('My Own Name');
    // a rename landing between the read and the write: the generated title's INSERT collides and yields
    stub.tables.item_plans = [];
    const race = ensureHomeChatTitle(db, 'user-1', ROOM, { question: 'q', answer: 'a' });
    stub.tables.item_plans.push({ id: 'p2', user_id: 'user-1', kind: 'room_title', entity_id: ROOM, tasks: { title: 'Renamed Meanwhile' } });
    expect(['exists', 'stored']).toContain(await race);
    expect(plans('room_title')).toHaveLength(1);
    expect((plans('room_title')[0].tasks as Row).title).toBe('Renamed Meanwhile');
  });

  it('cleanTitle: quotes, emoji, prefixes and trailing punctuation go; at most six words; empty → null', () => {
    expect(cleanTitle('"Quarterly Pricing Review." 🚀')).toBe('Quarterly Pricing Review');
    expect(cleanTitle('Title: Revisão Do Contrato Anual')).toBe('Revisão Do Contrato Anual');
    expect(cleanTitle('One Two Three Four Five Six Seven Eight')).toBe('One Two Three Four Five Six');
    expect(cleanTitle('  ')).toBeNull();
    expect(cleanTitle('**Weekly Report Redesign**')).toBe('Weekly Report Redesign');
  });
});
