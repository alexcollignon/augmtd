// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EFFORT LEVER (W27.C) — how much the chosen model may THINK before it answers, as one measured,
// explicit knob. Off by default: with no per-call effort, no slot entry and no eval override, nothing
// here touches a request, and THE MODEL PARAM FLOOR (factory.ts) keeps sending what it always sent
// (gpt-5 → reasoning_effort 'minimal', Claude-5 family → 'none', every other model → nothing).
//
// FOUR SOURCES, one precedence (highest first):
//   1. per call — `aiCall({ shape: { effort } })` or `aiCreate(client, params, { effort })`. A caller
//      that writes its own `reasoning_effort` / `thinking` into the params is also a per-call statement.
//   1b. THE PRODUCER (W28) — aiCall's `shape.effortProducer` / aiCreate's `{ producer }` option:
//      the eval override for that producer key, else PRODUCER_EFFORT[producer][model family] (below).
//      A producer that resolves an effort wins over its slot's; one that resolves none falls through.
//   2. the EVAL OVERRIDE — `AI_EFFORT_OVERRIDE="classification=low,summarization=medium"`, honoured ONLY
//      when NODE_ENV !== 'production' AND VERCEL_ENV !== 'production' AND `AUGMTD_EVAL=1`. The quality
//      engine (scripts/eval-outputs.ts --effort <slot>=<effort>) sets both, so it can A/B the lever per
//      surface without editing a producer. The live product can never read it.
//   3. SLOT_EFFORT — the per-task-slot config below. EMPTY: every default is today's floor.
//
// THE MAPPING (a FACT per model family; the transport applies it, callers only name an effort):
//   gpt-5*                        → `reasoning_effort: <effort>` (minimal|low|medium|high)
//   Claude 5 family (compat API)  → `reasoning_effort: <effort>` ('minimal' → 'none', the floor's hint)
//   Claude 4.5/4.6 (Haiku 4.5 on Bedrock EU and on the Anthropic compat endpoint; Sonnet 4.5/4.6) —
//     the OLDER thinking API: `thinking: { type: 'enabled', budget_tokens }` with
//     low → 1024 (the API minimum) · medium → 4096 · high → 8192; 'minimal' → thinking stays off.
//     Thinking forbids sampling params (temperature/top_p/top_k are dropped) and a forced tool_choice
//     (the effort is then NOT applied, and says so), and max_tokens must exceed the budget.
//   every other model (gpt-4o-mini, llama, …) → nothing is sent (no reasoning channel to steer).
//
// THE HEADROOM (the Kimi lesson, made structural): reasoning/thinking tokens count against the output
// budget, so a tight judgment budget (200–480 tokens) at effort > minimal would starve into EMPTY JSON.
// Whenever an effort above 'minimal' is applied, the output budget grows by the effort's headroom
// (gpt-5 / Claude 5: +4096 / +8192 / +16384) or by the thinking budget (Claude 4.5/4.6). A cap, not a
// spend: only the tokens actually used are billed.
//
// THE RECORD: every applied request carries its effort under EFFORT_KEY (a Symbol — never serialised
// into a request body); aiCreate stamps it on the response's `usage`, so logAIUsage records the effort
// actually used without any producer changing (lib/ai/log-usage.ts).
// Pure module: no I/O, no imports from the factory (the factory imports this).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { TaskType } from './types'

export type AIEffort = 'minimal' | 'low' | 'medium' | 'high'
export const AI_EFFORTS: readonly AIEffort[] = ['minimal', 'low', 'medium', 'high']
export const isAIEffort = (v: unknown): v is AIEffort => typeof v === 'string' && (AI_EFFORTS as readonly string[]).includes(v)

/** THE PER-SLOT CONFIG. Empty on purpose: every slot runs at the param floor, exactly as before W27.
 *  Adopting the lever for a slot is a one-line, measured decision (the eval's effort A/B first). */
export const SLOT_EFFORT: Readonly<Partial<Record<TaskType, AIEffort>>> = Object.freeze({})

// ── THE PRODUCER EFFORT (W28) — the effort is a PRODUCER'S decision, not a slot's ────────────────
// A task slot is too coarse: one slot ('classification') serves the understanding, the work judge, the
// fulfillment judge, the room brief, the invite and the input-ask judges alike, and the measured A/B
// (scratchpad/w27-effort-low-std.md) split them — 'low' cut the judge/fulfillment/next-move error
// sharply and lifted the understanding, while it did nothing for the invite, worsened the input-ask
// and cost the commitment extraction its consistency. So a producer NAMES ITSELF on its call
// (aiCall's `shape.effortProducer`, aiCreate's `{ producer }` option) and this table,
// keyed by producer AND model family, says what it runs at. A producer absent from the table (or a
// family absent from its entry) keeps the param floor — no silent change anywhere else.
//
// PER FAMILY (a measured decision, never a guess):
//   openai-reasoning (gpt-5 family, the standard tier's volume slots) — MEASURED: 'low' for the four
//     producers below (the effort A/B, repeat 3, AUGMTD vs same/sonnet55/gpt56).
//   claude-thinking (Haiku 4.5 on Bedrock EU) — NOT applied: its lever is extended thinking, which
//     forbids temperature 0 (the determinism these judgments are tuned on), costs a 1,024-token floor
//     per call, and the EU tier is already at/above the same-model baseline on these surfaces without
//     it. Adopting it is a separate, measured one-line entry here.
//   claude-effort / none — nothing (no volume producer routes there).

/** The producers that state an effort (their key is what they pass on their call). */
export const EFFORT_PRODUCERS = [
  'inbox.understanding', // lib/ai/email-processor.ts computeUnderstanding
  'work.judge', // lib/work/judge.ts judgeWork — measured SAME DAY (repeat 3, std): 'low' work-verdict error
  //               0.045 vs 0.182 at the floor; input-ask 0.285 vs 0.309 (its drift vs the older baseline shows at
  //               the floor too — clock-dated fixtures + the W28 judge wording, not the effort).
  'commitments.fulfillment', // lib/commitments/fulfillment.ts judgeFulfillmentFromEvidence
  'room.brief', // lib/room/brief.ts — the room's brief + its ONE move
  'commitments.extract', // lib/commitments/extract.ts — named, but stays at the floor (measured: 'low' cost it
  //                        consistency 86%→71% and set-F1 0.74→0.67). The invite and input-ask verdicts ride
  //                        the work judge; their own follow-up calls (grounding, requirement matching) name
  //                        no producer and stay at the floor (measured: no gain / slightly worse).
] as const
export type EffortProducer = typeof EFFORT_PRODUCERS[number]
export const isEffortProducer = (v: unknown): v is EffortProducer => typeof v === 'string' && (EFFORT_PRODUCERS as readonly string[]).includes(v)

/** THE PRODUCER CONFIG — producer × model family → effort. Absent = the param floor. */
export const PRODUCER_EFFORT: Readonly<Partial<Record<EffortProducer, Readonly<Partial<Record<EffortFamily, AIEffort>>>>>> = Object.freeze({
  'inbox.understanding': Object.freeze({ 'openai-reasoning': 'low' as const }),
  'work.judge': Object.freeze({ 'openai-reasoning': 'low' as const }),
  'commitments.fulfillment': Object.freeze({ 'openai-reasoning': 'low' as const }),
  'room.brief': Object.freeze({ 'openai-reasoning': 'low' as const }),
})

/** Output-budget headroom when an effort above 'minimal' is applied (gpt-5 / Claude-5 family). */
export const EFFORT_HEADROOM: Readonly<Record<AIEffort, number>> = Object.freeze({ minimal: 0, low: 4096, medium: 8192, high: 16384 })
/** `thinking.budget_tokens` per effort (Claude 4.5/4.6 — the older thinking API; 1024 is the API minimum). */
export const THINKING_BUDGET: Readonly<Record<AIEffort, number>> = Object.freeze({ minimal: 0, low: 1024, medium: 4096, high: 8192 })
/** The output budget a thinking request starts from when the caller stated none (the adapter's default). */
const THINKING_BASE_MAX = 4096

/** Symbol stamped on a request (and on its response `usage`) naming the effort applied — null when an
 *  effort was stated but the model has nothing to steer. JSON.stringify skips symbol keys, so it never
 *  reaches a request body. */
export const EFFORT_KEY: unique symbol = Symbol.for('augmtd.ai.effort') as never

// ── model families (facts) ──────────────────────────────────────────────────────────────────────

/** Claude 4.7+/5 family: sampling params removed, `reasoning_effort` accepted as a hint (factory floor). */
export const CLAUDE_NO_SAMPLING_RE = /^claude-(sonnet-5|opus-5|opus-4-[78]|fable-5)/
/** Claude 4.5/4.6 — extended thinking via `thinking.budget_tokens` (bare ids and Bedrock `eu.anthropic.` ids). */
const CLAUDE_THINKING_RE = /(^|\.)claude-(haiku-4-5|sonnet-4-5|sonnet-4-6|opus-4-5|opus-4-6)/

export type EffortFamily = 'openai-reasoning' | 'claude-effort' | 'claude-thinking' | 'none'

export function effortFamily(model: string): EffortFamily {
  if (/^gpt-5/.test(model)) return 'openai-reasoning'
  if (CLAUDE_NO_SAMPLING_RE.test(model)) return 'claude-effort'
  if (CLAUDE_THINKING_RE.test(model)) return 'claude-thinking'
  return 'none'
}

/** Does this effort make the model think on this model (i.e. is a reasoning budget needed)? */
export function effortThinks(model: string, effort: AIEffort | null | undefined): boolean {
  return !!effort && effort !== 'minimal' && effortFamily(model) !== 'none'
}

// ── the override (eval only) + resolution ───────────────────────────────────────────────────────

type Env = Record<string, string | undefined>

/** The override is readable only outside production AND with the explicit eval flag. */
export function effortOverrideArmed(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.VERCEL_ENV !== 'production' && env.AUGMTD_EVAL === '1'
}

/** Parse `key=effort,key=effort` — a key is a task SLOT (`classification`) or a PRODUCER
 *  (`work.judge`, EFFORT_PRODUCERS). Unknown keys / efforts are reported, never silently used. */
export function parseEffortOverride(raw: string | null | undefined): {
  map: Partial<Record<TaskType, AIEffort>>; producers: Partial<Record<EffortProducer, AIEffort>>; problems: string[]
} {
  const SLOTS: TaskType[] = ['planning', 'generation', 'summarization', 'classification', 'embeddings', 'ocr', 'assignment', 'conversation']
  const map: Partial<Record<TaskType, AIEffort>> = {}
  const producers: Partial<Record<EffortProducer, AIEffort>> = {}
  const problems: string[] = []
  for (const part of String(raw ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const [k, v] = part.split('=').map((x) => x?.trim())
    const isProducer = isEffortProducer(k)
    if (!isProducer && (!SLOTS.includes(k as TaskType) || k === 'embeddings')) { problems.push(`unknown slot or producer "${k}"`); continue }
    if (!isAIEffort(v)) { problems.push(`unknown effort "${v}" for ${k} (minimal|low|medium|high)`); continue }
    if (isProducer) producers[k] = v
    else map[k as TaskType] = v
  }
  return { map, producers, problems }
}

/** The eval override for a slot — undefined unless armed (non-production + AUGMTD_EVAL=1). */
export function effortOverride(slot: TaskType, env: Env = process.env): AIEffort | undefined {
  if (!effortOverrideArmed(env)) return undefined
  return parseEffortOverride(env.AI_EFFORT_OVERRIDE).map[slot]
}

/** The effort a slot runs at when the call states none: the eval override, else SLOT_EFFORT, else
 *  undefined (= the param floor, unchanged). */
export function slotEffort(slot: TaskType, env: Env = process.env): AIEffort | undefined {
  return effortOverride(slot, env) ?? SLOT_EFFORT[slot]
}

/** The eval override for a producer — undefined unless armed (non-production + AUGMTD_EVAL=1). */
export function producerEffortOverride(producer: EffortProducer, env: Env = process.env): AIEffort | undefined {
  if (!effortOverrideArmed(env)) return undefined
  return parseEffortOverride(env.AI_EFFORT_OVERRIDE).producers[producer]
}

/**
 * The effort a PRODUCER's call runs at on this model: the eval override for the producer (non-production
 * only), else PRODUCER_EFFORT[producer][family(model)], else undefined — and undefined means the call
 * falls through to the slot's effort / the param floor, exactly as before. Pure given env.
 */
export function producerEffort(producer: EffortProducer | null | undefined, model: string, env: Env = process.env): AIEffort | undefined {
  if (!producer) return undefined
  return producerEffortOverride(producer, env) ?? PRODUCER_EFFORT[producer]?.[effortFamily(model)]
}

// ── application (pure) ──────────────────────────────────────────────────────────────────────────

type Params = Record<string | symbol, unknown>

/** Did the caller already state an effort in the params (our marker, or its own provider field)? */
export function callerStatedEffort(params: unknown): boolean {
  const p = params as Params | null | undefined
  return !!p && (EFFORT_KEY in p || p.reasoning_effort != null || p.thinking != null)
}

/** The effort recorded on a request or a usage object (undefined = none stated; null = not applicable). */
export function effortOf(o: unknown): AIEffort | null | undefined {
  if (!o || typeof o !== 'object' || !(EFFORT_KEY in (o as object))) return undefined
  const v = (o as Params)[EFFORT_KEY]
  return isAIEffort(v) ? v : null
}

const bump = (n: unknown, by: number): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n + by : undefined)

/**
 * Apply an effort to a chat.completions request for its model. Pure: returns a NEW params object
 * (the caller's is never mutated) stamped with EFFORT_KEY, and the effort actually applied (null when
 * the model has nothing to steer, or thinking is impossible for this request).
 */
export function applyEffort<P extends object>(params: P, effort: AIEffort): { params: P; applied: AIEffort | null; family: EffortFamily } {
  const src = params as unknown as Params
  const model = typeof src.model === 'string' ? src.model : ''
  const family = effortFamily(model)
  const p: Params = { ...src }
  const done = (applied: AIEffort | null) => {
    // ENUMERABLE on purpose: the floor and aiCreate re-spread params (`{ ...params }` copies enumerable
    // symbols), so the marker survives to the meter and to a slot-bound client; JSON never sees a symbol.
    p[EFFORT_KEY] = applied
    return { params: p as unknown as P, applied, family }
  }
  if (family === 'openai-reasoning' || family === 'claude-effort') {
    p.reasoning_effort = family === 'claude-effort' && effort === 'minimal' ? 'none' : effort
    const room = EFFORT_HEADROOM[effort]
    if (room) {
      if (p.max_completion_tokens != null) p.max_completion_tokens = bump(p.max_completion_tokens, room)
      else if (p.max_tokens != null) p.max_tokens = bump(p.max_tokens, room)
    }
    return done(effort)
  }
  if (family === 'claude-thinking') {
    if (effort === 'minimal') return done('minimal')
    const tc = p.tool_choice
    if (tc != null && tc !== 'auto' && tc !== 'none') return done(null) // thinking forbids a forced tool
    const budget = THINKING_BUDGET[effort]
    p.thinking = { type: 'enabled', budget_tokens: budget }
    const base = typeof p.max_tokens === 'number' ? p.max_tokens : typeof p.max_completion_tokens === 'number' ? p.max_completion_tokens : THINKING_BASE_MAX
    if (p.max_completion_tokens != null) p.max_completion_tokens = base + budget
    else p.max_tokens = base + budget
    delete p.temperature
    delete p.top_p
    delete p.top_k
    return done(effort)
  }
  return done(null)
}

/** Stamp the applied effort on a response's usage (non-enumerable — never serialised). */
export function stampUsageEffort(res: unknown, applied: AIEffort | null | undefined): void {
  const usage = (res as { usage?: object | null } | null)?.usage
  if (!usage || typeof usage !== 'object' || applied === undefined) return
  try { Object.defineProperty(usage, EFFORT_KEY, { value: applied, enumerable: false, configurable: true }) } catch { /* frozen: unrecorded */ }
}
