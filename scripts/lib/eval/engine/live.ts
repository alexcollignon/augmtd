// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE LIVE WIRING. Builds the runner's ports from the real product: the transport meter
// (scripts/lib/eval/meter.ts), the probe hosts (+ the probe write fence), the plain columns through
// lib/ai/factory.ts (getAIClient for `same`, getEndpointClient for Sonnet 5.5 / GPT-5.6-terra — never
// a hand-built SDK client) with the reasoning effort STATED per column (the param floor would
// otherwise inject 'minimal'/'none' silently), and the blind Opus judge.
// STUB MODE (the self-check): the same wiring with the model transport canned and an EGRESS FENCE
// (no host but Supabase; Bedrock SDK sends answered locally) — zero AI, zero spend, by construction.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { installMeter, metered, meterAdapterClient, orphanCalls, type MeterBucket, type MeterCall, type StubFn } from '../meter';
import { priceCalls, assertPriced } from './pricing';
import { seedWorld, teardownWorld, installProbeWriteFence, type SeededWorld } from './world';
import { RETRY_NUDGE } from './judge';
import type { AnyAdapter, ColumnId, RunCtx, Slot, Tier } from './types';
import type { JudgePort, MeterPort, PlainSystem, TierEnv, ChatMsg } from './runner';

export const JUDGE_MODEL = 'claude-opus-5-5';
export const SONNET55 = 'claude-sonnet-5-5';
export const GPT56 = 'gpt-5.6-terra';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1';

/** The effort the factory's param floor injects when a caller states none (lib/ai/factory.ts
 *  withModelParamFloor) — the producers' effective effort, stated explicitly for `same`. */
export function floorEffort(model: string): string | null {
  if (model.startsWith('gpt-5')) return 'minimal';
  if (/^claude-(sonnet-5|opus-5|opus-4-[78]|fable-5)/.test(model)) return 'none';
  return null;
}

export type ColumnEfforts = { sonnet55: string | null; gpt56: string | null };
/** Consumer defaults (owner rule: "consumer default for the plain columns"): OpenAI's default for the
 *  gpt-5 family is medium; for Sonnet 5.5 through the compat endpoint `medium` is stated explicitly
 *  (the floor would otherwise send 'none'). Override per run with --effort sonnet55=high,gpt56=low. */
export const DEFAULT_EFFORTS: ColumnEfforts = { sonnet55: 'medium', gpt56: 'medium' };

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── the meter port (+ late/orphan accounting) ──────────────────────────────────────────────────

const buckets: Array<{ bucket: MeterBucket; counted: number }> = [];
export const meterPort: MeterPort = {
  async run<T>(fn: () => Promise<T>) {
    const { result, bucket } = await metered(fn);
    buckets.push({ bucket, counted: bucket.calls.length });
    return { result, calls: bucket.calls.slice() };
  },
};
/** Calls that landed after their run returned (background work) + calls outside any run. */
export function lateSpend(): { calls: number; eur: number; orphans: number; orphanEur: number } {
  const late: MeterCall[] = [];
  for (const b of buckets) if (b.bucket.calls.length > b.counted) late.push(...b.bucket.calls.slice(b.counted));
  const o = orphanCalls();
  return { calls: late.length, eur: priceCalls(late).costEur, orphans: o.length, orphanEur: priceCalls(o).costEur };
}

// ── stub transport + egress fence (self-check) ──────────────────────────────────────────────────

/** Plain-column answers the self-check registers per prompt (the scorer's "good stub"). */
export const stubAnswers = new Map<string, string>();

export const engineStub: StubFn = (params) => {
  const msgs = (params.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const user = [...msgs].reverse().find((m) => m.role === 'user');
  const u = typeof user?.content === 'string' ? user.content : '';
  const model = String(params.model ?? '');
  // The "wrong" plain column: GPT answers garbage, so the self-check proves the scorer discriminates.
  const hit = stubAnswers.get(u);
  if (hit != null) return { content: model === GPT56 ? 'I am not sure.' : hit };
  const all = msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))).join('\n');
  if (/strict evaluator/i.test(all)) {
    // A stub judge that exercises the real prompt → parser path: every dimension the template names gets a 4.
    const tpl = /"scores":\{([^}]*)\}/.exec(all)?.[1] ?? '';
    const dims = [...tpl.matchAll(/"([a-z_]+)"\s*:/g)].map((m) => m[1]);
    return { content: JSON.stringify({ scores: Object.fromEntries(dims.map((d) => [d, 4])), failures: [], notes: 'stub judge' }) };
  }
  if (/\bJSON\b/.test(all) || (params.response_format as { type?: string } | undefined)?.type === 'json_object') return { content: '{}' };
  return { content: 'Stub answer from the transport.' };
};

let egressInstalled = false;
/** STUB MODE ONLY: refuse every non-Supabase host (OpenAI, Anthropic, Tavily, …) and answer the AWS
 *  Bedrock SDK locally (embeddings get a well-formed zero vector; anything else throws). */
export async function installEgressFence(supabaseUrl: string): Promise<void> {
  if (egressInstalled) return;
  egressInstalled = true;
  const host = new URL(supabaseUrl).host;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let h = '';
    try { h = new URL(url).host; } catch { /* relative */ }
    if (h && h !== host) throw new Error(`eval self-check egress fence: refused ${h} (zero-AI run)`);
    return orig(input, init);
  }) as typeof fetch;
  const mod = await import('@aws-sdk/client-bedrock-runtime');
  const proto = (mod.BedrockRuntimeClient as unknown as { prototype: { send: (cmd: unknown) => Promise<unknown> } }).prototype;
  proto.send = async function stubSend(cmd: unknown) {
    const input = (cmd as { input?: { modelId?: string; body?: unknown } }).input ?? {};
    if (/embed/i.test(String(input.modelId ?? ''))) {
      let n = 1;
      try { n = (JSON.parse(String(input.body ?? '{}')) as { texts?: unknown[] }).texts?.length ?? 1; } catch { /* one */ }
      const body = new TextEncoder().encode(JSON.stringify({ embeddings: Array.from({ length: n }, () => new Array(1024).fill(0.001)) }));
      return { body };
    }
    throw new Error('eval self-check egress fence: Bedrock SDK call refused (zero-AI run)');
  };
}

// ── probes + session ────────────────────────────────────────────────────────────────────────────

/** The probe's RLS session (magic-link token minted by the admin API, no email sent). */
export async function probeSession(admin: SupabaseClient, email: string): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return null;
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return null;
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (e2 || !v?.session?.access_token) return null;
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${v.session.access_token}` } } });
}

const probeIds: string[] = [];
export function armProbeFence(supabaseUrl: string, ids: string[], onBlock: (r: string) => void): void {
  for (const i of ids) if (!probeIds.includes(i)) probeIds.push(i);
  installProbeWriteFence(supabaseUrl, () => probeIds, onBlock);
}

// ── the tier env ────────────────────────────────────────────────────────────────────────────────

const SLOTS: Slot[] = ['classification', 'conversation', 'generation', 'summarization', 'planning'];

/** The model every factory slot resolves to for a user (the pool fairness check: identical per tier). */
export async function slotModels(admin: SupabaseClient, userId: string): Promise<Record<string, string>> {
  const { getAIClient } = await import('../../../../lib/ai/factory');
  const out: Record<string, string> = {};
  for (const s of SLOTS) {
    // Resolution only (no call is made; buildTierEnv meters the clients the run uses).
    const r = await getAIClient(userId, s, admin);
    out[s] = `${r.tier}/${r.model}`;
  }
  return out;
}

export async function buildTierEnv(o: {
  tier: Tier; admin: SupabaseClient; userId: string; session: SupabaseClient | null; now: Date; stubbed: boolean; efforts: ColumnEfforts;
}): Promise<TierEnv> {
  const { getAIClient, getEndpointClient, aiCreate, unboundClient } = await import('../../../../lib/ai/factory');
  const { primeUserTimezone, forgetUserTimezone } = await import('../../../../lib/utils/user-time');
  // Every Bedrock endpoint's adapter instance is metered (and, in stub mode, canned) up front.
  for (const s of SLOTS) {
    const r = await getAIClient(o.userId, s, o.admin);
    meterAdapterClient(r.client);
  }
  const plainCall = (client: import('openai').default, model: string, effort: string | null, maxTokens: number) =>
    async (messages: ChatMsg[]): Promise<string> => {
      const res = await aiCreate(client, {
        model, max_tokens: maxTokens, messages,
        ...(effort ? { reasoning_effort: effort as 'minimal' } : {}),
      });
      return String(res.choices?.[0]?.message?.content ?? '');
    };
  return {
    tier: o.tier,
    ctx: { admin: o.admin, userId: o.userId, now: o.now, stubbed: o.stubbed, ...(o.session ? { session: o.session } : {}) },
    async augmtdModel(adapter: AnyAdapter) {
      // W36 — THE PRODUCER MODEL: the AUGMTD column names the model its producer RESOLVES to (a
      // producer:<key> override on the probe outranks the slot), so the report and its effort say
      // what actually ran.
      const { isEffortProducer } = await import('../../../../lib/ai/effort');
      const key = adapter.producer.effortKey;
      return (await getAIClient(o.userId, adapter.producer.slot, o.admin, isEffortProducer(key) ? { producer: key } : {})).model;
    },
    async plainFor(column: Exclude<ColumnId, 'augmtd'>, adapter: AnyAdapter): Promise<PlainSystem> {
      if (column === 'same') {
        const r = await getAIClient(o.userId, adapter.producer.slot, o.admin);
        meterAdapterClient(r.client);
        // W27.C: the slot's effort (the eval's AI_EFFORT_OVERRIDE) is for the AUGMTD column only — the
        // plain column calls the SAME transport unbound, at the effort it states itself.
        const client = unboundClient(r.client);
        const effort = adapter.producer.effort !== undefined ? adapter.producer.effort : floorEffort(r.model);
        const max = adapter.family === 'judgment' || adapter.family === 'extraction' ? 4096 : 8192;
        return { column, label: `same model plain (${adapter.producer.slot} slot, tier ${r.tier})`, model: r.model, effort, call: plainCall(client, r.model, effort, max) };
      }
      if (column === 'sonnet55') {
        const client = getEndpointClient({ provider: 'anthropic', model: SONNET55, baseURL: ANTHROPIC_URL } as Parameters<typeof getEndpointClient>[0]);
        return { column, label: 'Claude Sonnet 5.5 plain', model: SONNET55, effort: o.efforts.sonnet55, call: plainCall(client, SONNET55, o.efforts.sonnet55, 16000) };
      }
      const client = getEndpointClient({ provider: 'openai', model: GPT56 } as Parameters<typeof getEndpointClient>[0]);
      return { column, label: 'GPT-5.6-terra plain', model: GPT56, effort: o.efforts.gpt56, call: plainCall(client, GPT56, o.efforts.gpt56, 16000) };
    },
    seed: (ctx: RunCtx, world) => seedWorld(ctx, world),
    teardown: (ctx: RunCtx, s: SeededWorld) => teardownWorld(ctx, s),
    // W27.C — THE ZONE IS THE WORLD'S: the product memoizes a user's zone for 10 minutes
    // (lib/utils/user-time.ts), so one world's zone (or the probe's UTC fallback) leaked into the next
    // world on the same account. Seeded → the zone the world declares; torn down → forgotten.
    // A world that seeded nothing (the conversation family reads the account's standing state) keeps
    // the product's own derivation.
    worldScope: (ctx: RunCtx, s: SeededWorld | null) => { if (!s) forgetUserTimezone(ctx.userId); else if (s.ledger.length) primeUserTimezone(ctx.userId, s.resolved.tz); },
  };
}

export async function buildJudge(): Promise<JudgePort> {
  const { getEndpointClient, aiCreate } = await import('../../../../lib/ai/factory');
  const client = getEndpointClient({ provider: 'anthropic', model: JUDGE_MODEL, baseURL: ANTHROPIC_URL } as Parameters<typeof getEndpointClient>[0]);
  return {
    model: JUDGE_MODEL,
    async call(system, user, nudge) {
      const res = await aiCreate(client, {
        model: JUDGE_MODEL, max_tokens: 2000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }, ...(nudge ? [{ role: 'user' as const, content: RETRY_NUDGE }] : [])],
      });
      return String(res.choices?.[0]?.message?.content ?? '');
    },
  };
}

/** Install the meter (stubbed or live) — BEFORE the first factory client exists. */
export function armMeter(stubbed: boolean): void {
  installMeter(stubbed ? { stub: engineStub } : {});
}

export { assertPriced };
