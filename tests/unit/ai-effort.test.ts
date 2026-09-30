// W27.C — THE EFFORT LEVER, zero AI. The transport is faked at the SDK prototype (the same seam the eval
// meter uses), so every assertion reads the params the factory would really SEND:
//   · the param floor's defaults are unchanged when nothing states an effort;
//   · the eval override is ignored in production (and without the explicit eval flag);
//   · an effort above 'minimal' adds output headroom (gpt-5 / Claude-5) or a thinking budget (Claude 4.5),
//     and aiCall arms its empty-content retry for it;
//   · the effort actually applied reaches the usage record.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';
import {
  applyEffort, effortOverride, effortOverrideArmed, parseEffortOverride, slotEffort, effortFamily, effortOf,
  EFFORT_KEY, EFFORT_HEADROOM, THINKING_BUDGET, SLOT_EFFORT,
  PRODUCER_EFFORT, producerEffort, producerEffortOverride, EFFORT_PRODUCERS,
  openaiReasoningFloor, openaiReasoningValue,
} from '../../lib/ai/effort';
import { MODEL_PRICING } from '../../lib/ai/pricing';
import { aiCreate, getAIClient, getEndpointClient, unboundClient, boundEffortOf, invalidateTenantConfig } from '../../lib/ai/factory';
import { aiCall } from '../../lib/ai/call';
import { logAIUsage, taskTypeWithEffort } from '../../lib/ai/log-usage';
import { thinkingOf } from '../../lib/ai/bedrock-adapter';

type Sent = Record<string | symbol, unknown>;
const sent: Sent[] = [];
let reply: (p: Sent) => string = () => '{"ok":true}';

beforeAll(() => {
  process.env.OPENAI_API_KEY ||= 'test-key';
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
  const proto = (OpenAI as unknown as { Chat: { Completions: { prototype: { create: unknown } } } }).Chat.Completions.prototype;
  proto.create = async function fake(params: Sent) {
    sent.push(params);
    return {
      id: 'x', object: 'chat.completion', created: 0, model: params.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: reply(params) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  };
});

const ENV_KEYS = ['AI_EFFORT_OVERRIDE', 'AUGMTD_EVAL', 'VERCEL_ENV'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  sent.length = 0;
  reply = () => '{"ok":true}';
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  saved.NODE_ENV = process.env.NODE_ENV;
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
  invalidateTenantConfig('u-1');
});

/** A tenant-config reader that finds nothing → the standard tier. */
function fakeSupabase(inserts: Sent[] = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'not', 'limit']) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  return { from: () => ({ ...chain, insert: async (row: Sent) => { inserts.push(row); return { error: null }; } }) } as never;
}

const msgs = [{ role: 'user' as const, content: 'hi' }];
const gpt5 = () => getEndpointClient({ provider: 'openai', model: 'gpt-5-mini' });
const claude = () => getEndpointClient({ provider: 'anthropic', model: 'claude-sonnet-5', baseURL: 'https://api.anthropic.com/v1' });

describe('the param floor is unchanged when nothing states an effort', () => {
  it('gpt-5: minimal reasoning, max_completion_tokens, sampling stripped, no marker', async () => {
    await aiCreate(gpt5(), { model: 'gpt-5-mini', max_tokens: 350, temperature: 0, messages: msgs });
    const p = sent[0];
    expect(p.reasoning_effort).toBe('minimal');
    expect(p.max_completion_tokens).toBe(350);
    expect(p.max_tokens).toBeUndefined();
    expect(p.temperature).toBeUndefined();
    expect(EFFORT_KEY in p).toBe(false);
  });
  it("Claude 5: 'none' hint, budget untouched", async () => {
    await aiCreate(claude(), { model: 'claude-sonnet-5', max_tokens: 480, temperature: 0, messages: msgs });
    expect(sent[0].reasoning_effort).toBe('none');
    expect(sent[0].max_tokens).toBe(480);
    expect(sent[0].thinking).toBeUndefined();
  });
  it('a slot with no effort resolves to the cached client itself (no view, no effort)', async () => {
    expect(SLOT_EFFORT).toEqual({});
    const r = await getAIClient('u-1', 'classification', fakeSupabase());
    expect(r.effort).toBeUndefined();
    expect(boundEffortOf(r.client)).toBeUndefined();
    expect(unboundClient(r.client)).toBe(r.client);
  });
  it('aiCall without an effort: one call, the caller budget, no retry on empty (as before)', async () => {
    reply = () => '';
    const r = await aiCall({ userId: null, shape: { output: 'json' }, prompt: 'x', maxTokens: 350 });
    expect(r.json).toBeNull();
    expect(sent.length).toBe(1);
    expect(sent[0].reasoning_effort).toBe('minimal');
    expect(sent[0].max_completion_tokens).toBe(350);
  });
});

describe('the eval override is ignored in production', () => {
  const env = (o: Record<string, string>) => ({ AI_EFFORT_OVERRIDE: 'classification=low', AUGMTD_EVAL: '1', NODE_ENV: 'development', ...o });
  it('pure resolution', () => {
    expect(effortOverride('classification', env({}))).toBe('low');
    expect(effortOverride('classification', env({ NODE_ENV: 'production' }))).toBeUndefined();
    expect(effortOverride('classification', env({ VERCEL_ENV: 'production' }))).toBeUndefined();
    expect(effortOverride('classification', env({ AUGMTD_EVAL: '' }))).toBeUndefined();
    expect(effortOverride('summarization', env({}))).toBeUndefined();
    expect(slotEffort('classification', env({ NODE_ENV: 'production' }))).toBeUndefined();
    expect(effortOverrideArmed({ NODE_ENV: 'test', AUGMTD_EVAL: '1' })).toBe(true);
  });
  it('parses slot=effort and names what it refuses', () => {
    expect(parseEffortOverride('classification=low, summarization=high').map).toEqual({ classification: 'low', summarization: 'high' });
    expect(parseEffortOverride('classification=extreme,foo=low,embeddings=low').problems.length).toBe(3);
  });
  it('through the factory: NODE_ENV=production sends the floor even with the override set', async () => {
    process.env.AI_EFFORT_OVERRIDE = 'classification=low';
    process.env.AUGMTD_EVAL = '1';
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const r = await getAIClient('u-1', 'classification', fakeSupabase());
    expect(r.effort).toBeUndefined();
    await aiCreate(r.client, { model: r.model, max_tokens: 350, messages: msgs });
    expect(sent[0].reasoning_effort).toBe('minimal');
    expect(sent[0].max_completion_tokens).toBe(350);
  });
  it('outside production with the eval flag: the slot view applies it, to direct create() callers too', async () => {
    process.env.AI_EFFORT_OVERRIDE = 'classification=low';
    process.env.AUGMTD_EVAL = '1';
    const r = await getAIClient('u-1', 'classification', fakeSupabase());
    expect(r.effort).toBe('low');
    await r.client.chat.completions.create({ model: r.model, max_tokens: 350, messages: msgs });
    expect(sent[0].reasoning_effort).toBe('low');
    expect(sent[0].max_completion_tokens).toBe(350 + EFFORT_HEADROOM.low);
    // A caller that states its own effort keeps it; the unbound transport never applies the slot's.
    await r.client.chat.completions.create({ model: r.model, max_tokens: 350, reasoning_effort: 'minimal', messages: msgs });
    expect(sent[1].reasoning_effort).toBe('minimal');
    expect(sent[1].max_completion_tokens).toBe(350);
    await aiCreate(unboundClient(r.client), { model: r.model, max_tokens: 350, messages: msgs });
    expect(sent[2].reasoning_effort).toBe('minimal');
    // Other slots stay on the floor.
    const s = await getAIClient('u-1', 'summarization', fakeSupabase());
    expect(s.effort).toBeUndefined();
  });
});

describe('headroom: an effort above minimal never starves the answer', () => {
  it('gpt-5 per call: effort + headroom on the caller budget', async () => {
    await aiCreate(gpt5(), { model: 'gpt-5-mini', max_tokens: 200, messages: msgs }, { effort: 'medium' });
    expect(sent[0].reasoning_effort).toBe('medium');
    expect(sent[0].max_completion_tokens).toBe(200 + EFFORT_HEADROOM.medium);
  });
  it("Claude 5: effort hint + headroom; 'minimal' maps to the floor's 'none'", () => {
    const hi = applyEffort({ model: 'claude-sonnet-5', max_tokens: 480 }, 'high');
    expect(hi.params).toMatchObject({ reasoning_effort: 'high', max_tokens: 480 + EFFORT_HEADROOM.high });
    expect(applyEffort({ model: 'claude-sonnet-5', max_tokens: 480 }, 'minimal').params).toMatchObject({ reasoning_effort: 'none', max_tokens: 480 });
  });
  it('Haiku 4.5 (Bedrock EU + compat): the older thinking API — budget, max_tokens past it, sampling dropped', () => {
    const r = applyEffort({ model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 350, temperature: 0.2 }, 'low');
    expect(r.applied).toBe('low');
    expect(r.params).toMatchObject({ thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET.low }, max_tokens: 350 + THINKING_BUDGET.low });
    expect((r.params as Sent).temperature).toBeUndefined();
    expect(thinkingOf(r.params)).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(effortFamily('claude-haiku-4-5-20251001')).toBe('claude-thinking');
    // minimal → thinking stays off; a forced tool → not applied (thinking forbids it), and says so.
    expect((applyEffort({ model: 'claude-haiku-4-5-20251001', max_tokens: 100 }, 'minimal').params as Sent).thinking).toBeUndefined();
    const forced = applyEffort({ model: 'claude-haiku-4-5-20251001', tool_choice: { type: 'function', function: { name: 'f' } } }, 'low');
    expect(forced.applied).toBeNull();
    expect((forced.params as Sent).thinking).toBeUndefined();
  });
  it('a model with nothing to steer is untouched (stamped not-applicable); the caller params are never mutated', () => {
    const src = { model: 'gpt-4o-mini', max_tokens: 100, temperature: 0 };
    const r = applyEffort(src, 'high');
    expect(r.applied).toBeNull();
    expect(r.params).toMatchObject(src);
    expect(effortOf(r.params)).toBeNull();
    expect(EFFORT_KEY in src).toBe(false);
    expect(JSON.stringify(r.params)).toBe(JSON.stringify(src)); // the marker never reaches a request body
  });
  it('aiCall at effort low arms the empty-content retry: bigger budget, then the floor', async () => {
    let n = 0;
    reply = () => (++n < 3 ? '' : '{"verdict":"reply"}');
    const r = await aiCall<{ verdict: string }>({ userId: null, shape: { output: 'json', effort: 'low' }, prompt: 'x', maxTokens: 350 });
    expect(r.json).toEqual({ verdict: 'reply' });
    expect(sent.map((p) => [p.reasoning_effort, p.max_completion_tokens])).toEqual([
      ['low', 350 + EFFORT_HEADROOM.low], ['low', 700 + EFFORT_HEADROOM.low], ['minimal', 350],
    ]);
  });
});

describe('the effort actually used is recorded', () => {
  it('aiCreate stamps usage; logAIUsage writes <task>@<effort> above the floor only', async () => {
    const res = await aiCreate(gpt5(), { model: 'gpt-5-mini', max_tokens: 50, messages: msgs }, { effort: 'low' });
    expect(effortOf(res.usage)).toBe('low');
    expect(Object.keys(res.usage ?? {})).not.toContain(String(EFFORT_KEY)); // non-enumerable
    const rows: Sent[] = [];
    await logAIUsage(fakeSupabase(rows), { userId: 'u-1', source: 'email_processing', provider: 'openai', model: 'gpt-5-mini', taskType: 'classification', usage: res.usage });
    const floor = await aiCreate(gpt5(), { model: 'gpt-5-mini', max_tokens: 50, messages: msgs });
    await logAIUsage(fakeSupabase(rows), { userId: 'u-1', source: 'email_processing', provider: 'openai', model: 'gpt-5-mini', taskType: 'classification', usage: floor.usage });
    expect(rows.map((r) => r.task_type)).toEqual(['classification@low', 'classification']);
    expect(taskTypeWithEffort('summarization', 'minimal')).toBe('summarization');
    expect(taskTypeWithEffort(null, 'high')).toBeNull();
  });
});

describe('W28 · THE PRODUCER EFFORT — a producer names itself, the config decides per family', () => {
  const armed = (o: Record<string, string>) => ({ AUGMTD_EVAL: '1', NODE_ENV: 'development', ...o });
  it('the config: the four measured producers are low on gpt-5, nothing on Haiku 4.5 or elsewhere', () => {
    for (const k of ['inbox.understanding', 'work.judge', 'commitments.fulfillment', 'room.brief'] as const) {
      expect(producerEffort(k, 'gpt-5-mini', {})).toBe('low');
      expect(producerEffort(k, 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', {})).toBeUndefined();
      expect(producerEffort(k, 'gpt-4o-mini', {})).toBeUndefined();
    }
    expect(producerEffort('commitments.extract', 'gpt-5-mini', {})).toBeUndefined();
    expect(producerEffort(null, 'gpt-5-mini', {})).toBeUndefined();
    expect(Object.keys(PRODUCER_EFFORT).every((k) => (EFFORT_PRODUCERS as readonly string[]).includes(k))).toBe(true);
  });
  it('the eval override A/Bs a producer by its key — never in production', () => {
    expect(producerEffort('work.judge', 'gpt-5-mini', armed({ AI_EFFORT_OVERRIDE: 'work.judge=minimal' }))).toBe('minimal');
    expect(producerEffort('commitments.extract', 'gpt-5-mini', armed({ AI_EFFORT_OVERRIDE: 'commitments.extract=low' }))).toBe('low');
    expect(producerEffortOverride('work.judge', armed({ AI_EFFORT_OVERRIDE: 'work.judge=minimal', NODE_ENV: 'production' }))).toBeUndefined();
    expect(parseEffortOverride('work.judge=low,classification=medium')).toEqual({ map: { classification: 'medium' }, producers: { 'work.judge': 'low' }, problems: [] });
    expect(parseEffortOverride('work.judgement=low').problems.length).toBe(1);
  });
  it('aiCreate with a producer sends its effort (with headroom) on gpt-5 and the floor elsewhere', async () => {
    await aiCreate(gpt5(), { model: 'gpt-5-mini', max_tokens: 350, temperature: 0, messages: msgs }, { producer: 'commitments.fulfillment' });
    expect(sent[0].reasoning_effort).toBe('low');
    expect(sent[0].max_completion_tokens).toBe(350 + EFFORT_HEADROOM.low);
    expect(effortOf(sent[0])).toBe('low');
    sent.length = 0;
    await aiCreate(gpt5(), { model: 'gpt-5-mini', max_tokens: 350, temperature: 0, messages: msgs }, { producer: 'commitments.extract' });
    expect(sent[0].reasoning_effort).toBe('minimal');
    expect(sent[0].max_completion_tokens).toBe(350);
  });
  it('an explicit per-call effort still wins over the producer', async () => {
    await aiCreate(gpt5(), { model: 'gpt-5-mini', max_tokens: 350, temperature: 0, messages: msgs }, { producer: 'work.judge', effort: 'medium' });
    expect(sent[0].reasoning_effort).toBe('medium');
  });
  it('aiCall with effortProducer resolves on the routed model', async () => {
    const r = await aiCall({ userId: null, shape: { output: 'json', effortProducer: 'room.brief' }, prompt: 'x', maxTokens: 350 });
    expect(r.json).toEqual({ ok: true });
    const want = producerEffort('room.brief', r.model, {});
    expect(sent[0].reasoning_effort).toBe(want ?? 'minimal');
  });
});

// W30 — gpt-6 is first-class (live Sep 30, gpt-6-luna): `max_completion_tokens` only; reasoning_effort
// none|low|medium|high|xhigh ('minimal' is a 400); sampling accepted ONLY at 'none'.
describe('W30 · the gpt-6 family in the param floor and the effort lever', () => {
  const luna = () => getEndpointClient({ provider: 'openai', model: 'gpt-6-luna' });
  it('family + value mapping: gpt-6 is openai-reasoning, minimal → none, the rest pass through', () => {
    for (const m of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-5-mini', 'gpt-5.6-terra']) expect(effortFamily(m)).toBe('openai-reasoning');
    expect(effortFamily('gpt-60')).toBe('none');
    expect(openaiReasoningFloor('gpt-6-luna')).toBe('none');
    expect(openaiReasoningFloor('gpt-5-mini')).toBe('minimal');
    expect(openaiReasoningValue('gpt-6-luna', 'minimal')).toBe('none');
    expect(openaiReasoningValue('gpt-6-luna', 'low')).toBe('low');
    expect(openaiReasoningValue('gpt-5-mini', 'minimal')).toBe('minimal');
  });
  it("the floor: max_tokens → max_completion_tokens, 'none' by default, sampling KEPT at 'none'", async () => {
    await aiCreate(luna(), { model: 'gpt-6-luna', max_tokens: 350, temperature: 0, messages: msgs });
    const p = sent[0];
    expect(p.max_completion_tokens).toBe(350);
    expect(p.max_tokens).toBeUndefined();
    expect(p.reasoning_effort).toBe('none');
    expect(p.temperature).toBe(0);
    expect(EFFORT_KEY in p).toBe(false);
  });
  it("reject-safe: a caller's own 'minimal' is sent as 'none'; sampling dropped above 'none'", async () => {
    await luna().chat.completions.create({ model: 'gpt-6-luna', max_tokens: 100, reasoning_effort: 'minimal' as never, temperature: 0.2, messages: msgs });
    expect(sent[0]).toMatchObject({ reasoning_effort: 'none', max_completion_tokens: 100, temperature: 0.2 });
    await luna().chat.completions.create({ model: 'gpt-6-luna', max_tokens: 100, reasoning_effort: 'low', temperature: 0.2, top_p: 0.9, messages: msgs });
    expect(sent[1].reasoning_effort).toBe('low');
    expect(sent[1].temperature).toBeUndefined();
    expect(sent[1].top_p).toBeUndefined();
    expect(sent[1].max_tokens).toBeUndefined();
  });
  it('the effort lever: low keeps low (+ headroom, sampling dropped); minimal lands as none', async () => {
    await aiCreate(luna(), { model: 'gpt-6-luna', max_tokens: 200, temperature: 0, messages: msgs }, { effort: 'low' });
    expect(sent[0]).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 200 + EFFORT_HEADROOM.low });
    expect(sent[0].temperature).toBeUndefined();
    const r = applyEffort({ model: 'gpt-6-luna', max_tokens: 200 }, 'minimal');
    expect(r.applied).toBe('minimal');
    expect(r.params).toMatchObject({ reasoning_effort: 'none', max_tokens: 200 });
  });
  it('the measured producers keep their low on gpt-6 (same family)', async () => {
    expect(producerEffort('work.judge', 'gpt-6-luna', {})).toBe('low');
    await aiCreate(luna(), { model: 'gpt-6-luna', max_tokens: 350, temperature: 0, messages: msgs }, { producer: 'inbox.understanding' });
    expect(sent[0]).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 350 + EFFORT_HEADROOM.low });
  });
  it("aiCall's empty-content retry (run at 'minimal') lands on gpt-6 as 'none', never a 400", () => {
    expect((applyEffort({ model: 'gpt-6-luna', max_tokens: 350 }, 'minimal').params as Sent).reasoning_effort).toBe('none');
  });
  it('gpt-5 is unchanged: minimal floor, sampling always dropped', async () => {
    await gpt5().chat.completions.create({ model: 'gpt-5-mini', max_tokens: 100, reasoning_effort: 'none' as never, temperature: 0, messages: msgs });
    expect(sent[0].temperature).toBeUndefined();
    expect(sent[0].reasoning_effort).toBe('none');
  });
  it('the three W30 candidates are priced (no fallback rate)', () => {
    for (const m of ['gpt-6-luna', 'claude-sonnet-5-5', 'eu.anthropic.claude-sonnet-4-6']) expect(MODEL_PRICING[m]).toBeDefined();
  });
  it('the Claude candidates already sit in the right families', () => {
    expect(effortFamily('claude-sonnet-5-5')).toBe('claude-effort');
    expect(effortFamily('eu.anthropic.claude-sonnet-4-6')).toBe('claude-thinking');
  });
});
