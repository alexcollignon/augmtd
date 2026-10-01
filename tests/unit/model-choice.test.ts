// W36 — THE PRODUCER MODEL, zero AI. The one resolver (lib/ai/model-choice.ts) and its seats:
//   · PRODUCER_MODEL holds only the owner-approved measured entries (W36) and a slot resolution is byte-identical;
//   · the precedence: tenant producer > tier producer > tenant slot > tier slot;
//   · THE PERIMETER: an EU tier never resolves outside EU-resident Bedrock at ANY level;
//   · the factory, aiCall and the effort follow the RESOLVED model (transport faked at the SDK prototype).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { TIER_DEFAULTS, PRODUCER_MODEL } from '../../lib/ai/defaults';
import { resolveModelChoice, modelOverrideProblems, producerOverrideKey, withinTierPerimeter, MODEL_PRECEDENCE, EU_PERIMETER_TIERS } from '../../lib/ai/model-choice';
import { EFFORT_PRODUCERS } from '../../lib/ai/effort';
import { getAIClient, invalidateTenantConfig } from '../../lib/ai/factory';
import { aiCall } from '../../lib/ai/call';
import type { TaskType, TierType } from '../../lib/ai/types';

const TIERS = Object.keys(TIER_DEFAULTS) as TierType[];
const SLOTS = Object.keys(TIER_DEFAULTS.standard) as TaskType[];
const OSS = 'openai.gpt-oss-120b-1:0';
const HAIKU_EU = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

describe('no production change', () => {
  it('PRODUCER_MODEL carries exactly the owner-approved, measured entries (W36) — every EU entry inside the perimeter', () => {
    const adopted = Object.fromEntries(TIERS.map((t) => [t, Object.keys(PRODUCER_MODEL[t] ?? {}).sort()]));
    expect(adopted).toEqual({
      standard: ['commitments.extract', 'commitments.fulfillment'], professional: [], bedrock_private: [],
      bedrock_optimised: ['work.judge'], private_client: [], on_prem: [],
    });
    for (const t of EU_PERIMETER_TIERS) for (const e of Object.values(PRODUCER_MODEL[t] ?? {})) {
      expect(withinTierPerimeter(t, { ...TIER_DEFAULTS[t].classification, ...e }), t).toBe(true);
    }
  });
  it('without a producer (or with one and an empty producer table) every tier × slot resolves exactly as the old merge', () => {
    for (const t of TIERS) for (const s of SLOTS) {
      const old = { ...TIER_DEFAULTS[t][s] };
      expect(resolveModelChoice({ tier: t, task: s }).endpoint).toEqual(old);
      for (const p of EFFORT_PRODUCERS) {
        const r = resolveModelChoice({ tier: t, task: s, producer: p, producerTable: {} });
        expect(r.endpoint).toEqual(old);
        expect(r.source).toBe('tier-slot');
      }
    }
  });
  it('a slot override merges over the tier slot as before', () => {
    const r = resolveModelChoice({ tier: 'standard', task: 'classification', overrides: { classification: { model: 'gpt-6-luna' } } });
    expect(r.endpoint).toEqual({ provider: 'openai', model: 'gpt-6-luna' });
    expect(r.source).toBe('tenant-slot');
  });
});

describe('the precedence: tenant producer > tier producer > tenant slot > tier slot', () => {
  const table = { standard: { 'work.judge': { model: 'tier-producer-model' } } };
  it('is stated in order', () => expect(MODEL_PRECEDENCE).toEqual(['tenant-producer', 'tier-producer', 'tenant-slot', 'tier-slot']));
  it('each level wins over the ones beneath it', () => {
    const all = { classification: { model: 'tenant-slot-model' }, [producerOverrideKey('work.judge')]: { model: 'tenant-producer-model' } };
    expect(resolveModelChoice({ tier: 'standard', task: 'classification', producer: 'work.judge', overrides: all, producerTable: table }))
      .toMatchObject({ source: 'tenant-producer', endpoint: { provider: 'openai', model: 'tenant-producer-model' } });
    expect(resolveModelChoice({ tier: 'standard', task: 'classification', producer: 'work.judge', overrides: { classification: { model: 'tenant-slot-model' } }, producerTable: table }))
      .toMatchObject({ source: 'tier-producer', endpoint: { model: 'tier-producer-model' } });
    expect(resolveModelChoice({ tier: 'standard', task: 'classification', producer: 'work.judge', overrides: { classification: { model: 'tenant-slot-model' } } }))
      .toMatchObject({ source: 'tenant-slot', endpoint: { model: 'tenant-slot-model' } });
  });
  it('a producer override touches only its producer, never the slot or another producer', () => {
    const o = { [producerOverrideKey('work.judge')]: { model: 'gpt-6-luna' } };
    expect(resolveModelChoice({ tier: 'standard', task: 'classification', overrides: o }).endpoint.model).toBe('gpt-5-mini');
    expect(resolveModelChoice({ tier: 'standard', task: 'classification', producer: 'inbox.understanding', overrides: o }).endpoint.model).toBe('gpt-5-mini');
    expect(resolveModelChoice({ tier: 'standard', task: 'classification', producer: 'work.judge', overrides: o }).endpoint.model).toBe('gpt-6-luna');
  });
  it('a { model } entry keeps the slot provider + budget; another provider starts fresh (no foreign baseURL)', () => {
    const same = resolveModelChoice({ tier: 'bedrock_optimised', task: 'classification', producer: 'work.judge', overrides: { [producerOverrideKey('work.judge')]: { model: OSS } } });
    expect(same.endpoint).toEqual({ provider: 'bedrock', model: OSS, maxTokensDefault: 4096 });
    const other = resolveModelChoice({ tier: 'standard', task: 'generation', producer: 'room.brief', overrides: { [producerOverrideKey('room.brief')]: { provider: 'openai', model: 'gpt-6-luna' } } });
    expect(other.endpoint).toEqual({ provider: 'openai', model: 'gpt-6-luna' });
  });
  it('embeddings are never producer-routed; an unknown producer is the slot', () => {
    expect(resolveModelChoice({ tier: 'standard', task: 'embeddings', producer: 'work.judge', overrides: { [producerOverrideKey('work.judge')]: { model: 'x' } } }).endpoint.model).toBe('cohere.embed-multilingual-v3');
    expect(resolveModelChoice({ tier: 'standard', task: 'classification', producer: 'not.a.producer', overrides: { 'producer:not.a.producer': { model: 'x' } } }).endpoint.model).toBe('gpt-5-mini');
  });
});

describe('THE PERIMETER — an EU tier never resolves outside EU-resident Bedrock', () => {
  it('the EU tiers are the bedrock tiers', () => expect([...EU_PERIMETER_TIERS].sort()).toEqual(['bedrock_optimised', 'bedrock_private']));
  it('an in-region gpt-oss producer override is served', () => {
    for (const t of EU_PERIMETER_TIERS) {
      const r = resolveModelChoice({ tier: t, task: 'classification', producer: 'work.judge', overrides: { [producerOverrideKey('work.judge')]: { model: OSS } } });
      expect(r).toMatchObject({ source: 'tenant-producer', endpoint: { provider: 'bedrock', model: OSS }, refused: [] });
    }
  });
  it('a producer override to a non-Bedrock provider or a non-EU profile is REFUSED, the next level serves', () => {
    for (const bad of [{ provider: 'openai' as const, model: 'gpt-6-luna' }, { model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' }, { model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0' }]) {
      const r = resolveModelChoice({ tier: 'bedrock_optimised', task: 'classification', producer: 'work.judge', producerTable: {}, overrides: { [producerOverrideKey('work.judge')]: bad } });
      expect(r.endpoint.model, JSON.stringify(bad)).toBe(HAIKU_EU);
      expect(r.source).toBe('tier-slot');
      expect(r.refused[0]).toMatchObject({ source: 'tenant-producer' });
    }
  });
  it('a refused tenant producer falls to a PERMITTED slot override, and a non-EU slot override is refused too', () => {
    const r = resolveModelChoice({ tier: 'bedrock_optimised', task: 'classification', producer: 'work.judge', producerTable: {},
      overrides: { classification: { model: OSS }, [producerOverrideKey('work.judge')]: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } } });
    expect(r).toMatchObject({ source: 'tenant-slot', endpoint: { model: OSS } });
    const s = resolveModelChoice({ tier: 'bedrock_private', task: 'summarization', overrides: { summarization: { provider: 'openai', model: 'gpt-5-mini' } } });
    expect(s).toMatchObject({ source: 'tier-slot', endpoint: { provider: 'bedrock', model: HAIKU_EU } });
    expect(s.refused.map((x) => x.source)).toEqual(['tenant-slot']);
  });
  it('a tier producer default is held to the same perimeter', () => {
    const r = resolveModelChoice({ tier: 'bedrock_optimised', task: 'classification', producer: 'room.brief', producerTable: { bedrock_optimised: { 'room.brief': { provider: 'openai', model: 'gpt-6-luna' } } } });
    expect(r).toMatchObject({ source: 'tier-slot', endpoint: { model: HAIKU_EU } });
  });
  it('every resolution on an EU tier, over every producer and slot, lands inside the perimeter', () => {
    const hostile = Object.fromEntries([...SLOTS.map((s) => [s, { provider: 'openai', model: 'gpt-5-mini' }]), ...EFFORT_PRODUCERS.map((p) => [producerOverrideKey(p), { model: 'us.openai.gpt-oss-120b-1:0' }])]);
    for (const t of EU_PERIMETER_TIERS) for (const s of SLOTS) for (const p of [undefined, ...EFFORT_PRODUCERS]) {
      expect(withinTierPerimeter(t, resolveModelChoice({ tier: t, task: s, producer: p, overrides: hostile }).endpoint), `${t}/${s}/${p}`).toBe(true);
    }
  });
  it('the standard tier is not an EU perimeter (a Luna override is served)', () => {
    expect(withinTierPerimeter('standard', { provider: 'openai', model: 'gpt-6-luna' })).toBe(true);
  });
});

describe('model_overrides problems are said, never silently used', () => {
  it('reports unknown keys and bad entries; accepts slots and known producers', () => {
    expect(modelOverrideProblems({ classification: { model: 'a' }, 'producer:work.judge': { model: 'b' } })).toEqual([]);
    const p = modelOverrideProblems({ 'producer:work.judgee': { model: 'b' }, clasification: { model: 'c' }, 'producer:room.brief': 'x', summarization: { model: '' } });
    expect(p).toHaveLength(4);
  });
});

// ── the seats: factory + aiCall + effort follow the RESOLVED model ─────────────────────────────
type Sent = Record<string | symbol, unknown>;
const sent: Sent[] = [];
beforeAll(() => {
  process.env.OPENAI_API_KEY ||= 'test-key';
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
  const proto = (OpenAI as unknown as { Chat: { Completions: { prototype: { create: unknown } } } }).Chat.Completions.prototype;
  proto.create = async function fake(params: Sent) {
    sent.push(params);
    return { id: 'x', object: 'chat.completion', created: 0, model: params.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  };
});
let n = 0;
let user = 'u-mc-0';
beforeEach(() => { sent.length = 0; user = `u-mc-${++n}`; invalidateTenantConfig(user); });

function tenant(tier: TierType, model_overrides: Record<string, unknown>) {
  const row = { tier, model_overrides, endpoints: {}, encrypted_api_keys: {}, audit_logging: false, model_version_pinning: false };
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'limit']) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: table === 'tenant_configs' ? row : null, error: null });
      chain.insert = async () => ({ error: null });
      return chain;
    },
  } as never;
}

describe('the seats', () => {
  it('getAIClient resolves a producer override only when the producer is named', async () => {
    const sb = tenant('standard', { [producerOverrideKey('inbox.understanding')]: { model: 'gpt-6-luna' } });
    expect((await getAIClient(user, 'classification', sb)).model).toBe('gpt-5-mini');
    const r = await getAIClient(user, 'classification', sb, { producer: 'inbox.understanding' });
    expect(r).toMatchObject({ model: 'gpt-6-luna', producer: 'inbox.understanding', modelSource: 'tenant-producer' });
  });
  it('aiCall routes a named producer to its model, and its effort follows the RESOLVED family', async () => {
    // work.judge's PRODUCER_EFFORT is 'low' for the openai-reasoning family: Luna is in it (low applies);
    // Haiku 4.5 on the compat endpoint is claude-thinking (no entry → the floor: no thinking block).
    const luna = tenant('standard', { [producerOverrideKey('work.judge')]: { model: 'gpt-6-luna' } });
    await aiCall({ userId: user, supabase: luna, shape: { output: 'json', effortProducer: 'work.judge' }, prompt: 'x', maxTokens: 450 });
    expect(sent[0]).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'low' });
    sent.length = 0; user = `u-mc-${++n}`;
    const haiku = tenant('standard', { [producerOverrideKey('work.judge')]: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', baseURL: 'https://api.anthropic.com/v1' } });
    await aiCall({ userId: user, supabase: haiku, shape: { output: 'json', effortProducer: 'work.judge' }, prompt: 'x', maxTokens: 450 });
    expect(sent[0].model).toBe('claude-haiku-4-5-20251001');
    expect(sent[0].thinking).toBeUndefined();
    expect(sent[0].reasoning_effort).toBeUndefined();
  });
  it('an unnamed aiCall on the same tenant keeps the slot model', async () => {
    const sb = tenant('standard', { [producerOverrideKey('work.judge')]: { model: 'gpt-6-luna' } });
    await aiCall({ userId: user, supabase: sb, shape: { output: 'json' }, prompt: 'x' });
    expect(sent[0].model).toBe('gpt-5-mini');
  });
  it('an EU tenant pointed out of the perimeter resolves inside it', async () => {
    const sb = tenant('bedrock_optimised', { [producerOverrideKey('commitments.extract')]: { provider: 'openai', model: 'gpt-6-luna' } });
    const r = await getAIClient(user, 'summarization', sb, { producer: 'commitments.extract' });
    expect(r.endpoint.provider).toBe('bedrock');
    expect(r.model).toBe(HAIKU_EU);
  });
});
