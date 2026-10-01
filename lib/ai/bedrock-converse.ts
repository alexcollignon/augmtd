/**
 * Bedrock Converse path (W31) — the NON-Anthropic half of the Bedrock adapter.
 *
 * The EU tier's perimeter is Bedrock in eu-central-1. Claude rides the Anthropic Messages API
 * (bedrock-adapter.ts, unchanged); every other Bedrock model — OpenAI's open-weight gpt-oss first,
 * Amazon Nova / Qwen next by config — rides the model-agnostic Converse API, translated here to and
 * from the OpenAI chat.completions shape every call site already speaks.
 *
 *  • params → Converse: system messages → `system`, user/assistant/tool → alternating `messages`
 *    (tool calls → toolUse, tool results → toolResult), max_tokens | max_completion_tokens →
 *    inferenceConfig.maxTokens (capped at the family's output ceiling), temperature/top_p/stop →
 *    inferenceConfig, tools/tool_choice → toolConfig, response_format json_object → a system
 *    instruction (Converse has no JSON mode) + fence strip on the answer.
 *  • THE REASONING NEVER LEAKS: gpt-oss returns a `reasoningContent` block before the answer. Only
 *    `text` / `toolUse` blocks are read; reasoning deltas are dropped in streaming; an inline
 *    `<reasoning>…</reasoning>` preamble (the InvokeModel shape) is stripped defensively.
 *  • usage: inputTokens/outputTokens → prompt_tokens/completion_tokens (logAIUsage reads these); the
 *    reasoning share is reported as OpenAI's `completion_tokens_details.reasoning_tokens`, estimated
 *    (~4 chars/token) from the dropped reasoning text, flagged `reasoning_estimated`.
 *  • THE FLOOR (effort): a family with a reasoning lever gets `reasoning_effort` in
 *    additionalModelRequestFields — the caller's (applyEffort's) value, else 'low' + GPT_OSS_HEADROOM
 *    so a tight judgment budget never starves into empty JSON.
 *  • Streaming: ConverseStream → OpenAI chunks (text + tool-call deltas + a final usage chunk).
 */

import { ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime'
import { GPT_OSS_HEADROOM, gptOssReasoningValue } from './effort'

/** The minimal transport this path needs (BedrockRuntimeClient satisfies it; tests stub it). */
export interface ConverseSender {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<any>
}

// ─── Model families (config, not code paths) ─────────────────────────────────────────────────────
interface ConverseFamily {
  name: string
  re: RegExp
  /** additionalModelRequestFields key carrying the effort (absent = no reasoning lever). */
  effortField?: string
  /** Hard output ceiling (maxTokens is capped to it). */
  maxOutput: number
  /** Does the family reason before answering (reasoning blocks to strip, budget floor to add)? */
  reasons: boolean
}

export const CONVERSE_FAMILIES: readonly ConverseFamily[] = Object.freeze([
  // Proven live (eu-central-1, in-region): max output 16K per the model card.
  { name: 'gpt-oss', re: /(^|\.)openai\.gpt-oss-/, effortField: 'reasoning_effort', maxOutput: 16384, reasons: true },
  // Next by config — NOT yet proven live; no effort lever sent until measured.
  { name: 'nova', re: /(^|\.)amazon\.nova-/, maxOutput: 10000, reasons: false },
  { name: 'qwen', re: /(^|\.)qwen\./, maxOutput: 16384, reasons: false },
])

const GENERIC_FAMILY: ConverseFamily = { name: 'generic', re: /./, maxOutput: 8192, reasons: false }

export function converseFamilyOf(model: string): ConverseFamily {
  return CONVERSE_FAMILIES.find((f) => f.re.test(model)) ?? GENERIC_FAMILY
}

/** Anthropic models stay on the Messages API path; everything else rides Converse. Embedding models
 *  never reach chat.completions. */
export function isConverseModel(model: unknown): boolean {
  const m = typeof model === 'string' ? model : ''
  return !!m && !/(^|\.)anthropic\.|^claude-/.test(m)
}

const JSON_INSTRUCTION = 'You must respond with valid JSON only. No other text, no markdown fences.'
const DEFAULT_MAX = 4096

// ─── Request translation ─────────────────────────────────────────────────────────────────────────

export function buildConverseRequest(params: any): Record<string, unknown> {
  const model = String(params.model)
  const family = converseFamilyOf(model)
  const { system, messages } = translateToConverse(params.messages ?? [])
  if (params.response_format?.type === 'json_object' || params.response_format?.type === 'json_schema') system.push(JSON_INSTRUCTION)

  // The effort: the caller's / applyEffort's `reasoning_effort` (it already added its headroom), else
  // the family floor — 'low' plus GPT_OSS_HEADROOM.low, so the reasoning block never eats the answer.
  let maxTokens = Number(params.max_completion_tokens ?? params.max_tokens ?? DEFAULT_MAX)
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) maxTokens = DEFAULT_MAX
  const additional: Record<string, unknown> = {}
  if (family.effortField) {
    const stated = typeof params.reasoning_effort === 'string' ? params.reasoning_effort : null
    if (!stated) maxTokens += GPT_OSS_HEADROOM.low
    additional[family.effortField] = gptOssReasoningValue(stated ?? 'low')
  }
  maxTokens = Math.min(Math.floor(maxTokens), family.maxOutput)

  const inferenceConfig: Record<string, unknown> = { maxTokens }
  if (typeof params.temperature === 'number') inferenceConfig.temperature = params.temperature
  if (typeof params.top_p === 'number') inferenceConfig.topP = params.top_p
  const stop = params.stop == null ? [] : Array.isArray(params.stop) ? params.stop : [params.stop]
  if (stop.length) inferenceConfig.stopSequences = stop.filter((s: unknown) => typeof s === 'string' && s).slice(0, 4)

  const toolConfig = translateToolConfig(params.tools, params.tool_choice, messages)

  return {
    modelId: model,
    messages,
    ...(system.length ? { system: system.map((text) => ({ text })) } : {}),
    inferenceConfig,
    ...(toolConfig ? { toolConfig } : {}),
    ...(Object.keys(additional).length ? { additionalModelRequestFields: additional } : {}),
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === 'text' ? b.text ?? '' : b?.type === 'image_url' ? '[image omitted: this model is text-only]' : '')).filter(Boolean).join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

function translateToConverse(openaiMessages: any[]): { system: string[]; messages: any[] } {
  const system: string[] = []
  const mapped: any[] = []
  for (const msg of openaiMessages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const t = textOf(msg.content)
      if (t) system.push(t)
      continue
    }
    if (msg.role === 'assistant') {
      const content: any[] = []
      const t = textOf(msg.content)
      if (t) content.push({ text: t })
      for (const tc of msg.tool_calls ?? []) {
        content.push({ toolUse: { toolUseId: tc.id, name: tc.function?.name, input: safeJsonParse(tc.function?.arguments ?? '{}') } })
      }
      if (content.length) mapped.push({ role: 'assistant', content })
      continue
    }
    if (msg.role === 'tool') {
      mapped.push({ role: 'user', content: [{ toolResult: { toolUseId: msg.tool_call_id, content: [{ text: textOf(msg.content) || '(empty)' }] } }] })
      continue
    }
    if (msg.role === 'user') {
      const t = textOf(msg.content)
      mapped.push({ role: 'user', content: [{ text: t || '(empty)' }] })
    }
  }
  // Converse requires alternating roles — merge consecutive same-role turns.
  const merged: any[] = []
  for (const m of mapped) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === m.role) prev.content = [...prev.content, ...m.content]
    else merged.push({ role: m.role, content: [...m.content] })
  }
  // Converse requires the conversation to open on a user turn.
  if (!merged.length || merged[0].role !== 'user') merged.unshift({ role: 'user', content: [{ text: 'Begin.' }] })
  return { system, messages: merged }
}

function translateToolConfig(tools: any[] | undefined, toolChoice: any, messages: any[]): Record<string, unknown> | null {
  const specs = (tools ?? []).filter((t: any) => t?.function?.name).map((t: any) => ({
    toolSpec: { name: t.function.name, description: t.function.description || t.function.name, inputSchema: { json: t.function.parameters ?? { type: 'object', properties: {} } } },
  }))
  if (!specs.length) {
    // Converse rejects toolUse/toolResult history without a toolConfig — declare the names it used.
    const used = new Set<string>()
    for (const m of messages) for (const b of m.content) if (b.toolUse?.name) used.add(b.toolUse.name)
    if (!used.size) return null
    return { tools: [...used].map((name) => ({ toolSpec: { name, description: name, inputSchema: { json: { type: 'object', properties: {} } } } })) }
  }
  let choice: Record<string, unknown> | undefined
  if (toolChoice === 'required') choice = { any: {} }
  else if (toolChoice && typeof toolChoice === 'object' && toolChoice.type === 'function') choice = { tool: { name: toolChoice.function.name } }
  else if (toolChoice === 'auto') choice = { auto: {} }
  // 'none' → tools stay declared (history may reference them), no forced choice.
  return { tools: specs, ...(choice ? { toolChoice: choice } : {}) }
}

// ─── Response translation ────────────────────────────────────────────────────────────────────────

/** Drop an inline reasoning preamble (the InvokeModel shape) — the answer only, never the thinking. */
export function stripInlineReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').replace(/^[\s\S]*<\/reasoning>/i, '').trim()
}

/** JSON mode: unwrap a fenced object so JSON.parse callers read it directly. */
function unfence(text: string): string {
  const m = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return m ? m[1].trim() : text
}

function mapStop(reason: string | undefined): string {
  switch (reason) {
    case 'tool_use': return 'tool_calls'
    case 'max_tokens': return 'length'
    case 'guardrail_intervened':
    case 'content_filtered': return 'content_filter'
    default: return 'stop'
  }
}

function usageOf(u: any, reasoningChars: number): Record<string, unknown> {
  const inp = u?.inputTokens ?? 0
  const out = u?.outputTokens ?? 0
  return {
    prompt_tokens: inp,
    completion_tokens: out,
    total_tokens: u?.totalTokens ?? inp + out,
    ...(reasoningChars > 0 ? { completion_tokens_details: { reasoning_tokens: Math.min(out, Math.ceil(reasoningChars / 4)), reasoning_estimated: true } } : {}),
  }
}

export function converseResponseToOpenAI(response: any, params: any): any {
  const texts: string[] = []
  const toolCalls: any[] = []
  let reasoningChars = 0
  for (const block of response?.output?.message?.content ?? []) {
    if (typeof block.text === 'string') texts.push(block.text)
    else if (block.toolUse) {
      toolCalls.push({ id: block.toolUse.toolUseId, type: 'function', index: toolCalls.length, function: { name: block.toolUse.name, arguments: JSON.stringify(block.toolUse.input ?? {}) } })
    } else if (block.reasoningContent) {
      reasoningChars += String(block.reasoningContent.reasoningText?.text ?? '').length
    }
  }
  let text = stripInlineReasoning(texts.join(''))
  if (params.response_format?.type === 'json_object' || params.response_format?.type === 'json_schema') text = unfence(text)
  return {
    id: response?.$metadata?.requestId ?? `bedrock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: params.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: mapStop(response?.stopReason),
    }],
    usage: usageOf(response?.usage, reasoningChars),
  }
}

// ─── Calls ───────────────────────────────────────────────────────────────────────────────────────

export async function converseNonStreaming(client: ConverseSender, params: any, opts?: { signal?: AbortSignal }): Promise<any> {
  const res = await client.send(new ConverseCommand(buildConverseRequest(params) as any), opts?.signal ? { abortSignal: opts.signal } : undefined)
  return converseResponseToOpenAI(res, params)
}

export async function converseStreaming(client: ConverseSender, params: any, opts?: { signal?: AbortSignal }): Promise<AsyncIterable<any>> {
  const res = await client.send(new ConverseStreamCommand(buildConverseRequest(params) as any), opts?.signal ? { abortSignal: opts.signal } : undefined)
  return converseStreamToOpenAI(res?.stream ?? [], String(params.model))
}

function chunk(id: string, model: string, delta: any, finish: string | null = null, usage?: any): any {
  return { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) }
}

export async function* converseStreamToOpenAI(stream: AsyncIterable<any>, model: string): AsyncIterable<any> {
  const id = `bedrock-${Date.now()}`
  let toolIndex = -1
  let reasoningChars = 0
  let finish: string | null = null
  let inReasoningTag = false
  for await (const ev of stream) {
    if (ev.contentBlockStart?.start?.toolUse) {
      const tu = ev.contentBlockStart.start.toolUse
      toolIndex++
      yield chunk(id, model, { tool_calls: [{ index: toolIndex, id: tu.toolUseId, type: 'function', function: { name: tu.name, arguments: '' } }] })
    } else if (ev.contentBlockDelta?.delta) {
      const d = ev.contentBlockDelta.delta
      if (d.reasoningContent) { reasoningChars += String(d.reasoningContent.text ?? '').length; continue } // never surfaced
      if (typeof d.text === 'string') {
        // Defensive: an inline <reasoning>…</reasoning> run inside text deltas is dropped too.
        let t = d.text
        if (inReasoningTag || /<reasoning>/i.test(t)) {
          const closeAt = t.search(/<\/reasoning>/i)
          if (closeAt >= 0) { inReasoningTag = false; t = t.slice(closeAt + '</reasoning>'.length) }
          else { inReasoningTag = true; reasoningChars += t.length; continue }
        }
        if (t) yield chunk(id, model, { content: t })
      } else if (d.toolUse) {
        yield chunk(id, model, { tool_calls: [{ index: toolIndex, function: { arguments: d.toolUse.input ?? '' } }] })
      }
    } else if (ev.messageStop) {
      finish = mapStop(ev.messageStop.stopReason)
    } else if (ev.metadata) {
      yield chunk(id, model, {}, finish ?? 'stop', usageOf(ev.metadata.usage, reasoningChars))
      finish = null
    } else {
      const err = ev.internalServerException ?? ev.modelStreamErrorException ?? ev.validationException ?? ev.throttlingException ?? ev.serviceUnavailableException
      if (err) throw Object.assign(new Error(err.message ?? 'bedrock stream error'), { status: ev.throttlingException ? 429 : 500 })
    }
  }
  if (finish) yield chunk(id, model, {}, finish)
}

function safeJsonParse(str: string): any {
  try { return JSON.parse(str) } catch { return {} }
}
