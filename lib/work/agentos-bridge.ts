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
  const [agentRes, identityBlock, routinesRes, skillsBlock] = await Promise.all([
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
  ])

  const agent = agentRes?.data as { memory_text: string | null; user_preferences: string | null } | null
  const parts: string[] = []

  if (agent?.user_preferences?.trim()) {
    parts.push(`[USER PREFERENCES — set by this user]\n${agent.user_preferences.trim()}`)
  }
  if (skillsBlock) {
    parts.push(skillsBlock)
  }
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

  const form = new URLSearchParams()
  form.set('message', message)
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
            } else if (kind === 'RunError') {
              send({ type: 'error', message: (evt.content as string) || 'Worker error' })
            }
            // RunStarted / ModelRequest* / RunCompleted carry no user-facing text.
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
            },
          })
          await adminClient
            .from('work_threads')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', threadId)
          // Memory extraction (Op-C) — call the shared lib directly (service
          // context, no cookie). Fire-and-forget so it doesn't delay the response.
          void extractAgentMemory(agentId, userId, threadId, adminClient).catch(() => {})
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
