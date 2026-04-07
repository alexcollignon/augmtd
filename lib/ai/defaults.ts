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
    embeddings:    { provider: 'openai',     model: 'text-embedding-3-small', dimensions: 1024 },
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

  // ── Private shared — Fireworks AI (fully private, no data leaves to OpenAI/Anthropic)
  // Kimi K2 Instruct for planning/generation/conversation (stronger than DeepSeek V3.2 on agentic/coding).
  // Llama-3.3-70B for classification/summarization/assignment.
  // Qwen3-VL-30B for OCR — real vision model (replaced Together AI's text-only Qwen3.5-9B stopgap).
  // Embeddings stay on Together AI — switching would require re-indexing all KB content.
  private_shared: {
    planning:      { provider: 'fireworks', model: 'accounts/fireworks/models/kimi-k2-instruct-0905',
                     baseURL: 'https://api.fireworks.ai/inference/v1' },
    generation:    { provider: 'fireworks', model: 'accounts/fireworks/models/kimi-k2-instruct-0905',
                     baseURL: 'https://api.fireworks.ai/inference/v1' },
    summarization: { provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
                     baseURL: 'https://api.fireworks.ai/inference/v1' },
    classification:{ provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
                     baseURL: 'https://api.fireworks.ai/inference/v1' },
    embeddings:    { provider: 'openai_compatible', model: 'intfloat/multilingual-e5-large-instruct',
                     baseURL: 'https://api.together.xyz/v1' },
    ocr:           { provider: 'fireworks', model: 'accounts/fireworks/models/qwen3-vl-30b-a3b-instruct',
                     baseURL: 'https://api.fireworks.ai/inference/v1' },
    assignment:    { provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
                     baseURL: 'https://api.fireworks.ai/inference/v1' },
    conversation:  { provider: 'fireworks', model: 'accounts/fireworks/models/kimi-k2-instruct-0905',
                     baseURL: 'https://api.fireworks.ai/inference/v1' },
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
