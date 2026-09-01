// ─── Model pricing — €/1M tokens ───────────────────────────────────────────────
// One row per model id, keyed identically to the model ids in lib/ai/defaults.ts's
// TIER_DEFAULTS, so pricing can never silently drift out of sync with tier routing.
// Approximate public rates (converted to EUR) — good enough for a "what did this
// cost" estimate, not a billing-grade figure. Revisit if providers reprice.

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o-mini':              { inputPer1M: 0.14, outputPer1M: 0.55 },
  'gpt-4o':                   { inputPer1M: 2.30, outputPer1M: 9.20 },
  'gpt-5-mini':               { inputPer1M: 0.23, outputPer1M: 1.85 },
  'text-embedding-3-small':   { inputPer1M: 0.02, outputPer1M: 0 },

  // Anthropic (direct)
  'claude-haiku-4-5-20251001': { inputPer1M: 0.90, outputPer1M: 4.50 },
  'claude-sonnet-4-6':         { inputPer1M: 2.80, outputPer1M: 14.00 },
  'claude-sonnet-5':           { inputPer1M: 1.85, outputPer1M: 9.20 },

  // AWS Bedrock EU (same underlying Claude models, Bedrock pricing)
  'eu.anthropic.claude-haiku-4-5-20251001-v1:0':  { inputPer1M: 0.90, outputPer1M: 4.50 },
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0': { inputPer1M: 2.80, outputPer1M: 14.00 },
  'cohere.embed-multilingual-v3':                 { inputPer1M: 0.09, outputPer1M: 0 },

  // Private-client / on-prem defaults — placeholder rates (client's own infra;
  // cost is mostly compute the client already owns, not a per-token bill).
  'llama-3.1-70b':      { inputPer1M: 0.35, outputPer1M: 0.40 },
  'llama-3.1-8b':        { inputPer1M: 0.05, outputPer1M: 0.08 },
  'llama-3.2-vision':    { inputPer1M: 0.15, outputPer1M: 0.15 },
  'bge-m3':              { inputPer1M: 0.01, outputPer1M: 0 },
};

/** Conservative fallback for any model not yet in the map — logged, not silently zeroed. */
const FALLBACK_PRICING: ModelPricing = { inputPer1M: 1.0, outputPer1M: 3.0 };

export function estimateCostEur(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(`[ai-pricing] no pricing entry for model "${model}" — using fallback rate`);
  }
  const { inputPer1M, outputPer1M } = pricing ?? FALLBACK_PRICING;
  const cost = (promptTokens / 1_000_000) * inputPer1M + (completionTokens / 1_000_000) * outputPer1M;
  return Math.round(cost * 10000) / 10000;
}
