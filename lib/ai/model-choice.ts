// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRODUCER MODEL (W36) — the one resolver of WHICH model serves a call. Pure: no I/O, no SDK.
//
// A task slot is too coarse for a model choice: one slot carries several producers, and the measured
// A/Bs (scratchpad/w30-*) split them. So a producer that names itself (lib/ai/effort.ts EFFORT_PRODUCERS
// — the same key its effort is configured by) may be routed to its own model.
//
// THE PRECEDENCE (highest first — stated once, here and in lib/ai/defaults.ts PRODUCER_MODEL):
//   1. 'tenant-producer' — tenant_configs.model_overrides["producer:<key>"]
//   2. 'tier-producer'   — PRODUCER_MODEL[tier][<key>]
//   3. 'tenant-slot'     — tenant_configs.model_overrides[<slot>]
//   4. 'tier-slot'       — TIER_DEFAULTS[tier][<slot>]
// Each level LAYERS over the resolution beneath it (`{ model }` keeps the slot's provider, baseURL and
// budget). A producer-level entry naming a DIFFERENT provider starts fresh from itself — it never
// inherits a foreign baseURL/apiVersion. The slot level merges exactly as it always did.
//
// THE PERIMETER (Tier-1 #12 TIER PRIVACY): on the EU tiers every level's resolved endpoint must be an
// EU-resident Bedrock model (lib/ai/bedrock-residency.ts). A level that is not is REFUSED (reported in
// `refused`, logged by the factory) and the next level serves; if even the tier default failed, the
// resolution throws — fail closed. The Bedrock adapter re-checks at request time (the second lock).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { TaskType, TierType, ModelEndpoint, ModelOverrides } from './types'
import { TIER_DEFAULTS, PRODUCER_MODEL } from './defaults'
import { isEffortProducer, type EffortProducer } from './effort'
import { isEuResidentBedrockModel, BedrockResidencyError } from './bedrock-residency'

export type ModelSource = 'tenant-producer' | 'tier-producer' | 'tenant-slot' | 'tier-slot'
/** The precedence, highest first. */
export const MODEL_PRECEDENCE: readonly ModelSource[] = Object.freeze(['tenant-producer', 'tier-producer', 'tenant-slot', 'tier-slot'])

export const PRODUCER_OVERRIDE_PREFIX = 'producer:'
/** The tenant_configs.model_overrides key a producer override lives under. */
export const producerOverrideKey = (producer: EffortProducer): `producer:${string}` => `${PRODUCER_OVERRIDE_PREFIX}${producer}`

/** The tiers whose content must stay in the EU Bedrock perimeter. */
export const EU_PERIMETER_TIERS: readonly TierType[] = Object.freeze(['bedrock_private', 'bedrock_optimised'])

/** May this endpoint serve this tier? Off the EU tiers: always. On them: Bedrock + an EU-resident id. */
export function withinTierPerimeter(tier: TierType, ep: Pick<ModelEndpoint, 'provider' | 'model'>): boolean {
  if (!EU_PERIMETER_TIERS.includes(tier)) return true
  return ep.provider === 'bedrock' && isEuResidentBedrockModel(ep.model)
}

const SLOTS: readonly TaskType[] = ['planning', 'generation', 'summarization', 'classification', 'embeddings', 'ocr', 'assignment', 'conversation']

/** Keys of a model_overrides object that nothing will ever read (typos, retired producers), and entries
 *  with no usable model — reported, never silently used. Pure. */
export function modelOverrideProblems(overrides: unknown): string[] {
  const out: string[] = []
  if (!overrides || typeof overrides !== 'object') return out
  for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
    const isSlot = (SLOTS as readonly string[]).includes(k)
    const isProducer = k.startsWith(PRODUCER_OVERRIDE_PREFIX) && isEffortProducer(k.slice(PRODUCER_OVERRIDE_PREFIX.length))
    if (!isSlot && !isProducer) { out.push(`unknown model_overrides key "${k}" (a slot, or producer:<one of EFFORT_PRODUCERS>)`); continue }
    if (!v || typeof v !== 'object') { out.push(`model_overrides["${k}"] is not an endpoint object`); continue }
    const m = (v as { model?: unknown }).model
    if (m != null && (typeof m !== 'string' || !m.trim())) out.push(`model_overrides["${k}"].model is not a model id`)
  }
  return out
}

function entry(v: unknown): Partial<ModelEndpoint> | null {
  return v && typeof v === 'object' && Object.keys(v as object).length ? (v as Partial<ModelEndpoint>) : null
}

/** A producer-level layer: over its base, unless it names another provider (then it stands alone). */
function layerProducer(base: ModelEndpoint, over: Partial<ModelEndpoint>): ModelEndpoint {
  if (over.provider && over.provider !== base.provider) return { ...over, model: over.model ?? '' } as ModelEndpoint
  return { ...base, ...over }
}

export interface ModelChoice {
  endpoint: ModelEndpoint
  source: ModelSource
  /** Levels that were configured but refused by the perimeter (or had no model), highest first. */
  refused: Array<{ source: ModelSource; provider: string; model: string; reason: string }>
}

/**
 * Resolve the endpoint for a call. Pure given its inputs (the tier tables are module constants).
 * `producer` absent (or unknown) = the slot resolution exactly as before W36.
 */
export function resolveModelChoice(o: {
  tier: TierType
  task: TaskType
  overrides?: ModelOverrides | Record<string, unknown> | null
  producer?: EffortProducer | string | null
  /** Test seam: the tier producer table (defaults to PRODUCER_MODEL). */
  producerTable?: Readonly<Record<string, Readonly<Record<string, Partial<ModelEndpoint>>>>>
}): ModelChoice {
  const overrides = (o.overrides ?? {}) as Record<string, unknown>
  const tierSlot = TIER_DEFAULTS[o.tier][o.task]
  // Level 4 → 3: the slot merge, unchanged since the factory's first version.
  const slotOver = entry(overrides[o.task])
  const tenantSlot: ModelEndpoint | null = slotOver ? { ...tierSlot, ...slotOver } : null
  const slotBase = tenantSlot ?? tierSlot

  const producer = o.producer && isEffortProducer(o.producer) && o.task !== 'embeddings' ? o.producer : null
  const table = (o.producerTable ?? PRODUCER_MODEL) as Readonly<Record<string, Readonly<Record<string, Partial<ModelEndpoint>>>>>
  const tierProdOver = producer ? entry(table[o.tier]?.[producer]) : null
  const tenantProdOver = producer ? entry(overrides[producerOverrideKey(producer)]) : null

  // Candidates, highest precedence first; each layers over the best PERMITTED level beneath it.
  const refused: ModelChoice['refused'] = []
  const ok = (source: ModelSource, ep: ModelEndpoint): boolean => {
    if (!ep.model) { refused.push({ source, provider: String(ep.provider), model: '', reason: 'no model' }); return false }
    if (!withinTierPerimeter(o.tier, ep)) { refused.push({ source, provider: String(ep.provider), model: ep.model, reason: `outside the ${o.tier} EU perimeter` }); return false }
    return true
  }
  // Bottom-up: settle the base each higher level layers on.
  let chosen: { ep: ModelEndpoint; source: ModelSource } | null = ok('tier-slot', tierSlot) ? { ep: tierSlot, source: 'tier-slot' } : null
  if (tenantSlot && ok('tenant-slot', tenantSlot)) chosen = { ep: tenantSlot, source: 'tenant-slot' }
  if (tierProdOver) {
    const ep = layerProducer(chosen?.ep ?? slotBase, tierProdOver)
    if (ok('tier-producer', ep)) chosen = { ep, source: 'tier-producer' }
  }
  if (tenantProdOver) {
    const ep = layerProducer(chosen?.ep ?? slotBase, tenantProdOver)
    if (ok('tenant-producer', ep)) chosen = { ep, source: 'tenant-producer' }
  }
  if (!chosen) throw new BedrockResidencyError(tierSlot.model, `tier ${o.tier}`)
  // Report highest first.
  refused.sort((a, b) => MODEL_PRECEDENCE.indexOf(a.source) - MODEL_PRECEDENCE.indexOf(b.source))
  return { endpoint: { ...chosen.ep }, source: chosen.source, refused }
}
