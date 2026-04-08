/**
 * Bedrock Adapter — duck-types as OpenAI client for AWS Bedrock + Claude.
 *
 * Translates OpenAI chat.completions.create() calls to Anthropic Messages API
 * format, using @anthropic-ai/bedrock-sdk for AWS SigV4 authentication.
 *
 * All existing call sites (streaming, non-streaming, tool calls, vision) work
 * unchanged — the adapter handles format translation transparently.
 */

import AnthropicBedrock from '@anthropic-ai/bedrock-sdk'
import type OpenAI from 'openai'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BedrockConfig {
  awsRegion: string
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createBedrockAdapter(config: BedrockConfig): OpenAI {
  const opts: Record<string, any> = { awsRegion: config.awsRegion }
  if (config.awsAccessKey) opts.awsAccessKey = config.awsAccessKey
  if (config.awsSecretKey) opts.awsSecretKey = config.awsSecretKey
  if (config.awsSessionToken) opts.awsSessionToken = config.awsSessionToken
  const bedrock = new AnthropicBedrock(opts as any)

  const adapter = {
    chat: {
      completions: {
        create: (params: any) => {
          if (params.stream) {
            return handleStreaming(bedrock, params)
          }
          return handleNonStreaming(bedrock, params)
        },
      },
    },
  }

  return adapter as unknown as OpenAI
}

// ─── Non-streaming ────────────────────────────────────────────────────────────

async function handleNonStreaming(bedrock: AnthropicBedrock, params: any): Promise<any> {
  const { system, messages } = translateMessages(params.messages)

  // Anthropic has no response_format — inject JSON instruction into system prompt
  let systemFinal = system
  if (params.response_format?.type === 'json_object') {
    systemFinal = (systemFinal ? systemFinal + '\n\n' : '') +
      'You must respond with valid JSON only. No other text, no markdown fences.'
  }

  const response = await bedrock.messages.create({
    model: params.model,
    max_tokens: params.max_tokens ?? 4096,
    ...(systemFinal ? { system: systemFinal } : {}),
    messages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(translateTools(params.tools) ? { tools: translateTools(params.tools)! } : {}),
    ...(params.tool_choice ? { tool_choice: translateToolChoice(params.tool_choice) } : {}),
  })

  return anthropicResponseToOpenAI(response, params.model)
}

// ─── Streaming ────────────────────────────────────────────────────────────────

async function handleStreaming(bedrock: AnthropicBedrock, params: any): Promise<AsyncIterable<any>> {
  const { system, messages } = translateMessages(params.messages)

  let systemFinal = system
  if (params.response_format?.type === 'json_object') {
    systemFinal = (systemFinal ? systemFinal + '\n\n' : '') +
      'You must respond with valid JSON only. No other text, no markdown fences.'
  }

  const stream = await bedrock.messages.create({
    model: params.model,
    max_tokens: params.max_tokens ?? 4096,
    ...(systemFinal ? { system: systemFinal } : {}),
    messages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(translateTools(params.tools) ? { tools: translateTools(params.tools)! } : {}),
    ...(params.tool_choice ? { tool_choice: translateToolChoice(params.tool_choice) } : {}),
    stream: true,
  })

  return anthropicStreamToOpenAI(stream as AsyncIterable<any>, params.model)
}

// ─── Streaming translator ─────────────────────────────────────────────────────

async function* anthropicStreamToOpenAI(
  stream: AsyncIterable<any>,
  model: string
): AsyncIterable<any> {
  const id = `bedrock-${Date.now()}`
  let toolIndex = -1

  for await (const event of stream) {
    switch (event.type) {
      case 'content_block_start': {
        if (event.content_block?.type === 'tool_use') {
          toolIndex++
          yield makeChunk(id, model, {
            delta: {
              tool_calls: [{
                index: toolIndex,
                id: event.content_block.id,
                type: 'function' as const,
                function: { name: event.content_block.name, arguments: '' },
              }],
            },
          })
        }
        // text block start — no-op, wait for deltas
        break
      }

      case 'content_block_delta': {
        if (event.delta?.type === 'text_delta') {
          yield makeChunk(id, model, {
            delta: { content: event.delta.text },
          })
        } else if (event.delta?.type === 'input_json_delta') {
          yield makeChunk(id, model, {
            delta: {
              tool_calls: [{
                index: toolIndex,
                function: { arguments: event.delta.partial_json },
              }],
            },
          })
        }
        break
      }

      case 'message_delta': {
        const stopReason = event.delta?.stop_reason
        yield makeChunk(id, model, {
          finish_reason: mapStopReason(stopReason),
        })
        break
      }

      // message_start, content_block_stop, message_stop, ping — ignored
    }
  }
}

function makeChunk(id: string, model: string, overrides: any): any {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: overrides.delta ?? {},
      finish_reason: overrides.finish_reason ?? null,
    }],
  }
}

// ─── Response translator (non-streaming) ──────────────────────────────────────

function anthropicResponseToOpenAI(response: any, model: string): any {
  const textParts: string[] = []
  const toolCalls: any[] = []

  for (const block of response.content ?? []) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        index: toolCalls.length,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      })
    }
  }

  const text = textParts.join('') || null

  return {
    id: response.id ?? `bedrock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: mapStopReason(response.stop_reason),
    }],
    usage: {
      prompt_tokens: response.usage?.input_tokens ?? 0,
      completion_tokens: response.usage?.output_tokens ?? 0,
      total_tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
  }
}

// ─── Message translation (OpenAI → Anthropic) ────────────────────────────────

function translateMessages(openaiMessages: any[]): { system: string; messages: any[] } {
  const systemParts: string[] = []
  const mapped: any[] = []

  for (const msg of openaiMessages) {
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string' ? msg.content : '')
      continue
    }

    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant message with tool calls → tool_use content blocks
        const content: any[] = []
        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name ?? tc.function?.name,
            input: safeJsonParse(tc.function?.arguments ?? '{}'),
          })
        }
        mapped.push({ role: 'assistant', content })
      } else {
        mapped.push({ role: 'assistant', content: msg.content ?? '' })
      }
      continue
    }

    if (msg.role === 'tool') {
      // Tool result → Anthropic expects { role: 'user', content: [{ type: 'tool_result' }] }
      mapped.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        }],
      })
      continue
    }

    // User message — may contain multimodal content
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        mapped.push({ role: 'user', content: msg.content })
      } else if (Array.isArray(msg.content)) {
        const translatedContent = msg.content.map((block: any) => {
          if (block.type === 'text') return block
          if (block.type === 'image_url') return translateImageContent(block)
          return block
        })
        mapped.push({ role: 'user', content: translatedContent })
      }
      continue
    }
  }

  // Anthropic requires strict role alternation — merge consecutive same-role messages
  const merged = mergeConsecutiveRoles(mapped)

  return { system: systemParts.join('\n\n'), messages: merged }
}

/**
 * Merge consecutive messages with the same role.
 * Anthropic API rejects non-alternating roles.
 * Common case: tool_result (mapped to 'user') followed by actual 'user' message.
 */
function mergeConsecutiveRoles(messages: any[]): any[] {
  if (messages.length === 0) return messages

  const merged: any[] = [messages[0]]

  for (let i = 1; i < messages.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = messages[i]

    if (prev.role === curr.role) {
      // Merge content into arrays
      const prevContent = Array.isArray(prev.content)
        ? prev.content
        : [{ type: 'text', text: prev.content ?? '' }]
      const currContent = Array.isArray(curr.content)
        ? curr.content
        : [{ type: 'text', text: curr.content ?? '' }]
      prev.content = [...prevContent, ...currContent]
    } else {
      merged.push(curr)
    }
  }

  return merged
}

// ─── Image translation ────────────────────────────────────────────────────────

function translateImageContent(block: any): any {
  const url = block.image_url?.url ?? ''

  // Data URI: data:image/jpeg;base64,<data>
  const dataUriMatch = url.match(/^data:(image\/\w+);base64,(.+)$/)
  if (dataUriMatch) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataUriMatch[1],
        data: dataUriMatch[2],
      },
    }
  }

  // HTTPS URL (signed URLs, etc.)
  if (url.startsWith('http')) {
    return {
      type: 'image',
      source: { type: 'url', url },
    }
  }

  // Fallback: pass through as text
  return { type: 'text', text: `[Image: ${url}]` }
}

// ─── Tool translation ─────────────────────────────────────────────────────────

function translateTools(tools?: any[]): any[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t: any) => ({
    name: t.function.name,
    description: t.function.description ?? '',
    input_schema: t.function.parameters ?? { type: 'object', properties: {} },
  }))
}

function translateToolChoice(tc: any): any {
  if (tc === 'auto') return { type: 'auto' }
  if (tc === 'none') return { type: 'none' }
  if (tc === 'required') return { type: 'any' }
  if (typeof tc === 'object' && tc.type === 'function') {
    return { type: 'tool', name: tc.function.name }
  }
  return { type: 'auto' }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case 'tool_use':    return 'tool_calls'
    case 'end_turn':    return 'stop'
    case 'max_tokens':  return 'length'
    default:            return 'stop'
  }
}

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}
