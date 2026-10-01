// W31 — THE CONVERSE PATH on Bedrock, zero AI. The Bedrock transports are stubbed at the adapter's
// seam (createBedrockAdapter's deps), so every assertion reads what the adapter would really SEND and
// what a caller would really READ:
//   · gpt-oss's reasoning block is stripped (non-streaming and streaming) — only the answer surfaces;
//   · OpenAI params map to Converse (system, max_tokens, temperature, stop, json_object, tools);
//   · the effort floor ('low' + headroom) and a stated effort ride additionalModelRequestFields;
//   · usage maps back to prompt/completion tokens (logAIUsage + pricing read these);
//   · the Claude path still goes to the Messages API with the same request as before;
//   · THE EU RESIDENCY FLOOR: bedrock tier defaults + documented override targets are EU-resident, and
//     an EU-region adapter refuses a global./us. profile before sending.
import { describe, it, expect } from 'vitest'
import { createBedrockAdapter } from '../../lib/ai/bedrock-adapter'
import { buildConverseRequest, isConverseModel, stripInlineReasoning } from '../../lib/ai/bedrock-converse'
import { applyEffort, effortFamily, GPT_OSS_HEADROOM } from '../../lib/ai/effort'
import { MODEL_PRICING, estimateCostEur } from '../../lib/ai/pricing'
import { TIER_DEFAULTS } from '../../lib/ai/defaults'
import { EU_BEDROCK_OVERRIDE_TARGETS, isEuResidentBedrockModel, assertBedrockResidency } from '../../lib/ai/bedrock-residency'

const OSS = 'openai.gpt-oss-120b-1:0'

function stubs(converseReply: (input: any) => any, streamEvents?: any[]) {
  const sent: any[] = []
  const claude: any[] = []
  const converse = {
    send: async (cmd: any) => {
      sent.push(cmd.input)
      if (cmd.constructor?.name === 'ConverseStreamCommand') {
        return { stream: (async function* () { for (const e of streamEvents ?? []) yield e })() }
      }
      return converseReply(cmd.input)
    },
  }
  const anthropic = {
    messages: {
      create: async (req: any) => {
        claude.push(req)
        return { id: 'msg_1', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 4 } }
      },
    },
  }
  const client = createBedrockAdapter({ awsRegion: 'eu-central-1' }, { converse, anthropic: anthropic as any }) as any
  return { client, sent, claude }
}

const REPLY = {
  output: { message: { role: 'assistant', content: [
    { reasoningContent: { reasoningText: { text: 'The user wants JSON. Lisbon is the capital.' } } },
    { text: '```json\n{"city":"Lisbon"}\n```' },
  ] } },
  stopReason: 'end_turn',
  usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
}

describe('Converse path — gpt-oss on Bedrock', () => {
  it('routes non-Anthropic ids to Converse and Anthropic ids to the Messages API', () => {
    expect(isConverseModel(OSS)).toBe(true)
    expect(isConverseModel('amazon.nova-pro-v1:0')).toBe(true)
    expect(isConverseModel('eu.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(false)
    expect(isConverseModel('anthropic.claude-3-haiku-20240307-v1:0')).toBe(false)
  })

  it('strips the reasoning block, unfences JSON mode, maps usage', async () => {
    const { client, sent } = stubs(() => REPLY)
    const res = await client.chat.completions.create({
      model: OSS, max_tokens: 200, temperature: 0, stop: 'END', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'Be terse.' }, { role: 'user', content: 'Capital of Portugal?' }],
    })
    expect(res.choices[0].message.content).toBe('{"city":"Lisbon"}')
    expect(JSON.stringify(res)).not.toContain('The user wants JSON')
    expect(res.choices[0].finish_reason).toBe('stop')
    expect(res.usage.prompt_tokens).toBe(100)
    expect(res.usage.completion_tokens).toBe(40)
    expect(res.usage.total_tokens).toBe(140)
    expect(res.usage.completion_tokens_details.reasoning_estimated).toBe(true)

    const input = sent[0]
    expect(input.modelId).toBe(OSS)
    expect(input.system.map((s: any) => s.text).join('\n')).toContain('Be terse.')
    expect(input.system.map((s: any) => s.text).join('\n')).toMatch(/valid JSON only/)
    expect(input.messages).toEqual([{ role: 'user', content: [{ text: 'Capital of Portugal?' }] }])
    expect(input.inferenceConfig).toEqual({ maxTokens: 200 + GPT_OSS_HEADROOM.low, temperature: 0, stopSequences: ['END'] })
    // THE FLOOR: nothing stated an effort → 'low', with reasoning headroom so JSON never starves.
    expect(input.additionalModelRequestFields).toEqual({ reasoning_effort: 'low' })
    expect(input).not.toHaveProperty('reasoning_effort')
  })

  it('a stated effort rides additionalModelRequestFields with applyEffort\'s headroom (no double bump)', async () => {
    expect(effortFamily(OSS)).toBe('gpt-oss')
    const { params, applied } = applyEffort({ model: OSS, max_tokens: 300, messages: [] }, 'medium')
    expect(applied).toBe('medium')
    expect((params as any).max_tokens).toBe(300 + GPT_OSS_HEADROOM.medium)
    const req = buildConverseRequest(params) as any
    expect(req.additionalModelRequestFields).toEqual({ reasoning_effort: 'medium' })
    expect(req.inferenceConfig.maxTokens).toBe(300 + GPT_OSS_HEADROOM.medium)
    // 'minimal' is not a gpt-oss effort: it runs at 'low', headroom still reserved.
    const min = applyEffort({ model: OSS, max_tokens: 200, messages: [] }, 'minimal').params as any
    expect(min.reasoning_effort).toBe('low')
    expect(min.max_tokens).toBe(200 + GPT_OSS_HEADROOM.minimal)
    // The model's 16K output ceiling caps the budget; max_completion_tokens is honoured.
    expect((buildConverseRequest({ model: OSS, max_completion_tokens: 50_000, messages: [{ role: 'user', content: 'x' }] }) as any).inferenceConfig.maxTokens).toBe(16384)
  })

  it('maps tools and tool history, and alternates roles', () => {
    const req = buildConverseRequest({
      model: OSS, tool_choice: 'required',
      tools: [{ type: 'function', function: { name: 'lookup', description: 'find', parameters: { type: 'object', properties: { q: { type: 'string' } } } } }],
      messages: [
        { role: 'user', content: 'find x' },
        { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] },
        { role: 'tool', tool_call_id: 't1', content: 'found' },
        { role: 'user', content: 'and?' },
      ],
    }) as any
    expect(req.toolConfig.toolChoice).toEqual({ any: {} })
    expect(req.toolConfig.tools[0].toolSpec.inputSchema.json.properties.q.type).toBe('string')
    expect(req.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(req.messages[1].content[0].toolUse).toEqual({ toolUseId: 't1', name: 'lookup', input: { q: 'x' } })
    expect(req.messages[2].content[0].toolResult.toolUseId).toBe('t1')
  })

  it('returns tool calls in the OpenAI shape', async () => {
    const { client } = stubs(() => ({
      output: { message: { content: [{ reasoningContent: { reasoningText: { text: 'think' } } }, { toolUse: { toolUseId: 't9', name: 'lookup', input: { q: 'y' } } }] } },
      stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 6 },
    }))
    const res = await client.chat.completions.create({ model: OSS, messages: [{ role: 'user', content: 'go' }] })
    expect(res.choices[0].finish_reason).toBe('tool_calls')
    expect(res.choices[0].message.content).toBeNull()
    expect(res.choices[0].message.tool_calls[0]).toMatchObject({ id: 't9', function: { name: 'lookup', arguments: '{"q":"y"}' } })
  })

  it('streams via ConverseStream: reasoning deltas never surface; final chunk carries usage', async () => {
    const { client, sent } = stubs(() => null, [
      { messageStart: { role: 'assistant' } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: 'secret thinking' } } } },
      { contentBlockDelta: { contentBlockIndex: 1, delta: { text: 'Hel' } } },
      { contentBlockDelta: { contentBlockIndex: 1, delta: { text: 'lo' } } },
      { messageStop: { stopReason: 'end_turn' } },
      { metadata: { usage: { inputTokens: 9, outputTokens: 7, totalTokens: 16 } } },
    ])
    const stream = await client.chat.completions.create({ model: OSS, stream: true, messages: [{ role: 'user', content: 'hi' }] })
    const chunks: any[] = []
    for await (const c of stream) chunks.push(c)
    expect(chunks.map((c) => c.choices[0].delta.content ?? '').join('')).toBe('Hello')
    expect(JSON.stringify(chunks)).not.toContain('secret thinking')
    const last = chunks[chunks.length - 1]
    expect(last.choices[0].finish_reason).toBe('stop')
    expect(last.usage).toMatchObject({ prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 })
    expect(sent[0].additionalModelRequestFields).toEqual({ reasoning_effort: 'low' })
  })

  it('strips an inline <reasoning> preamble defensively', () => {
    expect(stripInlineReasoning('<reasoning>hmm</reasoning>{"a":1}')).toBe('{"a":1}')
    expect(stripInlineReasoning('plain')).toBe('plain')
  })
})

describe('Claude path — unchanged', () => {
  it('sends the same Messages API request as before (no Converse fields, no reasoning_effort)', async () => {
    const { client, sent, claude } = stubs(() => REPLY)
    const res = await client.chat.completions.create({
      model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 300, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }],
    })
    expect(sent).toHaveLength(0)
    expect(claude[0]).toEqual({
      model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 300,
      system: 'S\n\nYou must respond with valid JSON only. No other text, no markdown fences.',
      messages: [{ role: 'user', content: 'U' }], temperature: 0,
    })
    expect(res.choices[0].message.content).toBe('{"ok":true}')
    expect(res.usage).toEqual({ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 })
  })
})

describe('pricing', () => {
  it('prices gpt-oss-120b (no fallback) and meters reasoning as output', () => {
    expect(MODEL_PRICING[OSS]).toBeDefined()
    expect(estimateCostEur(OSS, 1_000_000, 1_000_000)).toBeCloseTo(MODEL_PRICING[OSS].inputPer1M + MODEL_PRICING[OSS].outputPer1M, 4)
  })
})

describe('THE EU RESIDENCY FLOOR (Tier-1 #12)', () => {
  it('every bedrock tier default and documented override target is EU-resident (never global./us.)', () => {
    for (const tier of ['bedrock_optimised', 'bedrock_private'] as const) {
      for (const [slot, ep] of Object.entries(TIER_DEFAULTS[tier])) {
        expect(ep.provider, `${tier}.${slot}`).toBe('bedrock')
        expect(isEuResidentBedrockModel(ep.model), `${tier}.${slot} → ${ep.model}`).toBe(true)
        expect(ep.model).not.toMatch(/^(global|us)\./)
      }
    }
    for (const m of EU_BEDROCK_OVERRIDE_TARGETS) expect(isEuResidentBedrockModel(m), m).toBe(true)
  })

  it('rejects non-EU profiles and accepts in-region / eu. ids', () => {
    for (const m of ['global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'us.anthropic.claude-haiku-4-5-20251001-v1:0', 'apac.amazon.nova-pro-v1:0', '']) {
      expect(isEuResidentBedrockModel(m), m).toBe(false)
    }
    for (const m of [OSS, 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', 'cohere.embed-multilingual-v3', 'amazon.nova-pro-v1:0']) {
      expect(isEuResidentBedrockModel(m), m).toBe(true)
    }
    expect(() => assertBedrockResidency('us.openai.gpt-oss-120b-1:0', 'us-east-1')).not.toThrow() // non-EU region: not this floor's concern
  })

  it('an EU-region adapter refuses a non-EU profile before anything is sent (outcome)', async () => {
    const { client, sent, claude } = stubs(() => REPLY)
    await expect(client.chat.completions.create({ model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/not EU-resident/)
    await expect(client.chat.completions.create({ model: 'us.openai.gpt-oss-120b-1:0', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/not EU-resident/)
    expect(sent).toHaveLength(0)
    expect(claude).toHaveLength(0)
  })
})
