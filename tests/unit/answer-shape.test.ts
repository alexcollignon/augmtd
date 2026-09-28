// W19.2a · A CATCH-UP GETS A REAL ANSWER; AN EMPTY SET IS NOT A CARD (owner walk, Sep 28).
// Runs THE ONE conversation core (lib/converse) end to end over in-memory fakes: zero AI (the router,
// the loop and the answer paths are stubs), zero DB (every read comes back empty). What is asserted is
// the OUTCOME — which answer path a note reaches, and whether a card rides the turn.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Scripted = { router: Record<string, unknown>; loop: Array<{ tool?: string; args?: Record<string, unknown>; say?: string }> };
const stub = vi.hoisted(() => ({
  script: { router: {}, loop: [] } as Scripted,
  loopCalls: 0,
  toolsOffered: [] as string[],
  homeAsks: [] as Array<{ q: string; focusEntityId: string | null }>,
  entityAsks: [] as string[],
  meetings: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/ai/factory', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/factory')>()),
  getAIClient: vi.fn(async () => ({ client: { chat: { completions: { create: async () => { throw new Error('no stream in the stub'); } } } }, model: 'stub' })),
  getSystemClient: vi.fn(() => ({ client: {}, model: 'stub' })),
  aiCreate: vi.fn(async (_ai: unknown, req: { messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> }) => {
    const first = String(req.messages?.[0]?.content ?? '');
    if (/You are the router of a work assistant/.test(first)) {
      return { choices: [{ message: { content: JSON.stringify(stub.script.router) } }] };
    }
    // The agent loop: scripted steps (a tool call, then an answer).
    stub.toolsOffered = (req.tools ?? []).map((t) => t.function.name);
    const step = stub.script.loop[stub.loopCalls++] ?? { say: 'Loop answer.' };
    if (step.tool) {
      return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `c${stub.loopCalls}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) } }] } }] };
    }
    return { choices: [{ message: { role: 'assistant', content: step.say ?? 'Loop answer.' } }] };
  }),
}));
vi.mock('@/lib/ai/call', () => ({ aiCall: vi.fn(async () => ({ json: null, text: '' })) }));
vi.mock('@/lib/home/ask', async (orig) => ({
  ...(await orig<typeof import('@/lib/home/ask')>()),
  answerHomeQuestion: vi.fn(async (_c: unknown, _u: string, q: string, _h: unknown, opts?: { focusEntityId?: string | null }) => {
    stub.homeAsks.push({ q, focusEntityId: opts?.focusEntityId ?? null });
    return { answer: 'Grounded catch-up: two decisions stand, one question is open, Sam owns the next step.', refs: [] };
  }),
  buildBrainSnapshot: vi.fn(async () => ({ text: 'WORLD', refs: new Map() })),
}));
vi.mock('@/lib/entities/ask', () => ({
  answerEntityQuestion: vi.fn(async (_c: unknown, _u: string, _e: string, q: string) => {
    stub.entityAsks.push(q);
    return { answer: 'Entity answer.', refs: [] };
  }),
}));
vi.mock('@/lib/room/grounding', async (orig) => ({
  ...(await orig<typeof import('@/lib/room/grounding')>()),
  assembleRoomGrounding: vi.fn(async () => ({ text: 'ROOM PAGE', entity: { id: 'ent-1', name: 'Acme' }, ledgerRefs: new Map() })),
}));
vi.mock('@/lib/tools/get-meeting-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/tools/get-meeting-context')>()),
  readMeetingContext: vi.fn(async () => ({
    blocks: stub.meetings.map((m) => ({ id: String(m.id), text: `Meeting ${String(m.title)}` })),
    meetings: stub.meetings,
  })),
}));
vi.mock('@/lib/converse/read-budget', () => ({
  packMeetingRead: (blocks: Array<{ id: string; text: string }>) => ({ text: blocks.map((b) => b.text).join('\n'), seen: new Set(blocks.map((b) => b.id)) }),
}));

import { converse, parseVerdict, synthesisPrecedence } from '@/lib/converse';

/** A Supabase stand-in where every read is empty and every write succeeds. */
function emptyDb() {
  const chain: Record<string, unknown> = {};
  const done = { data: [], error: null, count: 0 };
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(done).then(res);
      if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
      return () => proxy;
    },
  });
  return {
    from: () => proxy,
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => proxy },
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never;
}

const CATCH_UP = 'Catch me up on this client. What has changed since the last meeting? Show me the current decisions, open questions, next actions, owners, deadlines and anything that conflicts with earlier discussions';
const MEETING = { id: 'm-1', title: 'Acme kick-off', dateLabel: 'Mon 21 Sep 2026', duration_minutes: 30, actionItems: ['send the scope'], attendees: [{ email: 'sam@acme-example.com' }] };

beforeEach(() => {
  stub.script = { router: {}, loop: [] };
  stub.loopCalls = 0; stub.toolsOffered = []; stub.homeAsks = []; stub.entityAsks = []; stub.meetings = [];
});

describe('A CATCH-UP GETS A REAL ANSWER — the router\'s synthesis verdict outranks the read it named', () => {
  it('the incident: a room catch-up the router mapped to the meeting read reaches the Home answer path, pinned to the room — no card', async () => {
    stub.script.router = { command: { tool: 'get_meeting_context', args: { since: '7d' } }, question: true, facts: [], delegate: null, open: false, synthesis: true };
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, CATCH_UP);
    expect(stub.homeAsks).toEqual([{ q: CATCH_UP, focusEntityId: 'ent-1' }]);
    expect(stub.loopCalls).toBe(0);
    expect(turn.say).toMatch(/^Grounded catch-up/);
    expect(turn.collection ?? null).toBeNull();
  });

  it('a literal listing ask still gets its collection (the fast path), whatever the router said about synthesis', async () => {
    stub.meetings = [MEETING];
    stub.script.router = { command: { tool: 'get_meeting_context', args: { since: '7d' } }, question: true, facts: [], delegate: null, open: false, synthesis: true };
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'list my recordings');
    expect(stub.homeAsks).toEqual([]);
    expect(turn.collection?.spec.kind).toBe('recordings');
    expect(turn.collection?.spec.rows).toHaveLength(1);
    expect(turn.say).toBe('1 recording in the last 7 days.');
  });

  it('a zero-row collection is NOT the answer: the listing ask with nothing to list falls through to a composed answer, with no card', async () => {
    stub.script.router = { command: { tool: 'get_meeting_context', args: { since: '7d' } }, question: false, facts: [], delegate: null, open: false, synthesis: false };
    stub.script.loop = [{ tool: 'get_meeting_context', args: { since: '7d' } }, { say: 'You have not recorded anything this week — the last recorded call was the kick-off.' }];
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'list my recordings');
    expect(stub.loopCalls).toBe(2);
    expect(turn.say).toMatch(/not recorded anything/);
    expect(turn.collection ?? null).toBeNull();
  });

  it('in the loop, an empty read never rides the turn as a card — and a read with rows still does (SPEAK → SHOW)', async () => {
    stub.script.router = { command: null, question: false, facts: [], delegate: null, open: true, synthesis: false };
    stub.script.loop = [{ tool: 'get_meeting_context', args: {} }, { say: 'Nothing recorded, so here is what the page shows.' }];
    const empty = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'prep me for Thursday and draft the agenda');
    expect(empty.collection ?? null).toBeNull();

    stub.loopCalls = 0; stub.meetings = [MEETING];
    stub.script.loop = [{ tool: 'get_meeting_context', args: {} }, { say: 'The kick-off left one action open.' }];
    const full = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'prep me for Thursday and draft the agenda');
    expect(full.collection?.spec.rows).toHaveLength(1);
  });

  it('a simple (non-synthesis) room question keeps the room\'s own answer path', async () => {
    stub.script.router = { command: null, question: true, facts: [], delegate: null, open: false, synthesis: false };
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'who is the contact at Acme?');
    expect(stub.entityAsks).toEqual(['who is the contact at Acme?']);
    expect(stub.homeAsks).toEqual([]);
    expect(turn.say).toBe('Entity answer.');
  });
});

describe('the precedence rule, pure', () => {
  const base = { command: null, question: true, facts: [], delegate: null, open: false, synthesis: true };
  it('drops a named READ for a synthesis question and makes it a question', () => {
    const v = synthesisPrecedence({ ...base, command: { tool: 'get_meeting_context', args: {} }, question: false, open: true }, 'what changed since the last meeting and what is still open?');
    expect(v).toMatchObject({ command: null, question: true, open: false, synthesis: true });
  });
  it('never drops a DEED, never overrides a hand-off, never claims a literal listing', () => {
    expect(synthesisPrecedence({ ...base, command: { tool: 'resolve_inbox_item', args: {} } }, 'catch me up and mark it done').command?.tool).toBe('resolve_inbox_item');
    expect(synthesisPrecedence({ ...base, delegate: { coworker: 'Max', task: 'x' } }, 'catch me up').synthesis).toBe(false);
    expect(synthesisPrecedence({ ...base, command: { tool: 'get_meeting_context', args: {} } }, 'list my recordings')).toMatchObject({ synthesis: false, command: { tool: 'get_meeting_context' } });
  });
  it('an instruction (not a question, no read named) stays an instruction', () => {
    expect(synthesisPrecedence({ ...base, question: false, open: true }, 'summarise the week and email it to Sam')).toMatchObject({ open: true, synthesis: false });
  });
  it('parseVerdict reads the router\'s synthesis field and defaults a malformed reply to the open loop', () => {
    expect(parseVerdict('{"command":null,"question":true,"synthesis":true}').synthesis).toBe(true);
    expect(parseVerdict('{"command":null,"question":true}').synthesis).toBe(false);
    expect(parseVerdict('not json')).toMatchObject({ open: true, synthesis: false, command: null });
  });
});
