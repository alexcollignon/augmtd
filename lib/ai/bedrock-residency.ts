// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EU RESIDENCY FLOOR FOR BEDROCK (W31, Tier-1 #12 TIER PRIVACY) — an EU-region Bedrock endpoint may
// only address models that run IN-REGION (a bare `provider.model` id, e.g. `openai.gpt-oss-120b-1:0`,
// `cohere.embed-multilingual-v3`) or through the EU geo profile (`eu.anthropic.…`). A cross-region
// inference profile outside the EU — `global.` (anywhere in the world), `us.`, `apac.`, `us-gov.`, `jp.`,
// `au.`, `ca.` — would route tenant content out of the perimeter the tier exists to keep.
//
// Enforced twice: the Bedrock adapter refuses such a request before it is sent (fail closed, outcome),
// and tests/unit/bedrock-converse.test.ts asserts every TIER_DEFAULTS bedrock slot and every documented
// override target below passes. Pure module: no I/O, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Cross-region inference-profile prefixes that leave the EU. */
const NON_EU_PROFILE_RE = /^(global|us|us-gov|apac|jp|au|ca|sa|me|af)\./

/** Is this Bedrock model id resident in the EU when called from an EU region? */
export function isEuResidentBedrockModel(model: string): boolean {
  const m = String(model ?? '').trim()
  if (!m) return false
  if (NON_EU_PROFILE_RE.test(m)) return false
  // `eu.` geo profile, or an in-region `provider.model` id (a bare id is served by the calling region).
  return /^eu\./.test(m) || /^[a-z0-9-]+\.[a-z0-9]/i.test(m)
}

/** Is this an EU AWS region (the EU tier's perimeter)? */
export const isEuRegion = (region: string | undefined): boolean => /^eu-/.test(String(region ?? ''))

/**
 * The override targets an EU-tier tenant may be pointed at (probe-account A/B, per-task
 * modelOverrides). Documented here so the gate covers them; adding a target = adding it here.
 */
export const EU_BEDROCK_OVERRIDE_TARGETS: readonly string[] = Object.freeze([
  'openai.gpt-oss-120b-1:0', // W31 — in-region in eu-central-1 (confirmed live on our account)
])

/** Thrown when an EU-region request names a model outside the EU perimeter. */
export class BedrockResidencyError extends Error {
  constructor(model: string, region: string) {
    super(`[bedrock] refused: model "${model}" is not EU-resident for region ${region} (tier privacy)`)
    this.name = 'BedrockResidencyError'
  }
}

/** Throw unless the model is EU-resident — only when the region is an EU region. */
export function assertBedrockResidency(model: string, region: string | undefined): void {
  if (isEuRegion(region) && !isEuResidentBedrockModel(model)) throw new BedrockResidencyError(model, String(region))
}
