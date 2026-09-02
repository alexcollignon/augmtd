import OpenAI from 'openai'
import type { Chat } from 'openai/resources'
import { SupabaseClient } from '@supabase/supabase-js'
import type { TaskType, TierType, ModelEndpoint, TenantConfig, ResolvedClient } from './types'
import { TIER_DEFAULTS } from './defaults'
import { createBedrockAdapter } from './bedrock-adapter'

// ─── Tenant config cache ────────────────────────────────────────────────────────
// Module-level cache — persists for the lifetime of the server process.
// TTL: 5 minutes. Prevents a DB hit on every AI call.

const configCache = new Map<string, { config: TenantConfig; expiresAt: number }>()
const CONFIG_TTL_MS = 5 * 60 * 1000

async function getTenantConfig(userId: string, supabase: SupabaseClient): Promise<TenantConfig> {
  const cached = configCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.config

  // Fetch tenant config and workspace tier in parallel.
  // Workspace tier (set by superadmin) takes precedence over any personal tier setting.
  const [{ data: tcData }, { data: memberData }] = await Promise.all([
    supabase
      .from('tenant_configs')
      .select('tier, model_overrides, endpoints, encrypted_api_keys, audit_logging, model_version_pinning')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('company_members')
      .select('companies(ai_tier)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  ])

  const companyAiTier = (memberData?.companies as any)?.ai_tier as TierType | null | undefined

  // THE RETIRED-TIER GUARD (Aug 19): `private_shared` (the third-party OSS tier) was removed from
  // the codebase; the DB CHECK constraints still accept the value, so a stray row must resolve to a
  // REAL tier rather than crash on TIER_DEFAULTS[undefined]. The only honest landing is the private
  // Bedrock tier — never the standard default (that would be a silent privacy downgrade).
  const rawTier = (companyAiTier ?? (tcData?.tier as string | undefined) ?? 'standard') as string
  const tier: TierType = rawTier in TIER_DEFAULTS ? (rawTier as TierType) : 'bedrock_optimised'
  if (tier !== rawTier) console.warn(`[AI] retired tier '${rawTier}' for user ${userId.slice(0, 8)} → serving bedrock_optimised`)

  const config: TenantConfig = {
    userId,
    tier,
    modelOverrides: tcData?.model_overrides ?? {},
    endpoints: tcData?.endpoints ?? {},
    encryptedApiKeys: tcData?.encrypted_api_keys ?? {},
    auditLogging: tcData?.audit_logging ?? false,
    modelVersionPinning: tcData?.model_version_pinning ?? false,
  }

  configCache.set(userId, { config, expiresAt: Date.now() + CONFIG_TTL_MS })
  return config
}

// ─── OpenAI client cache ────────────────────────────────────────────────────────
// One client instance per unique endpoint. Reused across requests.

const clientCache = new Map<string, OpenAI>()

// ─── THE MODEL PARAM FLOOR (Aug 31) ─────────────────────────────────────────────
// Current-generation models reject the classic completion params, and 23 call sites
// invoke chat.completions.create directly (streaming included) — so the rewrite lives
// on the client itself, not in aiCreate: one transport-layer fix for every site, the
// same pattern as the response_format strip. Two families, proven live:
//  • gpt-5 family: `max_tokens` must be `max_completion_tokens`; `temperature`/`top_p`
//    are fixed (400 on any non-default); reasons by default — on JSON-shaped prompts
//    with small budgets the reasoning channel eats the tokens and content comes back
//    empty (the Kimi lesson, lib/ai/call.ts), so `reasoning_effort` defaults to
//    'minimal' (our prompts were written for non-reasoning models); a caller that
//    wants depth passes its own value.
//  • Claude 4.7+/5 family (sonnet-5, opus-5/4-8/4-7, fable-5): sampling params were
//    removed — `temperature` returns 400 "deprecated for this model" (observed live
//    on claude-sonnet-5, Aug 31). Haiku 4.5 / Sonnet 4.6 still accept them.
const CLAUDE_NO_SAMPLING_RE = /^claude-(sonnet-5|opus-5|opus-4-[78]|fable-5)/
function withModelParamFloor(client: OpenAI): OpenAI {
  const completions = client.chat.completions
  const orig = completions.create.bind(completions)
  ;(completions as { create: unknown }).create = (params: { model?: unknown; [k: string]: unknown }, opts?: unknown) => {
    const model = typeof params?.model === 'string' ? params.model : ''
    if (model.startsWith('gpt-5')) {
      const p = { ...params }
      if (p.max_tokens != null && p.max_completion_tokens == null) {
        p.max_completion_tokens = p.max_tokens
        delete p.max_tokens
      }
      delete p.temperature
      delete p.top_p
      if (p.reasoning_effort == null) p.reasoning_effort = 'minimal'
      return (orig as (p: unknown, o?: unknown) => unknown)(p, opts)
    }
    if (CLAUDE_NO_SAMPLING_RE.test(model)) {
      const p = { ...params }
      delete p.temperature
      delete p.top_p
      // These models think ADAPTIVELY by default and thinking tokens count against
      // max_tokens: a big synthesis step burned all 12k thinking and returned EMPTY with
      // finish=length (guardrails G5, live Aug 31–Sep 1). 'none' asks for no thinking,
      // but the compat endpoint treats it as a HINT — the burn was still observed with
      // it set, so the real protection is the caller's budget (see THE PER-PROVIDER
      // REASONING BUDGET in execute-step.ts). The hint stays because it is accepted,
      // harmless, and matches what every prompt here was written for (Sonnet 4.6 on the
      // old standard tier never thought). A caller wanting depth passes its own value.
      if (p.reasoning_effort == null) p.reasoning_effort = 'none'
      return (orig as (p: unknown, o?: unknown) => unknown)(p, opts)
    }
    return (orig as (p: unknown, o?: unknown) => unknown)(params, opts)
  }
  return client
}

function buildClient(endpoint: ModelEndpoint, config: TenantConfig): OpenAI {
  const cacheKey = endpoint.baseURL ?? endpoint.provider

  if (!clientCache.has(cacheKey)) {
    // Bedrock uses its own SDK with AWS SigV4 auth — wrap in OpenAI-compat adapter
    if (endpoint.provider === 'bedrock') {
      const adapter = createBedrockAdapter({
        awsRegion: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
        awsAccessKey: process.env.AWS_BEDROCK_ACCESS_KEY,
        awsSecretKey: process.env.AWS_BEDROCK_SECRET_KEY,
      })
      clientCache.set(cacheKey, adapter)
      return clientCache.get(cacheKey)!
    }

    const apiKey = resolveApiKey(endpoint, config)
    const defaultHeaders: Record<string, string> = {}

    if (endpoint.provider === 'anthropic') {
      // Anthropic's OpenAI-compatible endpoint requires this header
      defaultHeaders['anthropic-version'] = '2023-06-01'
      defaultHeaders['x-api-key'] = apiKey
    }

    if (endpoint.provider === 'azure_openai' && endpoint.apiVersion) {
      defaultHeaders['api-key'] = apiKey
    }

    clientCache.set(cacheKey, withModelParamFloor(new OpenAI({
      apiKey,
      baseURL: endpoint.baseURL,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
      defaultQuery: endpoint.provider === 'azure_openai' && endpoint.apiVersion
        ? { 'api-version': endpoint.apiVersion }
        : undefined,
    })))
  }

  return clientCache.get(cacheKey)!
}

function resolveApiKey(endpoint: ModelEndpoint, config: TenantConfig): string {
  // Bedrock uses AWS IAM credentials, not API keys
  if (endpoint.provider === 'bedrock') return ''

  // Private client/on-prem: use tenant's own API key if provided
  if (config.encryptedApiKeys?.ai) return config.encryptedApiKeys.ai

  // Provider-specific platform keys
  switch (endpoint.provider) {
    case 'anthropic':     return process.env.ANTHROPIC_API_KEY ?? ''
    case 'azure_openai':  return process.env.AZURE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
    case 'openai_compatible': return process.env.OPENAI_API_KEY ?? ''
    default:              return process.env.OPENAI_API_KEY ?? ''
  }
}

// ─── Endpoint resolution ────────────────────────────────────────────────────────
// Merges tier default with tenant overrides and dynamic endpoints.

function resolveEndpoint(task: TaskType, config: TenantConfig): ModelEndpoint {
  const tierDefault = TIER_DEFAULTS[config.tier][task]
  const override = config.modelOverrides?.[task] ?? {}

  // Merge: override wins over tier default
  const endpoint: ModelEndpoint = { ...tierDefault, ...override }

  // For private tiers without a baked-in baseURL, inject from tenant endpoints config
  // (never for Bedrock — it has no baseURL; SigV4 + region, built in buildClient).
  if (endpoint.provider !== 'bedrock' && !endpoint.baseURL && config.endpoints?.ai) {
    endpoint.baseURL = endpoint.model.includes('bge') || endpoint.model.includes('embed')
      ? (config.endpoints.embeddings ?? config.endpoints.ai)
      : config.endpoints.ai
  }

  return endpoint
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a configured OpenAI-SDK client and model name for the given task.
 * Respects the user's tier and any per-task model overrides.
 *
 * All providers (OpenAI, Anthropic, Azure, private) are accessed through the
 * OpenAI SDK — they all expose OpenAI-compatible endpoints.
 *
 * Usage:
 *   const { client, model } = await getAIClient(userId, 'planning', supabase)
 *   const res = await client.chat.completions.create({ model, messages, ... })
 */
export async function getAIClient(
  userId: string,
  task: TaskType,
  supabase: SupabaseClient
): Promise<ResolvedClient> {
  const config = await getTenantConfig(userId, supabase)
  const endpoint = resolveEndpoint(task, config)
  const client = buildClient(endpoint, config)
  console.log(`[AI] task=${task} tier=${config.tier} model=${endpoint.model} user=${userId.slice(0, 8)}`)
  return { client, model: endpoint.model, endpoint, tier: config.tier }
}

/**
 * System-level client — ONLY for work with genuinely no user (no userId anywhere in scope).
 * Always uses platform defaults (standard tier = OpenAI/Anthropic US).
 *
 * ⚠️ THE TIER LEAK (Aug 19): every call site that HAS a user must use `getAIClient(userId, …)` —
 * the standard-tier default here silently sent privacy-tier tenants' background work (brief
 * synthesis, briefings, memory rendering, alignment) to OpenAI/Anthropic, breaking the sovereignty
 * premise the company's `ai_tier` exists to keep. `scripts/smoke-tier-routing.ts` allowlists the
 * files that may call this; adding a caller = adding it there, with the reason.
 */
export function getSystemClient(task: TaskType): ResolvedClient {
  const endpoint = TIER_DEFAULTS['standard'][task]
  const fakeConfig: TenantConfig = {
    userId: 'system',
    tier: 'standard',
    modelOverrides: {},
    endpoints: {},
    encryptedApiKeys: {},
    auditLogging: false,
    modelVersionPinning: false,
  }
  const client = buildClient(endpoint, fakeConfig)
  return { client, model: endpoint.model, endpoint, tier: 'standard' }
}

/**
 * Invalidate cached config for a user — call after updating tenant_configs.
 */
export function invalidateTenantConfig(userId: string): void {
  configCache.delete(userId)
}

/**
 * Client for an explicit endpoint, platform credentials — the superadmin status page's
 * probe door. Rides the SAME buildClient as production traffic (param floor included),
 * so a probe result is evidence about the real transport, not a lookalike.
 */
export function getEndpointClient(endpoint: ModelEndpoint): OpenAI {
  const systemConfig: TenantConfig = {
    userId: 'system', tier: 'standard', modelOverrides: {}, endpoints: {},
    encryptedApiKeys: {}, auditLogging: false, modelVersionPinning: false,
  }
  return buildClient(endpoint, systemConfig)
}

// ─── AI completion helper ───────────────────────────────────────────────────────

/**
 * Wraps OpenAI chat completions with retry logic for rate limits and server errors.
 * Use this instead of calling client.chat.completions.create() directly.
 *
 * 429: reads retry-after header, waits up to 30s, retries up to 3 times.
 * 529/500: single retry after 5s (transient capacity spike).
 */
export async function aiCreate(
  client: OpenAI,
  params: Omit<Parameters<OpenAI['chat']['completions']['create']>[0], 'stream'> & { stream?: false }
): Promise<OpenAI.Chat.ChatCompletion> {
  const MAX_429_RETRIES = 3
  let attempt = 0

  // Anthropic's OpenAI-compat endpoint stopped accepting response_format {type:'json_object'}
  // (400 "Input should be 'json_schema'" — observed live Aug 10, broke EVERY json-shaped call
  // routed to Claude). Claude emits clean-or-fenced JSON when the prompt asks; the parsers
  // already strip fences (the Bedrock-Haiku lesson). One transport-layer strip fixes all sites.
  if (String((client as { baseURL?: string }).baseURL ?? '').includes('anthropic.com')
    && (params as { response_format?: { type?: string } }).response_format?.type === 'json_object') {
    params = { ...params }
    delete (params as { response_format?: unknown }).response_format
  }

  while (true) {
    try {
      return await client.chat.completions.create({ ...params, stream: false }) as OpenAI.Chat.ChatCompletion
    } catch (err: any) {
      if (err?.status === 529 || err?.status === 500) {
        await new Promise((r) => setTimeout(r, 5000))
        return await client.chat.completions.create({ ...params, stream: false }) as OpenAI.Chat.ChatCompletion
      }
      if (err?.status === 429 && attempt < MAX_429_RETRIES) {
        attempt++
        const retryAfter = parseInt(err?.headers?.['retry-after'] ?? '0', 10)
        const waitMs = Math.min(retryAfter > 0 ? retryAfter * 1000 : 15000, 30000)
        console.warn(`[aiCreate] 429 rate limited — waiting ${waitMs / 1000}s (attempt ${attempt}/${MAX_429_RETRIES})`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      throw err
    }
  }
}
