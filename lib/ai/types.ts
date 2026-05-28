// ─── Task types ────────────────────────────────────────────────────────────────
// Every AI call in the codebase maps to one of these task types.
// The factory uses the task to resolve the right model + endpoint for the tenant.

export type TaskType =
  | 'planning'       // Workflow plan generation, streaming chat
  | 'generation'     // Document / spreadsheet / presentation assembly
  | 'summarization'  // KB doc summaries, meeting prep, email analysis
  | 'classification' // Email work state, signals, recipient detection, work decomposition
  | 'embeddings'     // KB indexing, semantic search, workflow ranking
  | 'ocr'            // Image and scanned-PDF text extraction
  | 'assignment'     // KB file-to-input slot assignment, workflow suggestion
  | 'conversation'   // Inbox chat assistant, artifact ask mode

// ─── Tier types ────────────────────────────────────────────────────────────────

export type TierType =
  | 'standard'          // OpenAI / Anthropic APIs — no privacy guarantees
  | 'professional'      // Azure OpenAI / AWS Bedrock — contractual privacy, EU residency
  | 'private_shared'    // AUGMTD-managed private GPU infra (Modal) — open source models
  | 'bedrock_private'    // AWS Bedrock + Claude Haiku 4.5 — structural isolation, SOC2/HIPAA
  | 'bedrock_optimised' // Bedrock (chat/gen/ocr) + Fireworks (email/background) — cost-optimised hybrid
  | 'private_client'    // Client's own cloud (AWS/Azure/GCP) — AUGMTD orchestrates
  | 'on_prem'           // Client's own hardware — air-gapped

// ─── Model endpoint ─────────────────────────────────────────────────────────────

export type ProviderType =
  | 'openai'            // api.openai.com
  | 'anthropic'         // api.anthropic.com (via OpenAI-compat endpoint)
  | 'azure_openai'      // {resource}.openai.azure.com
  | 'openai_compatible' // Any OpenAI-compatible endpoint (vLLM, Ollama, Modal, etc.)
  | 'together'          // api.together.xyz — serverless OSS models
  | 'bedrock'           // AWS Bedrock — structural data isolation, SigV4 auth

export interface ModelEndpoint {
  provider: ProviderType
  model: string           // Model name / deployment name
  baseURL?: string        // Override base URL (required for azure, openai_compatible)
  apiVersion?: string     // Azure: '2024-02-01'
  maxTokensDefault?: number
  dimensions?: number     // Embeddings output dimension (OpenAI supports truncation via this param)
}

// ─── Tenant config ──────────────────────────────────────────────────────────────

export interface TenantConfig {
  userId: string
  tier: TierType
  // Per-task model overrides — applied on top of tier defaults
  modelOverrides: Partial<Record<TaskType, Partial<ModelEndpoint>>>
  // Named endpoints for private tiers (e.g. { ai: 'http://...', embeddings: 'http://...' })
  endpoints: Record<string, string>
  // Encrypted API keys for client-managed deployments
  encryptedApiKeys: Record<string, string>
  // Enterprise compliance features
  auditLogging: boolean
  modelVersionPinning: boolean
}

// ─── Factory return type ────────────────────────────────────────────────────────

import type OpenAI from 'openai'

export interface ResolvedClient {
  client: OpenAI
  model: string
  endpoint: ModelEndpoint
}
