// ─── AgentOS bridge (Phase 3, dormant) ───────────────────────────────────────
// Proxies the worker chat path to the self-hosted Agno AgentOS service on
// Hetzner. Gated behind WORKERS_USE_AGENTOS — OFF by default. When off, the
// existing hand-rolled loop in route.ts runs unchanged.
//
// PARITY NOTE: AgentOS has no tools / context injection until Phase 4. Do NOT
// enable this flag in production before Phase 4 reaches parity, or workers
// regress to context-less, tool-less chat.
//
// AgentOS streams SSE: `event: RunContent` frames whose data.content is a text
// delta (data.reasoning_content is thinking). We translate those into the
// client's existing event shape ({type:'text'|'thinking_delta'|'done'}).

import { buildUserContextBlock } from '@/lib/context/build-user-context'
import { extractAgentMemory } from '@/lib/agents/extract-memory'
import { buildSkillsBlock } from '@/lib/work/worker-skills-context'
import { buildConnectedIntegrationsBlock } from '@/lib/integrations/connection'
import { logAIUsage } from '@/lib/ai/log-usage'

// AgentOS is hardcoded to mirror the bedrock_optimised tier (infra/agentos/models.py) — every
// AgentOS-routed call by construction uses that tier's models, so cost logging can log
// tier:'bedrock_optimised' directly with no per-call lookup. This constant is only the
// fallback when a response is missing its own `model` field.
const AGENTOS_DEFAULT_MODEL = 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0'

interface AgnoMetrics {
  input_tokens?: number
  output_tokens?: number
}

function logAgentOSUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  params: { userId: string; agentId: string; source: 'agentos_step' | 'agentos_chat'; model?: string; metrics: AgnoMetrics | null | undefined },
) {
  if (!params.metrics) return
  logAIUsage(adminClient, {
    userId: params.userId,
    agentId: params.agentId,
    source: params.source,
    provider: 'bedrock',
    model: params.model || AGENTOS_DEFAULT_MODEL,
    tier: 'bedrock_optimised',
    taskType: 'conversation',
    usage: { prompt_tokens: params.metrics.input_tokens, completion_tokens: params.metrics.output_tokens },
  }).catch(() => {})
}

const SSE = (data: object) => `data: ${JSON.stringify(data)}\n\n`

// Human labels for tool chips (mirrors the native loop's toolLabel).
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  fetch_url: 'Reading page',
  deep_research: 'Researching',
  get_emails: 'Checking inbox',
  get_meeting_context: 'Checking calendar',
  search_knowledge_base: 'Searching knowledge base',
  list_tasks: 'Listing tasks',
  create_task: 'Creating task',
  get_task: 'Reading task',
  update_task: 'Updating task',
  run_task: 'Running task',
  duplicate_task: 'Duplicating task',
  delete_task: 'Deleting task',
  share_task: 'Sharing task',
  list_team_tasks: 'Listing team tasks',
  use_task: 'Adding team task',
  list_worker_documents: 'Listing documents',
  get_worker_document: 'Opening document',
  generate_document: 'Generating document',
  compose_email: 'Drafting email',
}
const toolLabel = (name: string) => TOOL_LABELS[name] ?? name.replace(/_/g, ' ')

// Short chip summary from a tool's result string.
function summarizeToolResult(name: string, result: unknown): string {
  const text = typeof result === 'string' ? result : ''
  if (!text) return 'Done'
  const firstLine = text.split('\n').find(l => l.trim())?.trim() ?? 'Done'
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine
}

// generate_document embeds a machine-readable marker in its result so the bridge
// can surface the artifact chip: [[artifact:<id>|<type>|<title>]]
function parseArtifactMarker(result: unknown): { id: string; type: string; title: string } | null {
  if (typeof result !== 'string') return null
  const m = result.match(/\[\[artifact:([^|]+)\|([^|]+)\|([^\]]+)\]\]/)
  if (!m) return null
  return { id: m[1], type: m[2], title: m[3] }
}

// compose_email returns a [[email_draft:<base64 json>]] marker — decode it to the draft.
function parseEmailDraftMarker(result: unknown): Record<string, unknown> | null {
  if (typeof result !== 'string') return null
  const m = result.match(/\[\[email_draft:([A-Za-z0-9+/=]+)\]\]/)
  if (!m) return null
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) } catch { return null }
}

// present_* tools return [[card:<base64 json {type,...payload}>]] markers — decode to typed
// artifacts the render registry knows how to display. Tool-result-based (like email/chips),
// so the model never has to hand-encode anything. Multiple per result allowed.
function parseCardMarkers(result: unknown): Record<string, unknown>[] {
  if (typeof result !== 'string') return []
  const out: Record<string, unknown>[] = []
  const re = /\[\[card:([A-Za-z0-9+/=]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(result)) !== null) {
    try { out.push(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) } catch { /* skip malformed */ }
  }
  return out
}

// ─── Per-user run context (Phase 3.5) ─────────────────────────────────────────
// The static role prompts live in AgentOS; the genuinely per-user, per-run data
// is built here — reusing the native builders — and injected into the model via
// dependencies.user_context (the agent has add_dependencies_to_context=True).
// Mirrors the worker context the native chat loop assembles beyond the role
// prompt: user preferences, learned memory, user identity, active routines.
async function buildWorkerRunContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  userId: string,
  agentId: string,
): Promise<string> {
  const [agentRes, identityBlock, routinesRes, skillsBlock, integrationsBlock] = await Promise.all([
    adminClient
      .from('custom_agents')
      .select('memory_text, user_preferences')
      .eq('id', agentId)
      .single(),
    buildUserContextBlock(userId, adminClient).catch(() => ''),
    adminClient
      .from('workflows')
      .select('name, trigger, last_run_at')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(10),
    buildSkillsBlock(adminClient, agentId),
    buildConnectedIntegrationsBlock(adminClient, userId, agentId),
  ])

  const agent = agentRes?.data as { memory_text: string | null; user_preferences: string | null } | null
  const parts: string[] = []

  if (agent?.user_preferences?.trim()) {
    parts.push(`[USER PREFERENCES — set by this user]\n${agent.user_preferences.trim()}`)
  }
  if (skillsBlock) {
    parts.push(skillsBlock)
  }
  if (integrationsBlock) {
    parts.push(integrationsBlock)
  }
  // Email: the user's own addresses for "me"/"us" resolution in compose_email.
  try {
    const { getUserEmailIdentities } = await import('@/lib/tools')
    const ids = await getUserEmailIdentities(adminClient, userId)
    const mine = [ids.login, ...ids.connected].filter(Boolean)
    if (mine.length) parts.push(`[YOUR EMAIL ADDRESSES]\nThe user ("me"/"us") can be reached at: ${mine.join(', ')}. Use these when asked to email the user themselves. To email anyone, call compose_email — it shows the user an editable draft to send; you never send directly. The email is FROM YOU (the coworker, your @team.augmtd.ai address), NOT the user — write in your own voice and do NOT sign off with the user's name; a signature with your name/role/address is appended automatically, so end the body with no sign-off.`)
  } catch { /* non-fatal */ }
  if (agent?.memory_text?.trim()) {
    parts.push(`[MEMORY — things you've learned about this user from past conversations]\n${agent.memory_text.trim()}`)
  }
  if (identityBlock) {
    parts.push(identityBlock)
  }

  const routines = (routinesRes?.data ?? []) as Array<{
    name: string; trigger: { type: string; label?: string; cron?: string }; last_run_at: string | null
  }>
  if (routines.length > 0) {
    const lines = routines.map(r => {
      const schedule = r.trigger.label ?? (r.trigger.type === 'schedule' ? (r.trigger.cron ?? 'scheduled') : 'manual')
      return `- ${r.name} · ${schedule}`
    })
    parts.push(`[YOUR ACTIVE ROUTINES]\n${lines.join('\n')}\nReference these directly if the user asks what you have scheduled.`)
  }

  return parts.join('\n\n')
}

/** True only when the flag is on AND both endpoint + secret are configured. */
export function isAgentOSEnabled(): boolean {
  return (
    process.env.WORKERS_USE_AGENTOS === 'true' &&
    !!process.env.AGENTOS_SERVICE_URL &&
    !!process.env.AGENTOS_SECRET
  )
}

/**
 * Non-streaming worker run for workflow `agent` steps (Phase 5). Routes a
 * scheduled task's agent step through AgentOS so it gets the tool-enabled loop
 * + per-user context, instead of the inline single AI call. Returns the agent's
 * final text. Throws on failure so the caller can fall back to the native path.
 */
export async function runWorkerStepViaAgentOS(args: {
  workerRole: string
  agentId: string
  userId: string
  message: string
  sessionId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any
}): Promise<string> {
  const base = process.env.AGENTOS_SERVICE_URL!.replace(/\/$/, '')
  const secret = process.env.AGENTOS_SECRET!

  let userContext = ''
  try {
    userContext = await buildWorkerRunContext(args.adminClient, args.userId, args.agentId)
  } catch { /* best-effort */ }

  const form = new URLSearchParams()
  form.set('message', args.message)
  form.set('stream', 'false')
  form.set('session_id', args.sessionId)
  form.set('user_id', args.userId)
  form.set('dependencies', JSON.stringify({
    agent_id: args.agentId,
    thread_id: args.sessionId,
    ...(userContext ? { user_context: userContext } : {}),
  }))

  const resp = await fetch(`${base}/agents/${args.workerRole}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!resp.ok) throw new Error(`AgentOS step run responded ${resp.status}`)
  const data = await resp.json()
  const content = (data?.content ?? '').toString().trim()
  if (!content) throw new Error('AgentOS step run returned empty content')

  logAgentOSUsage(args.adminClient, {
    userId: args.userId,
    agentId: args.agentId,
    source: 'agentos_step',
    model: typeof data?.model === 'string' ? data.model : undefined,
    metrics: data?.metrics as AgnoMetrics | undefined,
  })

  return content
}

interface BridgeArgs {
  workerRole: string // AgentOS agent id (custom_agents.worker_role)
  agentId: string // custom_agents.id — the user's specific worker row, for task tools
  message: string
  threadId: string // used as AgentOS session_id for conversation continuity
  userId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any
}

/**
 * Stream a worker turn from AgentOS, re-emitting the client SSE event shape and
 * persisting the assistant message to work_messages on completion. Returns a
 * Response with the translated event-stream, or throws if AgentOS is
 * unreachable (caller falls back to the native loop).
 */
// Flatten a thread artifact (DocContent / email artifact / string) to plain text.
function serializeArtifactContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const c = content as { title?: string; subtitle?: string; body?: string; sections?: Array<{ heading?: string; paragraphs?: string[] }> }
    if (c.body) return c.body // email-type artifact
    if (Array.isArray(c.sections)) {
      const lines: string[] = []
      if (c.title) lines.push(c.title)
      if (c.subtitle) lines.push(c.subtitle)
      for (const s of c.sections) { lines.push(`\n## ${s.heading ?? ''}`); for (const p of (s.paragraphs ?? [])) lines.push(p) }
      return lines.join('\n\n')
    }
  }
  return ''
}

export async function streamWorkerViaAgentOS({
  workerRole,
  agentId,
  message,
  threadId,
  userId,
  adminClient,
}: BridgeArgs): Promise<Response> {
  const base = process.env.AGENTOS_SERVICE_URL!.replace(/\/$/, '')
  const secret = process.env.AGENTOS_SECRET!

  // Build per-user context (preferences, memory, identity, routines). Best-effort
  // — a failure here must not block the chat, so fall back to no extra context.
  let userContext = ''
  try {
    userContext = await buildWorkerRunContext(adminClient, userId, agentId)
  } catch (err) {
    console.error('[AgentOS bridge] context build failed (continuing):', err)
  }

  // Documents already created in this thread — inject so the worker can SEE and revise
  // its own output (parity with the native loop, which injects these into context).
  let docContext = ''
  try {
    const { data: t } = await adminClient.from('work_threads').select('artifacts').eq('id', threadId).maybeSingle()
    const artifacts = (t?.artifacts ?? []) as Array<{ title?: string; content?: unknown }>
    if (artifacts.length) {
      const blocks = artifacts.slice(-3).map(a => `### ${a.title ?? 'Document'}\n${serializeArtifactContent(a.content).slice(0, 6000)}`).join('\n\n')
      docContext = `\n\n[DOCUMENTS ALREADY CREATED IN THIS CONVERSATION — you produced these; reference, summarise, or revise them when asked]\n${blocks}`
    }
  } catch { /* best-effort */ }

  const form = new URLSearchParams()
  form.set('message', message + docContext)
  form.set('stream', 'true')
  form.set('session_id', threadId)
  form.set('user_id', userId)
  // dependencies carries both tool-routing IDs (agent_id, thread_id — read by
  // Python tools) and the per-user context block (rendered into the model prompt
  // via the agent's add_dependencies_to_context=True).
  form.set('dependencies', JSON.stringify({
    agent_id: agentId,
    thread_id: threadId,
    ...(userContext ? { user_context: userContext } : {}),
  }))

  const upstream = await fetch(`${base}/agents/${workerRole}/runs?stream=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })

  if (!upstream.ok || !upstream.body) {
    throw new Error(`AgentOS responded ${upstream.status}`)
  }

  let fullText = ''
  const toolCalls: Array<{ name: string; summary: string }> = []
  const artifactMeta: Record<string, { title: string; type: string }> = {}
  const emailDrafts: Record<string, unknown>[] = []
  const cardArtifacts: Record<string, unknown>[] = []
  let runMetrics: AgnoMetrics | null = null
  let runModel: string | undefined

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(SSE(data))) } catch { /* closed */ }
      }

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keep-alive\n\n')) } catch { /* closed */ }
      }, 15000)

      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let thinkingOpen = false

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          // SSE frames are separated by a blank line.
          const frames = buf.split('\n\n')
          buf = frames.pop() ?? '' // keep the trailing partial frame

          for (const frame of frames) {
            const dataLine = frame.split('\n').find(l => l.startsWith('data:'))
            if (!dataLine) continue
            let evt: Record<string, unknown>
            try { evt = JSON.parse(dataLine.slice(5).trim()) } catch { continue }

            const kind = evt.event as string | undefined
            if (kind === 'RunContent') {
              const reasoning = (evt.reasoning_content as string) || ''
              const content = (evt.content as string) || ''
              if (reasoning) {
                if (!thinkingOpen) thinkingOpen = true
                send({ type: 'thinking_delta', delta: reasoning })
              }
              if (content) {
                if (thinkingOpen) { send({ type: 'thinking_done' }); thinkingOpen = false }
                fullText += content
                send({ type: 'text', delta: content })
              }
            } else if (kind === 'ToolCallStarted') {
              const tool = (evt.tool ?? {}) as { tool_name?: string; tool_call_id?: string }
              const name = tool.tool_name ?? 'tool'
              send({ type: 'tool_start', name, id: tool.tool_call_id ?? name, label: toolLabel(name) })
            } else if (kind === 'ToolCallCompleted') {
              const tool = (evt.tool ?? {}) as { tool_name?: string; tool_call_id?: string; result?: unknown }
              const name = tool.tool_name ?? 'tool'
              const summary = summarizeToolResult(name, tool.result)
              send({ type: 'tool_result', name, id: tool.tool_call_id ?? name, summary })
              toolCalls.push({ name, summary })
              // Document generation surfaces an artifact (Op-B). The tool result
              // carries a [[artifact:id|type|title]] marker — emit + accumulate.
              const art = parseArtifactMarker(tool.result)
              if (art) {
                artifactMeta[art.id] = { title: art.title, type: art.type }
                send({ type: 'artifact_ready', artifact: art })
              }
              const draft = parseEmailDraftMarker(tool.result)
              if (draft) { emailDrafts.push(draft); send({ type: 'email_draft', draft }) }
              // Rich render-registry cards (e.g. linkedin_post) — display-only artifacts.
              for (const card of parseCardMarkers(tool.result)) {
                cardArtifacts.push(card)
                send({ type: 'artifact', artifact: card })
              }
            } else if (kind === 'RunError') {
              send({ type: 'error', message: (evt.content as string) || 'Worker error' })
            } else if (kind === 'RunCompleted') {
              // No user-facing text, but this is the one frame carrying token usage —
              // captured for cost logging, not displayed.
              runMetrics = (evt.metrics as AgnoMetrics) ?? null
              if (typeof evt.model === 'string') runModel = evt.model
            }
            // RunStarted / ModelRequest* carry no user-facing text.
          }
        }

        if (thinkingOpen) send({ type: 'thinking_done' })
        send({ type: 'done' })
      } catch (err) {
        console.error('[AgentOS bridge] stream error:', err)
        send({ type: 'error', message: 'An error occurred. Please try again.' })
      } finally {
        clearInterval(heartbeat)
        try {
          await adminClient.from('work_messages').insert({
            thread_id: threadId,
            role: 'assistant',
            content: fullText,
            metadata: {
              source: 'agentos',
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              ...(Object.keys(artifactMeta).length > 0
                ? { artifact_ids: Object.keys(artifactMeta), artifact_meta: artifactMeta }
                : {}),
              ...(emailDrafts.length > 0 ? { email_drafts: emailDrafts } : {}),
              ...(cardArtifacts.length > 0 ? { artifacts: cardArtifacts } : {}),
            },
          })
          await adminClient
            .from('work_threads')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', threadId)
          // Memory extraction (Op-C) — call the shared lib directly (service
          // context, no cookie). Fire-and-forget so it doesn't delay the response.
          void extractAgentMemory(agentId, userId, threadId, adminClient).catch(() => {})
          logAgentOSUsage(adminClient, { userId, agentId, source: 'agentos_chat', model: runModel, metrics: runMetrics })
        } catch (saveErr) {
          console.error('[AgentOS bridge] failed to save message:', saveErr)
        }
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
