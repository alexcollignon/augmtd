// W19.2a · A CATCH-UP GETS A REAL ANSWER; AN EMPTY SET IS NOT A CARD (owner walk, Sep 28).
// Runs THE ONE conversation core (lib/converse) end to end over in-memory fakes: zero AI (the router,
// the loop and the answer paths are stubs), zero DB (every read comes back empty). What is asserted is
// the OUTCOME — which answer path a note reaches, and whether a card rides the turn.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ⟲ RE-POINTED W22 (THE HOME CHAT IS ONE ASSISTANT): the model ROUTER and its synthesis verdict are
// retired — a catch-up is answered by the ONE loop from the same grounded page (the read is a tool it
// may use; an empty read is never the answer by itself), and a literal listing takes the deterministic
// command fast path. The laws asserted are unchanged: a catch-up gets a real answer, an empty set is
// not a card, a listing with rows is served by its card.
type Scripted = { loop: Array<{ tool?: string; args?: Record<string, unknown>; say?: string }> };
const stub = vi.hoisted(() => ({
  script: { loop: [] } as Scripted,
  loopCalls: 0,
  toolsOffered: [] as string[],
  systems: [] as string[],
  entityAsks: [] as string[],
  meetings: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/ai/factory', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/factory')>()),
  getAIClient: vi.fn(async () => ({ client: { chat: { completions: { create: async () => { throw new Error('no stream in the stub'); } } } }, model: 'stub' })),
  getSystemClient: vi.fn(() => ({ client: {}, model: 'stub' })),
  aiCreate: vi.fn(async (_ai: unknown, req: { messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> }) => {
    stub.systems.push(String(req.messages?.[0]?.content ?? ''));
    // The ONE loop: scripted steps (a tool call, then an answer).
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
  buildBrainSnapshot: vi.fn(async () => ({ text: 'WORLD', refs: new Map() })),
}));
vi.mock('@/lib/room/grounding', async (orig) => ({
  ...(await orig<typeof import('@/lib/room/grounding')>()),
  assembleRoomGrounding: vi.fn(async () => ({ text: 'ROOM PAGE — decisions: two stand · open: one question · owner: Sam', entity: { id: 'ent-1', name: 'Acme' }, ledgerRefs: new Map() })),
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

import { converse } from '@/lib/converse';

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
  stub.script = { loop: [] };
  stub.loopCalls = 0; stub.toolsOffered = []; stub.systems = []; stub.entityAsks = []; stub.meetings = [];
});

describe('A CATCH-UP GETS A REAL ANSWER — the one loop answers it from the grounded page', () => {
  it('the incident: a room catch-up is answered by the loop over the ROOM PAGE, told an empty read is never the answer — no card', async () => {
    stub.script.loop = [{ tool: 'get_meeting_context', args: { since: '7d' } }, { say: 'Two decisions stand, one question is open, Sam owns the next step.' }];
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, CATCH_UP);
    expect(stub.loopCalls).toBe(2);
    expect(stub.systems[0]).toMatch(/ROOM PAGE/);
    expect(stub.systems[0]).toMatch(/a read that comes back EMPTY is never the answer by itself/);
    expect(turn.say).toMatch(/^Two decisions stand/);
    expect(turn.collection ?? null).toBeNull();
    expect(stub.entityAsks).toEqual([]);
  });

  it('a literal listing ask gets its collection on the command fast path — no model call', async () => {
    stub.meetings = [MEETING];
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'list my recordings from this week');
    expect(stub.loopCalls).toBe(0);
    expect(turn.collection?.spec.kind).toBe('recordings');
    expect(turn.collection?.spec.rows).toHaveLength(1);
    expect(turn.say).toBe('1 recording in the last 7 days.');
  });

  it('a zero-row collection is NOT the answer: the listing ask with nothing to list falls through to a composed answer, with no card', async () => {
    stub.script.loop = [{ tool: 'get_meeting_context', args: { since: '7d' } }, { say: 'You have not recorded anything this week — the last recorded call was the kick-off.' }];
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'list my recordings from this week');
    expect(stub.loopCalls).toBe(2);
    expect(stub.systems[0]).toMatch(/came back EMPTY/);
    expect(turn.say).toMatch(/not recorded anything/);
    expect(turn.collection ?? null).toBeNull();
  });

  it('in the loop, an empty read never rides the turn as a card — and a read with rows still does (SPEAK → SHOW)', async () => {
    stub.script.loop = [{ tool: 'get_meeting_context', args: {} }, { say: 'Nothing recorded, so here is what the page shows.' }];
    const empty = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'prep me for Thursday and draft the agenda');
    expect(empty.collection ?? null).toBeNull();

    stub.loopCalls = 0; stub.meetings = [MEETING];
    stub.script.loop = [{ tool: 'get_meeting_context', args: {} }, { say: 'The kick-off left one action open.' }];
    const full = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'prep me for Thursday and draft the agenda');
    expect(full.collection?.spec.rows).toHaveLength(1);
  });

  it('a simple room question is the same conversation (no second answering lane)', async () => {
    stub.script.loop = [{ say: 'Sam is the contact at Acme.' }];
    const turn = await converse(emptyDb(), 'u-1', { kind: 'entity', entityId: 'ent-1' }, 'who is the contact at Acme?');
    expect(stub.entityAsks).toEqual([]);
    expect(stub.loopCalls).toBe(1);
    expect(turn.say).toBe('Sam is the contact at Acme.');
  });
});
