// ════════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE-BASED MODEL ROUTING (One Brain Phase A0) — `aiCall` replaces the semantic task-name enum with
// the call's declared SHAPE. The task enum was a lossy label (same disease as string-label identity):
// callers wrote `'classification'` as a codeword for "non-reasoning model that emits JSON reliably",
// and the reasoning-model trap (reasoning tiers burn max_tokens in the thinking channel on JSON-shaped
// prompts → EMPTY content → silent fallback) had to be dodged with "⚠️ MUST use classification tier"
// tribal comments at every call site. Here the mistake is unexpressible:
//
//   aiCall({ userId, supabase, shape: { output: 'json' }, prompt, source: '…' })
//
// TWO ORTHOGONAL AXES:
//   • TIER  (kept, from tenant config) — WHERE models come from: privacy/procurement.
//   • SHAPE (new, declared by caller)  — WHICH model fits: json vs text, deep reasoning or not, voice.
//
// CENTRALIZED PLUMBING (was scattered/copy-pasted): fence-stripping + outer-JSON extraction, parse
// fallback, response_format quirks (Bedrock-Haiku ignores json_object and fences its JSON), per-shape
// max_tokens (a REAL reasoning-channel budget so reasoning models can SAFELY emit JSON — unlocking them
// instead of avoiding them), empty-content fallback to the tier's non-reasoning JSON model, aiCreate's
// 429/529 retries, and logAIUsage.
//
// During the transition existing `getAIClient(task)` callers migrate here one by one; the enum dies in
// One Brain Phase D (demolition). Streaming chat paths keep their own plumbing for now (out of A0 scope).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import type { TaskType, TierType } from './types';
import { getAIClient, getSystemClient, aiCreate } from './factory';
import { parseModelJSON } from './parse-json';
import { logAIUsage, type AIUsageSource } from './log-usage';

export type CallShape = {
  output: 'json' | 'text';
  /** Does this call genuinely benefit from chain-of-thought? Default 'none'. */
  reasoning?: 'none' | 'deep';
  /** Interactive (user waiting) vs background. Informational today; reserved for latency-aware routing. */
  latency?: 'interactive' | 'background';
  /** Generation in the user's voice (drafts, replies) — routes to the strongest generator. */
  voice?: boolean;
};

// ── Shape → tier-slot routing table ──────────────────────────────────────────────────────────────
// The ONE place that knows what each tier's slots actually contain (this knowledge used to live as
// tribal comments at call sites). Slots reference TIER_DEFAULTS via TaskType so tenant modelOverrides
// keep applying unchanged.
//   jsonFast — best reliable structured-output model (non-reasoning where the tier has one)
//   deep     — strongest reasoner (safe to use through the json policy below)
//   voiceGen — strongest natural-language generator (drafts, prose)
//   text     — default plain-text generation
const SHAPE_ROUTES: Record<TierType, { jsonFast: TaskType; deep: TaskType; voiceGen: TaskType; text: TaskType }> = {
  standard:          { jsonFast: 'classification', deep: 'conversation', voiceGen: 'conversation', text: 'generation' },
  professional:      { jsonFast: 'classification', deep: 'conversation', voiceGen: 'conversation', text: 'generation' },
  private_shared:    { jsonFast: 'classification', deep: 'planning',     voiceGen: 'conversation', text: 'generation' },
  bedrock_private:   { jsonFast: 'classification', deep: 'conversation', voiceGen: 'conversation', text: 'generation' },
  bedrock_optimised: { jsonFast: 'classification', deep: 'planning',     voiceGen: 'conversation', text: 'generation' },
  private_client:    { jsonFast: 'classification', deep: 'planning',     voiceGen: 'conversation', text: 'generation' },
  on_prem:           { jsonFast: 'classification', deep: 'planning',     voiceGen: 'conversation', text: 'generation' },
};

function slotForShape(tier: TierType, shape: CallShape): TaskType {
  const r = SHAPE_ROUTES[tier] ?? SHAPE_ROUTES.standard;
  if (shape.voice) return r.voiceGen;
  if (shape.reasoning === 'deep') return r.deep;
  if (shape.output === 'json') return r.jsonFast;
  return r.text;
}

// ── Model traits (FACTS about model families, not judgment) ─────────────────────────────────────
// A reasoning-channel model spends tokens "thinking" before emitting — on a JSON-shaped prompt with a
// small budget the thinking eats everything and content comes back EMPTY (the documented trap). Knowing
// the family lets the policy below give it a real budget instead of banning it.
const REASONING_CHANNEL = /kimi|gpt-oss|deepseek-r|qwq|\bo[134](?:-mini)?\b/i;
export const hasReasoningChannel = (model: string): boolean => REASONING_CHANNEL.test(model);

// Robust JSON extraction: fence anywhere in the output + outer-object slice, then the tolerant parser.
// (Bedrock-Haiku ignores response_format and fences its JSON; reasoning models may emit preamble.)
function extractJSON<T>(text: string, fallback: T): T {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return parseModelJSON<T>(t, fallback);
}

export interface AICallOpts {
  /** null → system context (standard tier, no tenant lookup). */
  userId: string | null;
  /** Required when userId is set (tenant resolution + usage logging). */
  supabase?: SupabaseClient;
  shape: CallShape;
  /** Either a single user prompt… */
  prompt?: string;
  /** …or full messages (wins over prompt). */
  messages?: OpenAI.Chat.ChatCompletionMessageParam[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Usage attribution — logged fire-and-forget when userId+supabase are present. */
  source?: AIUsageSource;
}

export interface AICallResult<T> {
  text: string;
  /** Parsed output for shape.output==='json' (null on parse failure); null for text shape. */
  json: T | null;
  model: string;
  tier: TierType;
}

/**
 * The shape-routed AI call. Resolves tier (tenant config) → picks the model by the call's SHAPE →
 * executes with centralized safety: reasoning-channel budgets, fence-safe JSON extraction, and an
 * automatic fallback to the tier's non-reasoning JSON model if a reasoning model still comes back
 * empty. Non-streaming (streaming chat keeps its dedicated paths until a later phase).
 */
export async function aiCall<T = unknown>(opts: AICallOpts): Promise<AICallResult<T>> {
  const shape = opts.shape;
  const resolve = async (slot: TaskType) =>
    opts.userId && opts.supabase ? getAIClient(opts.userId, slot, opts.supabase) : getSystemClient(slot);

  const tierProbe = await resolve('classification'); // cheap: config is cached; gives us the tier
  const tier = tierProbe.tier as TierType;
  const slot = slotForShape(tier, shape);
  let resolved = slot === 'classification' ? tierProbe : await resolve(slot);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = opts.messages
    ?? [...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []), { role: 'user' as const, content: opts.prompt ?? '' }];

  // Per-shape token budget: a reasoning-channel model needs room to think AND emit — the trap was
  // starving it. A caller's explicit size is respected EXCEPT when it would starve a reasoning model's
  // JSON emission (the exact bug this router exists to make unexpressible).
  const reasoningModel = hasReasoningChannel(resolved.model);
  const defaultBudget = shape.reasoning === 'deep' || reasoningModel ? 8192 : 2048;
  let maxTokens = opts.maxTokens ?? defaultBudget;
  if (reasoningModel && shape.output === 'json' && maxTokens < 8192) maxTokens = 8192;

  const run = async (client: OpenAI, model: string, budget: number) => {
    const res = await aiCreate(client, {
      model,
      messages,
      max_tokens: budget,
      temperature: opts.temperature ?? 0,
      ...(shape.output === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return { text: res.choices?.[0]?.message?.content?.trim() ?? '', usage: res.usage };
  };

  let { text, usage } = await run(resolved.client, resolved.model, maxTokens);

  // Empty-content safety net (the trap, made structurally survivable): a reasoning model that returned
  // nothing gets one bigger-budget retry, then falls back to the tier's non-reasoning JSON model.
  if (!text && shape.output === 'json' && reasoningModel) {
    ({ text, usage } = await run(resolved.client, resolved.model, maxTokens * 2));
    if (!text) {
      const fb = slot === 'classification' ? tierProbe : await resolve('classification');
      if (fb.model !== resolved.model) {
        console.warn(`[aiCall] reasoning model ${resolved.model} returned empty JSON twice — falling back to ${fb.model}`);
        resolved = fb;
        ({ text, usage } = await run(fb.client, fb.model, 2048));
      }
    }
  }

  if (opts.source && opts.userId && opts.supabase) {
    logAIUsage(opts.supabase, {
      userId: opts.userId, source: opts.source, provider: resolved.endpoint.provider,
      model: resolved.model, tier, taskType: slot, usage,
    }).catch(() => {});
  }

  return {
    text,
    json: shape.output === 'json' ? extractJSON<T | null>(text, null) : null,
    model: resolved.model,
    tier,
  };
}

/** Pure resolution (no AI) — which model a shape routes to for a tier. For tests/smokes. */
export function resolveShapeModel(tier: TierType, shape: CallShape): { slot: TaskType } {
  return { slot: slotForShape(tier, shape) };
}
