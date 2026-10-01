import type { TaskType, TierType, ModelEndpoint } from './types'
import type { EffortProducer } from './effort'

// ─── Tier defaults ──────────────────────────────────────────────────────────────
// One model per task per tier. These are the baseline — tenant modelOverrides
// layer on top at runtime.
//
// All tiers use OpenAI-compatible API format.
// - standard:        api.openai.com + api.anthropic.com (via compat endpoint)
// - professional:    Azure OpenAI (baseURL + apiVersion set per tenant)
// - private_client:  Client-provided endpoints (tenant_configs.endpoints)
// - on_prem:         Same as private_client, different auth

export const TIER_DEFAULTS: Record<TierType, Record<TaskType, ModelEndpoint>> = {
  // ── Standard — current production setup (volume slots refreshed Aug 31) ───────
  // gpt-4o-mini carried every judgment/volume slot (incl. the ONE work judgment via
  // aiCall's jsonFast route) — a 2024 budget model under 2026 prompts. Replaced with
  // gpt-5-mini (~same price band, far stronger). gpt-5 and Claude-5 family API
  // differences (max_completion_tokens, removed sampling params, reasoning channel) are
  // absorbed at the transport layer — THE MODEL PARAM FLOOR in factory.ts's buildClient —
  // so the 100+ call sites stay untouched. conversation: Sonnet 4.6 → Sonnet 5 (better AND cheaper).
  // ocr: gpt-4o → gpt-5-mini (vision-capable at a tenth of the input rate).
  standard: {
    planning:      { provider: 'openai',     model: 'gpt-5-mini' },
    generation:    { provider: 'anthropic',  model: 'claude-haiku-4-5-20251001',
                     baseURL: 'https://api.anthropic.com/v1' },
    summarization: { provider: 'openai',     model: 'gpt-5-mini' },
    classification:{ provider: 'openai',     model: 'gpt-5-mini' },
    embeddings:    { provider: 'bedrock',    model: 'cohere.embed-multilingual-v3', dimensions: 1024 },
    ocr:           { provider: 'openai',     model: 'gpt-5-mini' },
    assignment:    { provider: 'openai',     model: 'gpt-5-mini' },
    conversation:  { provider: 'anthropic',  model: 'claude-sonnet-5',
                     baseURL: 'https://api.anthropic.com/v1' },
  },

  // ── Professional — Azure OpenAI / AWS Bedrock ────────────────────────────────
  // baseURL and apiVersion are set per-tenant in tenant_configs.endpoints.
  // Placeholders here; factory merges in tenant endpoint at runtime.
  professional: {
    planning:      { provider: 'azure_openai', model: 'gpt-4o-mini', apiVersion: '2024-02-01' },
    generation:    { provider: 'azure_openai', model: 'gpt-4o-mini', apiVersion: '2024-02-01' },
    summarization: { provider: 'azure_openai', model: 'gpt-4o-mini', apiVersion: '2024-02-01' },
    classification:{ provider: 'azure_openai', model: 'gpt-4o-mini', apiVersion: '2024-02-01' },
    embeddings:    { provider: 'azure_openai', model: 'text-embedding-3-small', apiVersion: '2024-02-01', dimensions: 1024 },
    ocr:           { provider: 'azure_openai', model: 'gpt-4o', apiVersion: '2024-02-01' },
    assignment:    { provider: 'azure_openai', model: 'gpt-4o-mini', apiVersion: '2024-02-01' },
    conversation:  { provider: 'azure_openai', model: 'gpt-4o-mini', apiVersion: '2024-02-01' },
  },

  // ── Bedrock private — AWS Bedrock + Claude Haiku 4.5 ─────────────────────────
  // Structural data isolation: Anthropic has zero access to prompts (AWS-managed infra).
  // Claude Haiku 4.5 for all tasks. Embeddings on Bedrock EU too (Cohere Embed Multilingual v3, Aug 19).
  // SOC2/HIPAA-eligible, GDPR data residency via regional endpoints.
  bedrock_private: {
    planning:       { provider: 'bedrock', model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    generation:     { provider: 'bedrock', model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    summarization:  { provider: 'bedrock', model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    classification: { provider: 'bedrock', model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    embeddings:     { provider: 'bedrock', model: 'cohere.embed-multilingual-v3', dimensions: 1024 },
    ocr:            { provider: 'bedrock', model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    assignment:     { provider: 'bedrock', model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    conversation:   { provider: 'bedrock', model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
  },

  // ── Bedrock optimised — BEDROCK-ONLY completions, Sonnet as the intelligence/cost cap ─
  // All chat/completion work stays on AWS Bedrock EU (data residency, one provider):
  //   • Haiku 4.5 for the volume work (triage, summaries, background JSON) — cheap.
  //   • Sonnet 4.5 ONLY where the extra intelligence pays (conversation, planning/deep) — the cap;
  //     never Opus. (July 2026: replaced the earlier third-party OSS split so no prompt leaves
  //     Bedrock; also removes the reasoning-channel trap from this tier entirely. Aug 19: that
  //     third-party provider and its `private_shared` tier were REMOVED from the codebase.)
  // Embeddings on Bedrock EU as well (Cohere Embed Multilingual v3, 1024-d — Aug 19, THE PRIVACY PREMISE): the last
  // third-party hop is gone; the whole tier is ONE perimeter. The swap was done deliberately with a
  // full re-embed (`scripts/reembed-bedrock.ts`) — vectors from different models never share a space.
  bedrock_optimised: {
    conversation:  { provider: 'bedrock',           model: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', maxTokensDefault: 8192 },
    generation:    { provider: 'bedrock',           model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    ocr:           { provider: 'bedrock',           model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    planning:      { provider: 'bedrock',           model: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', maxTokensDefault: 8192 },
    classification:{ provider: 'bedrock',           model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    summarization: { provider: 'bedrock',           model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    assignment:    { provider: 'bedrock',           model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', maxTokensDefault: 4096 },
    embeddings:    { provider: 'bedrock',           model: 'cohere.embed-multilingual-v3', dimensions: 1024 },
  },

  // ── Private client — client's own cloud ──────────────────────────────────────
  // baseURLs come from tenant_configs.endpoints at runtime.
  // Model names are typical defaults — clients can override per task.
  private_client: {
    planning:      { provider: 'openai_compatible', model: 'llama-3.1-70b' },
    generation:    { provider: 'openai_compatible', model: 'llama-3.1-70b' },
    summarization: { provider: 'openai_compatible', model: 'llama-3.1-8b' },
    classification:{ provider: 'openai_compatible', model: 'llama-3.1-8b' },
    embeddings:    { provider: 'openai_compatible', model: 'bge-m3' },
    ocr:           { provider: 'openai_compatible', model: 'llama-3.2-vision' },
    assignment:    { provider: 'openai_compatible', model: 'llama-3.1-8b' },
    conversation:  { provider: 'openai_compatible', model: 'llama-3.1-70b' },
  },

  // ── On-prem — client hardware, air-gapped ────────────────────────────────────
  // Same model choices as private_client. Endpoints from tenant_configs.
  on_prem: {
    planning:      { provider: 'openai_compatible', model: 'llama-3.1-70b' },
    generation:    { provider: 'openai_compatible', model: 'llama-3.1-70b' },
    summarization: { provider: 'openai_compatible', model: 'llama-3.1-8b' },
    classification:{ provider: 'openai_compatible', model: 'llama-3.1-8b' },
    embeddings:    { provider: 'openai_compatible', model: 'bge-m3' },
    ocr:           { provider: 'openai_compatible', model: 'llama-3.2-vision' },
    assignment:    { provider: 'openai_compatible', model: 'llama-3.1-8b' },
    conversation:  { provider: 'openai_compatible', model: 'llama-3.1-70b' },
  },
}

// ─── THE PRODUCER MODEL (W36) — the model is a PRODUCER'S choice where a slot is too coarse ────────
// A task slot serves many producers ('classification' carries the understanding, the work judge, the
// fulfillment judge and the room brief alike), and the measured model A/Bs split them: a cheaper model
// can be ≥ on one judgment and < on its neighbour. So a producer that NAMES ITSELF on its call (the same
// key as THE PRODUCER EFFORT — lib/ai/effort.ts EFFORT_PRODUCERS; aiCall's `shape.effortProducer`,
// getAIClient's `{ producer }` option) may be routed to its own model, per tier.
//
// THE PRECEDENCE (highest first; lib/ai/model-choice.ts resolveModelChoice is the one resolver):
//   1. tenant producer override — tenant_configs.model_overrides["producer:<key>"]
//   2. tier producer default    — PRODUCER_MODEL[tier][<key>] (below)
//   3. tenant slot override     — tenant_configs.model_overrides[<slot>]
//   4. tier slot default        — TIER_DEFAULTS[tier][<slot>]
// Each level layers over the ones beneath it (a `{ model }` entry keeps the slot's provider/baseURL); a
// producer-level entry that names ANOTHER provider starts fresh (never inherits a foreign baseURL).
// THE PERIMETER: on the EU tiers (bedrock_private, bedrock_optimised) a level whose resolved endpoint is
// not an EU-resident Bedrock model (lib/ai/bedrock-residency.ts) is REFUSED and the next level serves —
// no configuration can route an EU tenant's content out of the perimeter. The effort follows the
// RESOLVED model's family (PRODUCER_EFFORT is keyed by family), never the slot's.
//
// EMPTY on every tier: no production change. Adopting an entry is a measured, one-line decision
// (scripts/eval-outputs.ts on a probe account carrying the tenant producer override first).
export const PRODUCER_MODEL: Readonly<Record<TierType, Readonly<Partial<Record<EffortProducer, Partial<ModelEndpoint>>>>>> = Object.freeze({
  // W36 (Oct 1, owner-approved, measured — scratchpad/w36-split-std.md): Luna ≥ gpt-5-mini on fulfillment
  // (err .000 vs .042) and commitment extraction (F1 .974 vs .957), 2–5× cheaper; work.judge / room.brief stay.
  standard: Object.freeze({
    'commitments.fulfillment': { provider: 'openai' as const, model: 'gpt-6-luna' },
    'commitments.extract': { provider: 'openai' as const, model: 'gpt-6-luna' },
  }),
  professional: Object.freeze({}),
  bedrock_private: Object.freeze({}),
  // W36 (owner-approved, measured — scratchpad/w36-split-eu.md): gpt-oss-120b in-region Frankfurt beats
  // Haiku 4.5 on the work judge (work-verdict err .029 vs .091, input-ask .065 vs .195), ~5× cheaper.
  // Understanding (.939 on Haiku), fulfillment, extraction and room.brief stay on Haiku.
  bedrock_optimised: Object.freeze({
    'work.judge': { provider: 'bedrock' as const, model: 'openai.gpt-oss-120b-1:0' },
  }),
  private_client: Object.freeze({}),
  on_prem: Object.freeze({}),
})
