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

  const config: TenantConfig = {
    userId,
    tier: companyAiTier ?? (tcData?.tier as TierType) ?? 'standard',
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

    clientCache.set(cacheKey, new OpenAI({
      apiKey,
      baseURL: endpoint.baseURL,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
      defaultQuery: endpoint.provider === 'azure_openai' && endpoint.apiVersion
        ? { 'api-version': endpoint.apiVersion }
        : undefined,
    }))
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
    case 'openai_compatible': return process.env.AUGMTD_AI_KEY ?? process.env.OPENAI_API_KEY ?? ''
    case 'together':      return process.env.AUGMTD_AI_KEY ?? ''
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
