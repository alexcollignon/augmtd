import type { TaskType, TierType, ModelEndpoint } from './types'

// ─── Tier defaults ──────────────────────────────────────────────────────────────
// One model per task per tier. These are the baseline — tenant modelOverrides
// layer on top at runtime.
//
// All tiers use OpenAI-compatible API format.
// - standard:        api.openai.com + api.anthropic.com (via compat endpoint)
// - professional:    Azure OpenAI (baseURL + apiVersion set per tenant)
// - private_shared:  AUGMTD-managed Modal endpoints (env vars)
// - private_client:  Client-provided endpoints (tenant_configs.endpoints)
// - on_prem:         Same as private_client, different auth

export const TIER_DEFAULTS: Record<TierType, Record<TaskType, ModelEndpoint>> = {
  // ── Standard — current production setup ──────────────────────────────────────
  standard: {
    planning:      { provider: 'openai',     model: 'gpt-4o-mini' },
    generation:    { provider: 'anthropic',  model: 'claude-haiku-4-5-20251001',
                     baseURL: 'https://api.anthropic.com/v1' },
    summarization: { provider: 'openai',     model: 'gpt-4o-mini' },
    classification:{ provider: 'openai',     model: 'gpt-4o-mini' },
    embeddings:    { provider: 'bedrock',    model: 'cohere.embed-multilingual-v3', dimensions: 1024 },
    ocr:           { provider: 'openai',     model: 'gpt-4o' },
    assignment:    { provider: 'openai',     model: 'gpt-4o-mini' },
    conversation:  { provider: 'anthropic',  model: 'claude-sonnet-4-6',
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

  // ── Private shared — Together AI (fully private, no data leaves to OpenAI/Anthropic)
  // Kimi K2.6 for planning/generation/conversation (same model as before, now on Together AI).
  // gpt-oss-120b for classification/summarization/assignment (same model, Together AI host).
  // Gemma 4 31B for OCR — best available vision model on Together AI.
  // Embeddings on Bedrock EU (Cohere Embed Multilingual v3) — THE PRIVACY PREMISE: no document leaves the private
  // perimeter to be vectorised (Together AI embeddings dropped Aug 19).
  private_shared: {
    planning:      { provider: 'together', model: 'moonshotai/Kimi-K2.6',
                     baseURL: 'https://api.together.xyz/v1' },
    generation:    { provider: 'together', model: 'moonshotai/Kimi-K2.6',
                     baseURL: 'https://api.together.xyz/v1' },
    summarization: { provider: 'together', model: 'openai/gpt-oss-120b',
                     baseURL: 'https://api.together.xyz/v1' },
    classification:{ provider: 'together', model: 'openai/gpt-oss-120b',
                     baseURL: 'https://api.together.xyz/v1' },
    embeddings:    { provider: 'bedrock',  model: 'cohere.embed-multilingual-v3', dimensions: 1024 },
    ocr:           { provider: 'together', model: 'google/gemma-4-31B-it',
                     baseURL: 'https://api.together.xyz/v1' },
    assignment:    { provider: 'together', model: 'openai/gpt-oss-120b',
                     baseURL: 'https://api.together.xyz/v1' },
    conversation:  { provider: 'together', model: 'moonshotai/Kimi-K2.6',
                     baseURL: 'https://api.together.xyz/v1' },
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
  //     never Opus. (July 2026: replaced the Together AI split — Kimi/gpt-oss — so no prompt leaves
  //     Bedrock; also removes the reasoning-channel trap from this tier entirely.)
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
