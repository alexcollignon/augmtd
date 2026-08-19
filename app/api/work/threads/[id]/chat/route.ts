import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type OpenAI from 'openai';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { buildChatSystemPrompt, detectModelFamily } from '@/lib/work/chat-system-prompt'
// Intent classifier removed — replaced by lightweight heuristic router below.
// import { classifyIntent } from '@/lib/work/intent-classifier';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { buildSkillsBlock } from '@/lib/work/worker-skills-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { runFullPipeline } from '@/lib/work/generate-pipeline';
import { buildToolRegistry } from '@/lib/mcp/registry';
import { DocumentArtifact } from '@/lib/types/inbox';
import { indexArtifact } from '@/lib/knowledge/indexer';
import { getMimeType, getFileExt } from '@/lib/artifacts/builders';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getMyWorkspace } from '@/lib/workspace/features';
import { isToolAllowed } from '@/lib/workspace/tool-capabilities';
import { DEFAULT_FEATURES, type WorkspaceFeatures } from '@/lib/workspace/types';
import {
  webSearchDefinition, fetchUrlDefinition, executeWebSearch, executeFetchUrl,
  getEmailsDefinition, executeGetEmails,
  getMeetingContextDefinition, executeGetMeetingContext,
  deepResearchDefinition, executeDeepResearch,
  slackListChannelsDefinition, slackPostMessageDefinition, slackReadMessagesDefinition, slackListMembersDefinition,
  executeSlackListChannels, executeSlackPostMessage, executeSlackReadMessages, executeSlackListMembers,
  findTeamWorkDefinition, readTeamWorkDefinition, executeFindTeamWork, executeReadTeamWork,
  composeEmailDefinition, executeComposeEmail, getUserEmailIdentities, type EmailDraft,
  runComputeDefinition, executeRunCompute, type ComputeConfig,
} from '@/lib/tools';
import { buildConnectedIntegrationsBlock } from '@/lib/integrations/connection';
import {
  listTasksDefinition, createTaskDefinition, getTaskDefinition, updateTaskDefinition, duplicateTaskDefinition, deleteTaskDefinition, runTaskDefinition,
  shareTaskDefinition, listTeamTasksDefinition, useTaskDefinition,
  listWorkerDocumentsDefinition, getWorkerDocumentDefinition,
  executeListTasks, executeCreateTask, executeGetTask, executeUpdateTask, executeDuplicateTask, executeDeleteTask, executeRunTask,
  executeShareTask, executeListTeamTasks, executeUseTask,
  executeListWorkerDocuments, executeGetWorkerDocument,
} from '@/lib/tools/worker-tasks';
import {
  listSkillsDefinition, applySkillDefinition,
  executeListSkills, executeApplySkill,
} from '@/lib/tools/worker-skills';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { isAgentOSEnabled, streamWorkerViaAgentOS } from '@/lib/work/agentos-bridge';

export const maxDuration = 60;

// Module-level singleton — reused across requests within the same server process.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

const SSE = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

// ── Heuristic router — replaces AI intent classifier ────────────────────────
// Zero AI calls, <1ms. Returns how the model should be configured for this turn.

type RouteMode = 'no_tools' | 'force_generate' | 'all_tools';

const GREETING_RE = /^(hi|hey|hello|thanks|thank you|ok|okay|sure|got it|sounds good|great|nice|cool|yep|yes|no|nope)\b[.!?\s]*$/i;

function heuristicRoute(
  content: string,
  mentions: Array<{ id: string; type: string }>,
  existingArtifacts?: unknown[],
): RouteMode {
  const trimmed = content.trim();

  // Clarification confirmed → force generate
  if (trimmed.startsWith('[CLARIFICATION CONFIRMED]')) return 'force_generate';

  // Simple greetings/acknowledgements with no mentions → no tools
  if (GREETING_RE.test(trimmed) && mentions.length === 0) return 'no_tools';

  // Everything else → model gets all tools and decides
  return 'all_tools';
}

// ── Smart pre-fetcher — heuristic context injection ─────────────────────────
// Detects temporal, person, and task references via regex. Pre-fetches matching
// context in parallel BEFORE the AI call, so the model appears omniscient.

const TEMPORAL_RE = /\b(today|tomorrow|this week|next week|meeting|meetings|schedule|calendar|upcoming)\b/i;
const TASK_RE = /\b(task|tasks|todo|to.do|working on|urgent|deadline|follow.?up|backlog|in progress)\b/i;

async function prefetchContext(
  message: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const parts: string[] = [];
  const fetches: Promise<void>[] = [];

  // Temporal references → calendar
  if (TEMPORAL_RE.test(message)) {
    fetches.push(
      getCalendarContext(userId, supabase).then(calCtx => {
        const formatted = formatCalendarContextForChat(calCtx);
        if (formatted) parts.push(formatted);
      }).catch(() => {})
    );
  }

  if (fetches.length === 0) return null;
  await Promise.all(fetches);
  return parts.length > 0 ? `<available_context>\n${parts.join('\n\n')}\n</available_context>` : null;
}

// ── GET: load messages with metadata ────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [threadResult, messagesResult] = await Promise.all([
    supabase
      .from('work_threads')
      .select('id, title, artifacts, updated_at, workflow_id')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('work_messages')
      .select('id, role, content, created_at, metadata')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
  ]);

  if (threadResult.error || !threadResult.data) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  // Opening a task's thread IS reviewing its output — stamp the runs, clear the
  // notifications, and auto-resume the task if it had paused itself waiting for
  // review. Fire-and-forget (admin client — workflow_runs has no user UPDATE
  // policy); never blocks or fails the thread load.
  const workflowId = (threadResult.data as { workflow_id?: string | null }).workflow_id;
  if (workflowId) {
    markWorkflowReviewed(workflowId, user.id, threadId).catch(() => {});
  }

  const messages = (messagesResult.data || []).map((m: Record<string, unknown>) => {
    const meta = m.metadata as Record<string, unknown> | null;
    return {
      ...m,
      mentions: (meta?.mentions as unknown[] | undefined) || undefined,
    };
  });

  return NextResponse.json({
    thread: threadResult.data,
    messages,
  });
}

// ── Review receipt + auto-resume (the pause loop's other half) ───────────────
// "Reviewed" = the user opened the task's shared thread. Stamps reviewed_at on
// the workflow's unreviewed succeeded runs, marks its notifications seen, and —
// if the task auto-paused itself for lack of review — resumes it on the spot
// (catch-up IS the resume gesture; the explicit Resume toggle is the backup).
async function markWorkflowReviewed(workflowId: string, userId: string, threadId: string) {
  const admin = getAdminClient();

  await Promise.all([
    admin.from('workflow_runs')
      .update({ reviewed_at: new Date().toISOString() })
      .eq('workflow_id', workflowId)
      .eq('user_id', userId)
      .eq('status', 'succeeded')
      .is('reviewed_at', null),
    admin.from('workflow_notifications')
      .update({ seen: true })
      .eq('workflow_id', workflowId)
      .eq('user_id', userId)
      .eq('seen', false),
  ]);

  // Auto-resume — only the auto-paused state (a deliberate manual pause stays put),
  // and only for the owner (scheduled runs execute as the owner, so the pause loop
  // is owner-scoped by construction).
  const { data: wf } = await admin
    .from('workflows')
    .select('id, user_id, trigger, status, auto_paused_at')
    .eq('id', workflowId)
    .single();
  if (!wf?.auto_paused_at || wf.status !== 'paused' || wf.user_id !== userId) return;

  const { nextRunFromTrigger } = await import('@/lib/workflows/schedule');
  const nextRun = nextRunFromTrigger(wf.trigger as { type: string; cron?: string; timezone?: string }, new Date());
  const { error } = await admin.from('workflows')
    .update({
      status: 'active',
      auto_paused_at: null,
      next_run_at: nextRun ? nextRun.toISOString() : null,
    })
    .eq('id', workflowId)
    .eq('status', 'paused')
    .not('auto_paused_at', 'is', null); // race-safe: only flip the auto-paused state
  if (error) return;

  // A one-line in-character note so the state flip is visible in the thread.
  await admin.from('work_messages').insert({
    thread_id: threadId,
    role: 'assistant',
    content: `Picking this back up — I'll run it as scheduled.`,
  });
}

// ── POST: stream chat response ───────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = checkRateLimit(`chat:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, user_attachments, artifacts, is_temporary')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const { content, sources = ['kb', 'inbox', 'calendar'], mentions = [], attachments = [], agentId } = body as {
      content: string;
      sources?: string[];
      mentions?: Array<{ id: string; type: string; label: string; subtitle?: string }>;
      attachments?: Array<{ id: string; name: string }>;
      agentId?: string;
    };

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // ── AgentOS bridge (Phase 3, dormant) ─────────────────────────────────────
    // When WORKERS_USE_AGENTOS is on and this is a worker chat, proxy to the
    // self-hosted AgentOS service instead of the native loop below. Flag is OFF
    // in production until Phase 4 reaches tool/context parity — this early check
    // is a no-op when the flag is unset, so behavior is unchanged by default.
    if (agentId && isAgentOSEnabled()) {
      const bridgeAdmin = getAdminClient();
      const { data: workerRow } = await bridgeAdmin
        .from('custom_agents')
        .select('worker_role, is_worker')
        .eq('id', agentId)
        .single();
      if (workerRow?.is_worker && workerRow.worker_role) {
        // Persist the user message (the native path inserts it later in its
        // Promise.all; here we own persistence for the proxied turn).
        await bridgeAdmin.from('work_messages').insert({
          thread_id: threadId,
          role: 'user',
          content: content.trim(),
          metadata: mentions.length > 0 ? { mentions } : null,
        });
        // Resolve @mentions (coworker / task / document) → context, appended to the
        // message the worker reads — parity with the native path below.
        let bridgeMessage = content.trim();
        if (mentions.length > 0) {
          try {
            const { mentionContext } = await buildMentionContext(mentions, user.id, bridgeAdmin);
            if (mentionContext) bridgeMessage = `${bridgeMessage}\n\n${mentionContext}`;
          } catch { /* non-fatal — proceed without mention context */ }
        }
        // Attached files → append their extracted text (the AgentOS path is text-only,
        // so images / scanned-PDF vision aren't available here — text extraction only).
        if (attachments.length > 0) {
          try {
            const attachIds = new Set((attachments as Array<{ id: string }>).map(a => a.id));
            const { data: thr } = await bridgeAdmin.from('work_threads').select('user_attachments').eq('id', threadId).single();
            const atts = (((thr as { user_attachments?: Array<{ chatAttachId?: string; filename: string; extractedText: string | null }> } | null)?.user_attachments) ?? [])
              .filter(a => a.chatAttachId && attachIds.has(a.chatAttachId) && a.extractedText);
            const attText = atts.map(a => `--- ${a.filename} ---\n${a.extractedText}`).join('\n\n');
            if (attText) bridgeMessage = `${bridgeMessage}\n\nATTACHED FILES:\n${attText}`;
          } catch { /* non-fatal — proceed without attachment context */ }
        }
        try {
          return await streamWorkerViaAgentOS({
            workerRole: workerRow.worker_role as string,
            agentId,
            message: bridgeMessage,
            threadId,
            userId: user.id,
            adminClient: bridgeAdmin,
          });
        } catch (bridgeErr) {
          // AgentOS unreachable — fall through to the native loop below.
          console.error('[Chat] AgentOS bridge failed, falling back:', bridgeErr);
        }
      }
    }

    // ── Resolve AI client + all context in one parallel round-trip ───────────
    const adminClient = getAdminClient();
    const requestTime = new Date().toISOString(); // snapshot before insert — used to exclude current msg from history

    const [
      aiClientResult,
      savedMsgResult,
      historyResult,
      userContextBlock,
      contactsResult,
      prefetchedContext,
      agentResult,
      routinesResult,
    ] = await Promise.all([
      getAIClient(user.id, 'conversation', supabase),
      adminClient.from('work_messages').insert({
        thread_id: threadId,
        role: 'user',
        content: content.trim(),
        metadata: (mentions.length > 0 || attachments.length > 0) ? { mentions: mentions.length > 0 ? mentions : undefined, attachments: attachments.length > 0 ? attachments : undefined } : null,
      }).select('id').single(),
      // Load prior history only — exclude current message (inserted in parallel above)
      adminClient
        .from('work_messages')
        .select('role, content, metadata')
        .eq('thread_id', threadId)
        .lt('created_at', requestTime)
        .order('created_at', { ascending: true })
        .limit(40),
      buildUserContextBlock(user.id, supabase),
      adminClient
        .from('relationship_graph')
        .select('contact_name, contact_email, relationship_type, importance, last_interaction, typical_topics')
        .eq('user_id', user.id)
        .gte('importance', 0.3)
        .order('importance', { ascending: false })
        .limit(10),
      prefetchContext(content, user.id, supabase),
      agentId
        ? adminClient
            .from('custom_agents')
            .select('id, user_id, name, instructions, user_preferences, memory_text, web_enabled, is_worker, agent_knowledge_sources(knowledge_file_id)')
            .eq('id', agentId)
            .single()
        : Promise.resolve({ data: null }),
      // Prefetch active routines when agentId present (filtered by isWorker after)
      agentId
        ? adminClient
            .from('workflows')
            .select('name, trigger, last_run_at, next_run_at')
            .eq('agent_id', agentId)
            .eq('user_id', user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(10)
        : Promise.resolve({ data: null }),
    ]);

    const { client: aiClient, model: chatModel, endpoint: chatEndpoint, tier: chatTier } = aiClientResult;
    const modelFamily = detectModelFamily(chatModel);
    const savedMsg = savedMsgResult.data;
    const history = historyResult.data ?? [];
    const isFirstMessage = history.length === 0; // no prior messages = this is the first

    const agentRaw = (agentResult as { data: { id: string; user_id: string; name: string; instructions: string | null; user_preferences: string | null; memory_text: string | null; web_enabled: boolean | null; is_worker?: boolean; agent_knowledge_sources: Array<{ knowledge_file_id: string | null }> } | null }).data ?? null;

    // For shared agents used by non-owners, load personal memory from agent_memories
    let agentMemoryText = agentRaw?.memory_text ?? null;
    if (agentRaw && agentRaw.user_id !== user.id) {
      const { data: memRow } = await adminClient
        .from('agent_memories')
        .select('memory_text')
        .eq('agent_id', agentRaw.id)
        .eq('user_id', user.id)
        .single();
      agentMemoryText = (memRow as { memory_text: string | null } | null)?.memory_text ?? null;
    }

    const agent = agentRaw ? { ...agentRaw, memory_text: agentMemoryText } : null;
    const agentFileIds: string[] = agent
      ? agent.agent_knowledge_sources
          .map((s: { knowledge_file_id: string | null }) => s.knowledge_file_id)
          .filter((id: string | null): id is string => Boolean(id))
      : [];

    // ── Heuristic router — replaces the AI intent classifier ─────────────────
    // Zero AI calls, <1ms. Decides tool availability based on simple patterns.
    // Workers always get all_tools — they decide internally which to use.
    const isWorker = agentRaw?.is_worker ?? false;
    const routeMode = isWorker ? 'all_tools' : heuristicRoute(content, mentions, (thread as any).artifacts);

    // Workspace features — loaded early so the tool offer + [TOOLS] prompt gate on them
    // (the executors also check ctx.features as a runtime backstop).
    const workspace = await getMyWorkspace(user.id, supabase);
    const features: WorkspaceFeatures = workspace?.features ?? DEFAULT_FEATURES;

    // ── Fetch active routines + document history for workers ──────────────────
    let routinesBrief = '';

    if (isWorker && agentId) {
      const activeRoutines = routinesResult?.data;
      if (activeRoutines && activeRoutines.length > 0) {
        const lines = (activeRoutines as Array<{ name: string; trigger: { type: string; label?: string; cron?: string }; last_run_at: string | null; next_run_at: string | null }>)
          .map(r => {
            const schedule = r.trigger.label
              ?? (r.trigger.type === 'schedule' ? (r.trigger.cron ?? 'scheduled') : 'manual trigger');
            const lastRun = r.last_run_at
              ? (() => {
                  const diff = Date.now() - new Date(r.last_run_at!).getTime();
                  const h = Math.floor(diff / 3_600_000);
                  if (h < 1) return 'ran < 1h ago';
                  if (h < 24) return `ran ${h}h ago`;
                  return `ran ${Math.floor(h / 24)}d ago`;
                })()
              : 'never run yet';
            return `- ${r.name} · ${schedule} · ${lastRun}`;
          });
        routinesBrief = `[YOUR ACTIVE ROUTINES]\n${lines.join('\n')}\nIf the user asks to run one, says "run [name]", or asks what you have scheduled, reference these directly. You can also suggest running a relevant routine when it fits the conversation.`;
      }

    }

    // Format context blocks
    // When an agent is active, its identity takes top priority — injected BEFORE the base prompt.
    // This ensures the model adopts the agent's role rather than treating instructions as an addendum.
    const contextParts: string[] = [];

    if (agent) {
      const agentHeader = isWorker
        // Worker: system layer (locked) + user preferences + active routines
        ? [
            agent.instructions?.trim() ?? `You are ${agent.name}, a dedicated AI colleague.`,
            (agent as typeof agent & { user_preferences?: string | null }).user_preferences?.trim()
              ? `[USER CONTEXT — personal preferences set by this user]\n${(agent as typeof agent & { user_preferences?: string | null }).user_preferences!.trim()}`
              : '',
            routinesBrief || '',
            `[TOOLS YOU HAVE RIGHT NOW — use them, never claim otherwise]\n- web_search: search the live web for any news, data, or information. Call it immediately when the user asks about anything current.\n- fetch_url: read the full content of any URL.\n- deep_research: multi-source research synthesis for complex topics.${features.email ? "\n- get_emails: read the user's inbox." : ''}${features.meetings ? '\n- get_meeting_context: read their calendar and meetings.' : ''}\nNEVER say you cannot access the web, live data, news sources, or current information. You can. Call web_search and do it.`,
            `[TASKS]\nA task is reusable structured work you set up once. It runs on a schedule OR on demand whenever asked (run_task) — so neither of you rebuilds it each time. Offer to set one up whenever work is repeatable, even without a schedule ("want me to save this as a task you can re-run anytime?").\n- list_tasks — see what's already running\n- create_task — set up something new from a plain description\n- get_task — read the full config of a task (steps, schedule, language, instructions)\n- update_task — edit any aspect: name, schedule, output language, task instructions, step prompts, status\n- duplicate_task — copy a task (useful for variants: same pipeline, different language or audience)\n- run_task — trigger a task right now\n- delete_task — remove a task permanently\n- share_task — share a task with the team so teammates can copy it (or stop sharing)\n- list_team_tasks — see tasks shared by teammates\n- use_task — copy a shared team task to your own list\n\nWhen the user asks you to change, update, fix, or adjust a task — YOU MUST COMPLETE THE FULL TOOL SEQUENCE before saying anything. Do not say "Done" or "Updated" until the final action tool has returned a result.\n\nRequired sequences (complete every step, no skipping):\n- Change language / schedule / name / status → list_tasks (get ID) → update_task → say one sentence confirming\n- Change a step prompt → list_tasks (get ID) → get_task (read steps) → update_task with step_patch → confirm\n- Duplicate a task → list_tasks (get ID) → duplicate_task → confirm\n- Run a task → list_tasks (get ID) → run_task → confirm\n- Share a task → list_tasks (get ID) → share_task → confirm\n- Use a team task → list_team_tasks (get ID) → use_task → confirm\n\nNEVER report success after only calling list_tasks. list_tasks only finds the ID — the action hasn't happened yet. A colleague who said "Done, changed to Portuguese" without actually changing it would be fired. Don't be that colleague.`,
            `[YOUR DOCUMENTS]\nlist_worker_documents shows everything you've produced. get_worker_document retrieves the full content. When the user asks to see, revise, or reference something you made, call get_worker_document — don't say you can't retrieve it.`,
            `[TEAM]\nYou work alongside other coworkers. To build on a teammate's output (e.g. research another coworker did), use find_team_work to locate it (by topic, or by coworker name like "Max") and read_team_work to read it — then do your part. Don't ask the user to fetch a teammate's work; get it yourself. The user talks to whoever owns the result they want — so if they ask you for a deliverable that needs a colleague's input, pull it.`,
            `[EMAIL]\nYou can draft and send email as yourself (from your own address). When the user asks you to email someone, call compose_email with to/subject/body — it shows the user an EDITABLE draft to review and send. You NEVER send directly and NEVER say it's sent ("I've drafted it — review and hit Send"). Recipients can be anyone; for "me"/"us" use the user's own address from [YOUR EMAIL ADDRESSES]. The email is **FROM YOU** (the coworker, e.g. your @team.augmtd.ai address) — NOT from the user, so do NOT mimic the user's email style or sign off with the user's name (no "Best, {user}"). Write in your own voice; a signature with your name, role, and address is appended automatically, so **end the body with no sign-off**. If compose_email reports email is off, tell them to enable Email in your Tools tab.`,
            `[LINKEDIN POST]\nWhenever you write a LinkedIn post for the user, deliver it by calling present_linkedin_post (put the post text in the tool, 1–3 variants only if you genuinely drafted alternatives). It renders a real LinkedIn-style preview card — with the character count and the "see more" fold — instead of a wall of text. After calling it, keep your chat reply to a short intro line; don't also paste the full post into the chat.`,
            `[SKILLS]\nSkills are reusable instructions for how to handle a kind of work — a method, process, format, structure, or style. Any skill assigned to you is already in your context above — apply the matching one automatically. If the user asks you to follow an approach or named skill you don't see assigned, call list_skills to check the library, then apply_skill to pull and follow it. When creating or updating a task, pass skill_names to create_task/update_task to enforce specific skills on that task's output (omit to use your assigned skills); use list_skills first if you're unsure of the exact names.`,
            `Understand intent before acting. "Prepare a weekly X", "every Monday do Y", "set up X for me", or anything you'll be asked to repeat = the user wants a reusable task — call create_task immediately (with a schedule if given, otherwise it's run on demand), confirm, done. "What's X?" or "find me X" or "draft X" = do it now with your tools. Never confuse the two. A human colleague would know the difference instantly.`,
            `Speak like a capable colleague, not a software system. Say "Got it, I'll have that ready every Monday" not "I can create a scheduled automation task." Say "I'm on it" not "I don't have direct access to." When a task is clear, do it. One focused question maximum if truly blocked.`,
          ].filter(Boolean).join('\n\n')
        // Standard agent prompt
        : [
            `You are "${agent.name}", a custom AI assistant with a specific role.`,
            agent.instructions?.trim()
              ? `Your instructions:\n${agent.instructions.trim()}`
              : '',
            `Stay in this role for the entire conversation. Do not describe yourself as a general-purpose assistant.`,
            `Approach: when context is incomplete, make a reasonable assumption, state it briefly, and attempt the task. The user wants output. If you must ask, ask ONE focused question — never a list of questions.`,
            agent.web_enabled
              ? `You have access to web_search and fetch_url tools. Use them proactively — do not answer from memory when fresh information is available online.`
              : '',
          ].filter(Boolean).join('\n\n');

      contextParts.push(agentHeader);

      // Assigned skills (workers only) — curated "how to produce X" prompt blocks.
      // Same block the AgentOS bridge injects, so behaviour is identical on both paths.
      if (isWorker) {
        // The user's own addresses → "me"/"us" resolution for compose_email.
        try {
          const ids = await getUserEmailIdentities(adminClient, user.id);
          const mine = [ids.login, ...ids.connected].filter(Boolean);
          if (mine.length) contextParts.push(`[YOUR EMAIL ADDRESSES]\nThe user ("me"/"us") can be reached at: ${mine.join(', ')}. Use these when asked to email the user themselves.`);
        } catch { /* non-fatal */ }
        const skillsBlock = await buildSkillsBlock(supabase, agent.id);
        if (skillsBlock) contextParts.push(skillsBlock);
        const integrationsBlock = await buildConnectedIntegrationsBlock(adminClient, user.id, agent.id);
        if (integrationsBlock) contextParts.push(integrationsBlock);
        // Step 2: the user's WORLD (live initiatives + relationships needing attention) — so the coworker
        // reasons WITH the deals/people. Same block the AgentOS bridge injects (parity). Read-only, non-fatal.
        try {
          const { renderWorldContext } = await import('@/lib/context/brain-context');
          const worldBlock = await renderWorldContext(adminClient, user.id);
          if (worldBlock) contextParts.push(worldBlock);
        } catch { /* non-fatal */ }
        // THE WORKERS READ THE ONE GROUNDING (Aug 8): a message NAMING a registered project pulls
        // that project's FULL room page — the worker and the room read the same truth.
        try {
          const { focusedProjectGrounding } = await import('@/lib/work/worker-grounding');
          const pageBlock = await focusedProjectGrounding(adminClient, user.id, content, { excludeName: agent.name ?? null });
          if (pageBlock) contextParts.push(pageBlock);
        } catch { /* non-fatal */ }
        // THE DAY-STATE BLOCK (initiative loop step 0): the shared headline of the day — a DM
        // answer about the day can never contradict the deck/chief (facts are shared everywhere;
        // depth stays with the role).
        try {
          const { getSharedDayState } = await import('@/lib/home/day-state');
          const dayBlock = await getSharedDayState(adminClient, user.id);
          if (dayBlock) contextParts.push(dayBlock);
        } catch { /* non-fatal */ }
      }

      if (agent.memory_text?.trim()) {
        contextParts.push(
          `[MEMORY — things you've learned about this user from past conversations]\n${agent.memory_text.trim()}`
        );
      }

      // Append base capabilities so the agent still has tools/format knowledge
      contextParts.push(buildChatSystemPrompt(modelFamily));
    } else {
      contextParts.push(buildChatSystemPrompt(modelFamily));
    }

    if (userContextBlock) {
      contextParts.push(
        userContextBlock +
        '\n\n(Answer questions about the user directly from the context above — no tool call needed for anything listed here.)'
      );
    }

    const contacts = (contactsResult.data ?? []) as Array<{
      contact_name: string; contact_email: string; relationship_type: string; importance: number;
      last_interaction: string | null; typical_topics: string[] | null;
    }>;
    if (contacts.length > 0) {
      contextParts.push(
        'KEY CONTACTS (from your network):\n' +
        contacts.map(c => {
          const parts = [`- ${c.contact_name} (${c.contact_email}) — ${c.relationship_type}`];
          if (c.last_interaction) {
            parts.push(`last contact: ${new Date(c.last_interaction).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
          }
          if (c.typical_topics?.length) parts.push(`topics: ${c.typical_topics.slice(0, 3).join(', ')}`);
          return parts.join(', ');
        }).join('\n')
      );
    }

    // Pre-fetched context — injected so the model appears to "just know" relevant info
    if (prefetchedContext) {
      contextParts.push(prefetchedContext);
    }

    // Existing artifacts — inject title + full content so AI can reference and edit them
    const existingArtifacts = ((thread as any).artifacts || []) as DocumentArtifact[];
    if (existingArtifacts.length > 0) {
      const artifactBlocks = existingArtifacts.map(a => {
        const raw = a.type === 'document' && a.content
          ? serializeDocContent(a.content as import('@/lib/types/inbox').DocContent)
          : null;
        const docContent = raw && raw.length > 12000 ? raw.slice(0, 12000) + '\n\n[...document truncated for context...]' : raw;
        return docContent
          ? `DOCUMENT: "${a.title}"\n---\n${docContent}\n---`
          : `DOCUMENT: "${a.title}" (${a.type}) — no preview available`;
      }).join('\n\n');
      contextParts.push(
        'DOCUMENTS ALREADY CREATED IN THIS CONVERSATION:\n\n' + artifactBlocks +
        '\n\nWhen the user asks to edit or update any of these documents, call generate_document immediately — do NOT ask clarifying questions about content you can already see above.'
      );
    }

    // Attachment context from thread files
    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      chatAttachId?: string;
      filename: string;
      mimeType?: string;
      storagePath?: string;
      extractedText: string | null;
    }>;

    // Re-extract text for PDFs that failed at upload time (pdf-parse returned empty string → stored as null).
    // Run against ALL thread attachments — not gated on the current message's attachment IDs — so
    // the text context path works even when the client didn't send attachment IDs in the request body.
    const needsExtraction = userAttachments.filter(ua =>
      !ua.extractedText && ua.mimeType === 'application/pdf' && ua.storagePath
    );
    if (needsExtraction.length > 0) {
      const { extractTextFromAttachment } = await import('@/lib/attachments/text-extractor');
      await Promise.all(needsExtraction.map(async (ua) => {
        try {
          const { data } = await adminClient.storage.from('email-attachments').download(ua.storagePath!);
          if (!data) return;
          const buf = Buffer.from(await data.arrayBuffer());
          const text = await extractTextFromAttachment(buf, 'application/pdf', ua.filename);
          if (!text?.trim()) return;
          ua.extractedText = text.trim().replace(/\u0000/g, '').slice(0, 4000);
        } catch { /* leave null — native-PDF path still handles Bedrock/Anthropic */ }
      }));
      // Persist any newly extracted text so future messages don't re-download
      if (needsExtraction.some(ua => ua.extractedText)) {
        adminClient.from('work_threads')
          .update({ user_attachments: userAttachments })
          .eq('id', threadId)
          .catch(() => {});
      }
    }

    if (userAttachments.some(a => a.extractedText)) {
      const attachCtx = userAttachments
        .filter(a => a.extractedText)
        .map(a => `--- ${a.filename} ---\n${a.extractedText}`)
        .join('\n\n');
      contextParts.push(`ATTACHED FILES:\n${attachCtx}`);
    }


    // Mention context — fetched AFTER system is built; injected into the last user message
    // so the model reads it as user-attached context, not system instructions.
    // Also persisted to work_messages.metadata so subsequent turns can re-inject it from history.
    let mentionContext: string | null = null;
    let mentionKbContext = '';
    if (mentions.length > 0) {
      const mentionResult = await buildMentionContext(mentions, user.id, adminClient);
      mentionContext = mentionResult.mentionContext;
      mentionKbContext = mentionResult.kbContext;
      if (mentionContext && savedMsg?.id) {
        adminClient.from('work_messages')
          .update({ metadata: { mentions, mention_context: mentionContext } })
          .eq('id', savedMsg.id)
          .then(() => {}).catch(() => {});
      }
    }

    // Build tools based on heuristic route — model gets full tool set unless trivially conversational
    const tools = routeMode === 'no_tools'
      ? []
      : buildChatTools(sources, chatEndpoint.provider, modelFamily, isWorker, features);

    // Build message history — system goes first, then conversation.
    // History was loaded in parallel with the insert so excludes the current message;
    // we append it explicitly here, augmented with mentionContext if present.
    const rawHistory = (history || []).map((m: { role: string; content: string; metadata?: unknown }) => {
      const meta = m.metadata as Record<string, unknown> | null;
      const savedMentionCtx = meta?.mention_context as string | undefined;
      return {
        role: m.role as 'user' | 'assistant',
        content: savedMentionCtx ? `${m.content}\n\n${savedMentionCtx}` : m.content,
      };
    });
    // Append current user message (not in history — loaded before insert completed)
    rawHistory.push({
      role: 'user' as const,
      content: mentionContext ? `${content.trim()}\n\n${mentionContext}` : content.trim(),
    });
    // ── Deep research: execute before messages are built so findings go into system context ──
    let preResearchCitations: string[] = [];
    let ranPreResearch = false;
    if (sources.includes('research') && content?.trim()) {
      try {
        const researchOut = await executeDeepResearch(
          { focus: content.trim(), queries: [content.trim()], model: 'fast' },
          ''
        );
        const urlMatches = [...researchOut.matchAll(/https?:\/\/[^\s)\]]+/g)];
        preResearchCitations = [...new Set(urlMatches.map(m => m[0]))].slice(0, 10);
        ranPreResearch = true;
        // Append findings to system so AI synthesises from them
        contextParts.push(
          'DEEP RESEARCH FINDINGS (use these as the primary source — cite specific facts and sources):\n\n' + researchOut
        );
      } catch (err) {
        console.error('[deep_research] pre-stream failed:', err);
      }
    }

    let systemFinal = tools.length === 0
      ? contextParts.join('\n\n') + '\n\nNo tools are available. Do not output any XML, function calls, or <function_calls> blocks. Answer directly from the context above.'
      : contextParts.join('\n\n');

    // Token budget management — prevent silent context overflow on smaller models.
    // ~4 chars per token is a rough heuristic. Trim oldest history messages if over budget.
    const MAX_CONTEXT_CHARS = 48000; // ~12K tokens — safe headroom for 128K context models
    const systemChars = systemFinal.length;
    let historyChars = rawHistory.reduce((sum: number, m: { content?: string }) => sum + (m.content?.length ?? 0), 0);
    let trimmedHistory = rawHistory;
    if (systemChars + historyChars > MAX_CONTEXT_CHARS && rawHistory.length > 10) {
      // Keep last 10 messages to preserve recent context
      trimmedHistory = rawHistory.slice(-10);
      historyChars = trimmedHistory.reduce((sum: number, m: { content?: string }) => sum + (m.content?.length ?? 0), 0);
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemFinal },
      ...trimmedHistory,
    ];

    // Vision: inject image attachments from the current message as base64 content blocks.
    // Download from storage → data URI so all providers (including Bedrock) get base64 format.
    if (attachments.length > 0) {
      const imageAttachRecords = userAttachments.filter((ua: any) =>
        ua.mimeType?.startsWith('image/') &&
        ua.storagePath &&
        attachments.some((a: { id: string }) => a.id === ua.chatAttachId)
      );
      if (imageAttachRecords.length > 0) {
        const downloadResults = await Promise.all(
          imageAttachRecords.map(async (ua: any) => {
            try {
              const { data, error } = await adminClient.storage.from('email-attachments').download(ua.storagePath);
              if (error || !data) return null;
              let buf = Buffer.from(await data.arrayBuffer());
              let mime = ua.mimeType as string;
              // Resize if needed — Bedrock and others cap image payloads at 5 MB
              const { resizeImageIfNeeded } = await import('@/lib/attachments/resize-image');
              ({ buffer: buf, mimeType: mime } = await resizeImageIfNeeded(buf, mime));
              const b64 = buf.toString('base64');
              return { dataUri: `data:${mime};base64,${b64}` };
            } catch {
              return null;
            }
          })
        );
        const imageBlocks = downloadResults
          .filter((r): r is { dataUri: string } => r !== null)
          .map((r) => ({
            type: 'image_url' as const,
            image_url: { url: r.dataUri },
          }));
        if (imageBlocks.length > 0) {
          const lastIdx = messages.findLastIndex((m: OpenAI.Chat.ChatCompletionMessageParam) => m.role === 'user');
          if (lastIdx !== -1) {
            const lastMsg = messages[lastIdx];
            const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
            messages[lastIdx] = {
              role: 'user',
              content: [
                { type: 'text', text: textContent || '(see attached images)' },
                ...imageBlocks,
              ],
            };
          }
        }
      }
    }

    // PDF attachments: for Anthropic/Bedrock providers, inject as native document blocks.
    // Handles PDFs where text extraction returned nothing (truly scanned, no text layer).
    // The Bedrock adapter passes { type: 'document' } blocks through to Anthropic Messages API unchanged.
    // Not gated on attachments[] IDs — reads user_attachments directly so files are visible
    // even when the client didn't send attachment IDs in the request body.
    if (chatEndpoint.provider === 'bedrock' || chatEndpoint.provider === 'anthropic') {
      const pdfAttachRecords = userAttachments.filter((ua: any) =>
        ua.mimeType === 'application/pdf' &&
        !ua.extractedText &&
        ua.storagePath
      );
      if (pdfAttachRecords.length > 0) {
        const pdfResults = await Promise.all(
          pdfAttachRecords.map(async (ua: any) => {
            try {
              const { data, error } = await adminClient.storage.from('email-attachments').download(ua.storagePath);
              if (error || !data) return null;
              const buf = Buffer.from(await data.arrayBuffer());
              return { b64: buf.toString('base64'), filename: ua.filename as string };
            } catch {
              return null;
            }
          })
        );
        const pdfBlocks = pdfResults
          .filter((r): r is { b64: string; filename: string } => r !== null)
          .map((r) => ({
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: r.b64 },
          }));
        if (pdfBlocks.length > 0) {
          const lastIdx = messages.findLastIndex((m) => m.role === 'user');
          if (lastIdx !== -1) {
            const lastMsg = messages[lastIdx];
            const existingBlocks: any[] = Array.isArray(lastMsg.content)
              ? lastMsg.content
              : [{ type: 'text', text: typeof lastMsg.content === 'string' ? lastMsg.content : '' }];
            messages[lastIdx] = { role: 'user', content: [...existingBlocks, ...pdfBlocks] as any };
          }
        }
      }
    }

    // Build run context for document generation
    const runContext = {
      userId: user.id,
      threadId,
      supabase,
      adminClient,
      thread,
      existingArtifacts: ((thread as any).artifacts || []) as DocumentArtifact[],
      userContextBlock: userContextBlock || undefined,
      kbSources: [] as Array<{ id: string; title: string; type: 'kb' }>,
      // Pre-populate with @mention KB content so generate_document is grounded
      // even when the AI didn't call search_knowledge_base
      kbContext: mentionKbContext,
      agentFileIds: agentFileIds.length > 0 ? agentFileIds : undefined,
      agentId: agentId || undefined,
      isWorker,
      isTemporary: !!(thread as any).is_temporary,
      features,
    };

    // ── Stream ────────────────────────────────────────────────────────────────
    let fullAssistantText = '';
    const allToolCalls: Array<{ name: string; summary: string; citations?: string[]; clarification?: object }> = [];
    const allArtifactIds: string[] = [];
    const allArtifactMeta: Record<string, { title: string; type: string }> = {};
    const allWorkflowDrafts: Array<Record<string, unknown>> = [];
          const allEmailDrafts: EmailDraft[] = [];
    const allArtifacts: Record<string, unknown>[] = [];
    // Accumulated across every streamed call this exchange makes (the tool loop can call the
    // model multiple times) — logged once at the end. Native-loop chat only; AgentOS-routed
    // worker chat reports no usage today (see lib/ai/log-usage.ts doc comment).
    let usagePromptTokens = 0;
    let usageCompletionTokens = 0;

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: object) => {
          try { controller.enqueue(encoder.encode(SSE(data))); } catch { /* stream closed */ }
        };

        // SSE heartbeat — keeps connection alive during long tool executions
        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { /* stream closed */ }
        }, 15000);

        // When the user confirms a clarification, we know generate_document will be called.
        // Send an early chip so the user sees feedback immediately during the <think> phase.
        if (routeMode === 'force_generate') {
          send({ type: 'tool_start', name: 'generate_document', id: 'pre-generate', label: 'Generating document' });
        }

        // Research ran before the stream — emit UI events now so the step chip appears
        if (ranPreResearch) {
          send({ type: 'tool_start', name: 'deep_research', id: 'pre-research', label: 'Deep research' });
          send({ type: 'tool_result', name: 'deep_research', id: 'pre-research', summary: 'Research complete', ...(preResearchCitations.length ? { citations: preResearchCitations } : {}) });
        }

        // ── Deep research: run directly before AI loop, don't rely on model to invoke it ──
        if (sources.includes('research') && content?.trim()) {
          send({ type: 'tool_start', name: 'deep_research', id: 'pre-research', label: 'Researching…' });
          try {
            const researchResult = await executeDeepResearch(
              { focus: content.trim(), model: 'fast' },
              ''
            );
            // Parse source URLs from the result to show as citations
            const citationMatches = [...researchResult.matchAll(/https?:\/\/[^\s)\]]+/g)];
            const citations = [...new Set(citationMatches.map(m => m[0]))].slice(0, 10);
            send({ type: 'tool_result', name: 'deep_research', id: 'pre-research', summary: 'Research complete', ...(citations.length ? { citations } : {}) });
            // Inject research findings into the system context so AI synthesises from them
            systemFinal = systemFinal + '\n\n' +
              'DEEP RESEARCH FINDINGS (use these as the primary source for your answer — cite specific facts):\n\n' +
              researchResult;
          } catch (err) {
            send({ type: 'tool_result', name: 'deep_research', id: 'pre-research', summary: 'Research unavailable' });
            console.error('[deep_research] pre-loop execution failed:', err);
          }
        }

        try {
          let continueLoop = true;
          let turnIndex = 0;
          let toolRetries = 0;
          const MAX_TOOL_RETRIES = 2;
          // THE WORD IS THE DEED — STRUCTURAL (Aug 8): one corrective round max per turn.
          let wordDeedCorrected = false;
          // Dedup: prevent same tool+query being called twice in one turn
          const calledTools = new Set<string>();
          const toolResultCache = new Map<string, string>();

          while (continueLoop) {
            // Accumulate tool call fragments — OpenAI streams arguments in pieces
            const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();
            let turnText = '';
            // Once XML tool call markers appear mid-stream, stop sending live deltas
            // and wait for text_set at stream end to show the clean version.
            let xmlStreamSuppressed = false;
            // Tracks whether we are currently inside a <think>...</think> block
            let inThinkBlock = false;

            // Retry wrapper for transient errors (429, 503, 529)
            let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
            let attempts = 0;
            while (true) {
              try {
                const hasTools = tools.length > 0;
                // Temperature: low when tools available (reliable selection), higher for pure conversation
                const temperature = hasTools ? 0.15 : 0.5;
                stream = await aiClient.chat.completions.create({
                  model: chatModel,
                  max_tokens: 4096,
                  temperature,
                  ...(hasTools ? {
                    tools,
                    tool_choice: deriveToolChoice(routeMode, turnIndex),
                    parallel_tool_calls: false,
                  } : {}),
                  messages,
                  stream: true,
                  stream_options: { include_usage: true },
                }) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
                turnIndex++;
                break;
              } catch (err: any) {
                const retryable = err?.status === 429 || err?.status === 503 || err?.status === 529;
                if (retryable && attempts < 2) {
                  attempts++;
                  await new Promise(r => setTimeout(r, 1000 * attempts));
                } else {
                  throw err;
                }
              }
            }

            let sawFinish = false;

            for await (const chunk of stream) {
              // The include_usage:true final chunk carries usage with an empty choices array —
              // check it before the `!choice` skip below drops it.
              if (chunk.usage) {
                usagePromptTokens += chunk.usage.prompt_tokens ?? 0;
                usageCompletionTokens += chunk.usage.completion_tokens ?? 0;
              }

              const choice = chunk.choices[0];
              if (!choice) continue;

              const delta = choice.delta;
              const finishReason = choice.finish_reason as string | null;

              // Stream text delta — suppress once XML tool call markers appear
              if (delta?.content) {
                turnText += delta.content;
                if (!xmlStreamSuppressed) {
                  const hasThink = turnText.includes('<think>');
                  const hasOtherXml = turnText.includes('<function_calls>') ||
                    turnText.includes('<tool_call>') ||
                    XML_TOOL_NAMES.some(n => turnText.includes(`<${n}>`));
                  if (hasThink || hasOtherXml) {
                    xmlStreamSuppressed = true;
                    // Immediately show clean version (strips XML and anything after it)
                    const cleanSoFar = stripXmlToolCalls(turnText);
                    send({ type: 'text_set', content: cleanSoFar });
                    // If triggered by <think>, start streaming thinking content
                    if (hasThink) {
                      inThinkBlock = true;
                      const openIdx = turnText.indexOf('<think>');
                      const closeIdx = turnText.indexOf('</think>');
                      if (closeIdx > openIdx) {
                        const thinking = turnText.slice(openIdx + 7, closeIdx);
                        if (thinking) send({ type: 'thinking_delta', delta: thinking });
                        send({ type: 'thinking_done' });
                        inThinkBlock = false;
                      } else {
                        const thinking = turnText.slice(openIdx + 7);
                        if (thinking) send({ type: 'thinking_delta', delta: thinking });
                      }
                    }
                  } else {
                    send({ type: 'text', delta: delta.content });
                  }
                } else if (inThinkBlock) {
                  // Stream thinking content chunk by chunk until </think>
                  if (delta.content.includes('</think>')) {
                    const idx = delta.content.indexOf('</think>');
                    const thinkPart = delta.content.slice(0, idx);
                    if (thinkPart) send({ type: 'thinking_delta', delta: thinkPart });
                    send({ type: 'thinking_done' });
                    inThinkBlock = false;
                  } else {
                    send({ type: 'thinking_delta', delta: delta.content });
                  }
                }
                // else: xmlStreamSuppressed && !inThinkBlock — XML tool call, accumulate silently
              }

              // Accumulate tool call fragments by index
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (!toolCallAccum.has(tc.index)) {
                    toolCallAccum.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
                  }
                  const acc = toolCallAccum.get(tc.index)!;
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name = tc.function.name;
                  if (tc.function?.arguments) acc.args += tc.function.arguments;
                }
              }

              if (finishReason === 'stop' || finishReason === 'end_turn' || finishReason === 'eos' || finishReason === 'length') {
                sawFinish = true;
                // Close any unclosed think block (stream ended while still reasoning)
                if (inThinkBlock) { send({ type: 'thinking_done' }); inThinkBlock = false; }

                // Some models (OSS models on OpenAI-compatible hosts, Claude via Anthropic compat) emit tool calls
                // as XML text instead of structured tool_calls deltas. Always strip XML from the
                // displayed text; only execute as tool calls when no structured calls were received.
                const cleanText = stripXmlToolCalls(turnText);
                if (cleanText !== turnText) {
                  send({ type: 'text_set', content: cleanText });
                }

                const xmlCalls = toolCallAccum.size === 0 ? parseXmlToolCalls(turnText) : null;
                if (xmlCalls && xmlCalls.length > 0) {
                  fullAssistantText += cleanText;

                  const syntheticToolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = xmlCalls.map((c, i) => ({
                    id: `xml-${Date.now()}-${i}`,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  }));

                  messages.push({ role: 'assistant', content: cleanText || null, tool_calls: syntheticToolCalls });

                  const toolResultMessages: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
                  for (const _tc of syntheticToolCalls) {
                    const tc = _tc as { id: string; function: { name: string; arguments: string } };
                    let toolInput: Record<string, unknown> = {};
                    try { toolInput = JSON.parse(tc.function.arguments); } catch {}

                    const dedupeKey = `${tc.function.name}:${String(toolInput.query ?? toolInput.filter ?? '')}`;
                    if (calledTools.has(dedupeKey)) {
                      toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResultCache.get(dedupeKey) ?? 'Already retrieved.' });
                      continue;
                    }
                    calledTools.add(dedupeKey);

                    send({ type: 'tool_start', name: tc.function.name, id: tc.id, label: toolLabel(tc.function.name) });
                    const { result, summary, artifact, citations, clarification, stopStream, emailDraft, cardArtifact, workflowDraft } = await executeChatTool(tc.function.name, toolInput, sources, runContext);
                    send({ type: 'tool_result', name: tc.function.name, id: tc.id, summary, ...(citations?.length ? { citations } : {}) });
                    allToolCalls.push({ name: tc.function.name, summary, ...(citations?.length ? { citations } : {}) });
                    if (clarification) send({ type: 'clarification_request', ...(clarification as object) });
                    if (artifact?.id) { allArtifactIds.push(artifact.id); allArtifactMeta[artifact.id] = { title: artifact.title, type: artifact.type }; send({ type: 'artifact_ready', artifact: { id: artifact.id, type: artifact.type, title: artifact.title } }); }
                    if (emailDraft) { allEmailDrafts.push(emailDraft); send({ type: 'email_draft', draft: emailDraft }); }
                    if (workflowDraft) { allWorkflowDrafts.push(workflowDraft); send({ type: 'workflow_draft', draft: workflowDraft }); }
                    if (cardArtifact) { allArtifacts.push(cardArtifact); send({ type: 'artifact', artifact: cardArtifact }); }
                    toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                    toolResultCache.set(dedupeKey, result);
                    if (stopStream) { continueLoop = false; break; }
                  }
                  for (const tr of toolResultMessages) messages.push(tr);
                  if (continueLoop) continueLoop = true; // continue to get AI's response after tools
                } else {
                  // THE WORD IS THE DEED — STRUCTURAL (Aug 8; the prompt rule alone failed live:
                  // "I've created a focused priorities report", tool_calls: []): a final reply
                  // CLAIMING a document while none was produced this turn gets ONE corrective
                  // round — produce it now or restate without the claim. Never ship the lie.
                  const claimsDoc = /\b(?:i(?:'ve| have)?\s+(?:created|prepared|generated|put together)|created)\b[^.!?\n]{0,80}\b(?:document|report|file|deck|spreadsheet|presentation|pdf)\b/i.test(cleanText);
                  if (claimsDoc && allArtifactIds.length === 0 && !wordDeedCorrected) {
                    wordDeedCorrected = true;
                    send({ type: 'text_clear' });
                    messages.push({ role: 'assistant', content: cleanText || '' });
                    messages.push({ role: 'user', content: '[SYSTEM CHECK — not the user] Your reply claims a document was created, but generate_document was never called: no document exists. Either call generate_document NOW with the full content and then summarize, or restate your reply without claiming a document. Never claim what was not done. Do not apologize or mention this check.' });
                    // continueLoop stays true → one more round.
                  } else {
                    fullAssistantText += cleanText;
                    messages.push({ role: 'assistant', content: cleanText || '' });
                    continueLoop = false;
                  }
                }

              } else if (finishReason === 'tool_calls') {
                sawFinish = true;
                if (inThinkBlock) { send({ type: 'thinking_done' }); inThinkBlock = false; }
                const cleanTurnText = stripXmlToolCalls(turnText);
                // Don't accumulate inter-turn narration into fullAssistantText — only the final
                // response turn should be saved. Intermediate narration was already streamed to UI.

                // Flush any suppressed text before the tool chips appear, then immediately clear
                // so the streaming display resets for the next turn / final response.
                if (cleanTurnText && xmlStreamSuppressed) {
                  send({ type: 'text_set', content: cleanTurnText });
                }
                // Signal client to clear streaming text now that tools are about to fire
                send({ type: 'text_clear' });

                const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] =
                  Array.from(toolCallAccum.values()).map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: tc.args },
                  }));

                // Add assistant turn with tool calls to history
                messages.push({
                  role: 'assistant',
                  content: turnText || null,
                  tool_calls: toolCalls,
                });

                const toolResultMessages: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

                for (const _tc of toolCalls) {
                  const tc = _tc as { id: string; function: { name: string; arguments: string } };
                  let toolInput: Record<string, unknown>;
                  try {
                    toolInput = JSON.parse(tc.function.arguments);
                  } catch {
                    toolInput = {};
                  }

                  // Dedup: if same tool+query already ran this turn, return cached result silently
                  const dedupeKey = `${tc.function.name}:${String(toolInput.query ?? toolInput.filter ?? '')}`;
                  if (calledTools.has(dedupeKey)) {
                    const cached = toolResultCache.get(dedupeKey) ?? 'Already retrieved.';
                    toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: cached });
                    continue;
                  }
                  calledTools.add(dedupeKey);

                  send({ type: 'tool_start', name: tc.function.name, id: tc.id, label: toolLabel(tc.function.name) });

                  const { result, summary, artifact, citations, clarification, stopStream, retryCorrection, emailDraft, cardArtifact, workflowDraft } = await executeChatTool(
                    tc.function.name,
                    toolInput,
                    sources,
                    runContext
                  );

                  // Validation failed — inject correction and retry via next loop iteration
                  if (retryCorrection) {
                    if (toolRetries < MAX_TOOL_RETRIES) {
                      toolRetries++;
                      toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                    } else {
                      // Retries exhausted — surface a fallback so the user sees something
                      const fallback = "I found some relevant content but ran into an issue preparing the confirmation. Could you rephrase your request or let me know what you'd like to do next?";
                      send({ type: 'text', delta: fallback });
                      fullAssistantText += fallback;
                      continueLoop = false;
                    }
                    break;
                  }

                  send({ type: 'tool_result', name: tc.function.name, id: tc.id, summary, ...(citations?.length ? { citations } : {}) });
                  allToolCalls.push({ name: tc.function.name, summary, ...(citations?.length ? { citations } : {}) });

                  if (clarification) {
                    send({ type: 'clarification_request', ...(clarification as object) });
                  }

                  if (artifact?.id) {
                    allArtifactIds.push(artifact.id);
                    allArtifactMeta[artifact.id] = { title: artifact.title, type: artifact.type };
                    send({ type: 'artifact_ready', artifact: { id: artifact.id, type: artifact.type, title: artifact.title } });
                  }

                  if (emailDraft) { allEmailDrafts.push(emailDraft); send({ type: 'email_draft', draft: emailDraft }); }
                  if (workflowDraft) { allWorkflowDrafts.push(workflowDraft); send({ type: 'workflow_draft', draft: workflowDraft }); }
                  if (cardArtifact) { allArtifacts.push(cardArtifact); send({ type: 'artifact', artifact: cardArtifact }); }

                  toolResultMessages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: result,
                  });
                  toolResultCache.set(dedupeKey, result);

                  if (stopStream) {
                    continueLoop = false;
                    allToolCalls[allToolCalls.length - 1] = {
                      ...allToolCalls[allToolCalls.length - 1],
                      clarification: clarification as object,
                    };
                    break;
                  }
                }

                // Add tool results to history (even when stopping, preserves clarification context)
                for (const tr of toolResultMessages) {
                  messages.push(tr);
                }

                if (!continueLoop) break;
              }
            }

            // Fallback: if the stream closed without a recognized finish_reason
            // (e.g. OSS models on OpenAI-compatible hosts send null or an unknown value), treat it as stop.
            if (!sawFinish && continueLoop) {
              fullAssistantText += turnText;
              messages.push({ role: 'assistant', content: turnText || '' });
              continueLoop = false;
            }
          }

          // If tools ran but the model returned empty text, retry once with a nudge
          if (!fullAssistantText.trim() && allToolCalls.length > 0) {
            messages.push({
              role: 'user',
              content: 'Please respond based on the tool results above. List specific items by name.',
            });
            try {
              let retryRaw = '';
              const retryStream = await aiClient.chat.completions.create({
                model: chatModel,
                max_tokens: 4096,
                temperature: 0.5,
                messages,
                stream: true,
                stream_options: { include_usage: true },
              }) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
              let retrySuppressed = false;
              for await (const chunk of retryStream) {
                if (chunk.usage) {
                  usagePromptTokens += chunk.usage.prompt_tokens ?? 0;
                  usageCompletionTokens += chunk.usage.completion_tokens ?? 0;
                }
                const delta = chunk.choices[0]?.delta;
                if (delta?.content) {
                  retryRaw += delta.content;
                  if (!retrySuppressed) {
                    if (retryRaw.includes('<think>')) {
                      retrySuppressed = true;
                    } else {
                      send({ type: 'text', delta: delta.content });
                    }
                  }
                  // Once think block closes, start streaming the clean text after it
                  if (retrySuppressed && retryRaw.includes('</think>')) {
                    retrySuppressed = false;
                    const afterThink = retryRaw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                    if (afterThink) {
                      send({ type: 'text_set', content: afterThink });
                    }
                  }
                }
              }
              // Final cleanup — strip any remaining think blocks
              fullAssistantText = retryRaw
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<think>[\s\S]*$/gi, '')
                .trim();
              send({ type: 'text_set', content: fullAssistantText });
            } catch (retryErr) {
              console.error('[Chat] Empty-response retry failed:', retryErr);
            }
          }

          // Auto-rename — fire and forget so it doesn't block the done event
          if (isFirstMessage) {
            generateAutoTitle(content, user.id, supabase, adminClient, threadId)
              .then(title => { if (title) send({ type: 'title_update', title }); })
              .catch(() => {});
          }

          // Memory extraction — fire and forget after agent conversations
          if (runContext.agentId) {
            fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/agents/${runContext.agentId}/extract-memory`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') ?? '' },
              body: JSON.stringify({ threadId }),
            }).catch(() => {});
          }

          send({ type: 'done' });
        } catch (err) {
          console.error('[Chat] Stream error:', err);
          send({ type: 'error', message: 'An error occurred. Please try again.' });
        } finally {
          clearInterval(heartbeat);
          // Save complete assistant message
          try {
            const clarificationCall = allToolCalls.find(t => t.name === 'request_clarification');
            await adminClient.from('work_messages').insert({
              thread_id: threadId,
              role: 'assistant',
              content: fullAssistantText,
              metadata: {
                tool_calls: allToolCalls,
                artifact_ids: allArtifactIds,
                ...(Object.keys(allArtifactMeta).length > 0 ? { artifact_meta: allArtifactMeta } : {}),
                ...(allEmailDrafts.length > 0 ? { email_drafts: allEmailDrafts } : {}),
                ...(allWorkflowDrafts.length > 0 ? { workflow_drafts: allWorkflowDrafts } : {}),
                ...(allArtifacts.length > 0 ? { artifacts: allArtifacts } : {}),
                ...(clarificationCall?.clarification ? { clarification: clarificationCall.clarification } : {}),
              },
            });
            await adminClient
              .from('work_threads')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', threadId);
          } catch (saveErr) {
            console.error('[Chat] Failed to save message:', saveErr);
          }
          logAIUsage(adminClient, {
            userId: user.id,
            agentId: runContext.agentId ?? null,
            source: 'chat',
            provider: chatEndpoint.provider,
            model: chatModel,
            tier: chatTier,
            taskType: 'conversation',
            usage: { prompt_tokens: usagePromptTokens, completion_tokens: usageCompletionTokens },
          }).catch(() => {});
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[Chat] POST error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

// ── Tool definitions (neutral schema — input_schema maps directly to OpenAI parameters) ──

interface NeutralTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

function deriveToolChoice(
  routeMode: RouteMode,
  turnIndex: number
): OpenAI.Chat.ChatCompletionToolChoiceOption {
  // Only force on the very first API call of this request — subsequent tool-loop
  // turns must be 'auto' to avoid infinite generation loops.
  if (turnIndex === 0 && routeMode === 'force_generate') {
    return { type: 'function', function: { name: 'generate_document' } };
  }
  return 'auto';
}

function buildChatTools(sources: string[], _provider: string, _modelFamily: string, isWorker = false, features: WorkspaceFeatures = DEFAULT_FEATURES): OpenAI.Chat.ChatCompletionTool[] {
  const neutral: NeutralTool[] = [];

  // ── Search tools ──────────────────────────────────────────────────────────
  if (sources.includes('kb')) {
    neutral.push({
      name: 'search_knowledge_base',
      description: "Search indexed files and Drive documents for relevant content.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Specific search query' },
        },
        required: ['query'],
      },
    });
  }

  if (sources.includes('kb')) {
    neutral.push({
      name: 'read_document',
      description: "Read the full content of a specific document. Call after search_knowledge_base finds a relevant file and you need more detail than the search excerpt.",
      input_schema: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: 'File ID from search results' },
          filename: { type: 'string', description: 'Filename (for display)' },
        },
        required: ['file_id', 'filename'],
      },
    });
  }

  if (sources.includes('inbox')) {
    neutral.push(getEmailsDefinition);
    neutral.push({
      name: 'get_email_body',
      description: "Read the full body of a specific email by ID. Call after get_emails identifies the email you need.",
      input_schema: {
        type: 'object',
        properties: {
          email_id: { type: 'string', description: 'The email ID from get_emails results' },
        },
        required: ['email_id'],
      },
    });
  }

  if (sources.includes('calendar')) {
    neutral.push(getMeetingContextDefinition);
  }

  // deep_research is executed directly before the AI loop (not as a model-invoked tool)
  // so it is intentionally omitted from the tool list here.

  // ── Web tools — available when user enables web search ─────────────────────
  if (sources.includes('web')) {
    neutral.push(
      webSearchDefinition,
      fetchUrlDefinition,
    );
  }

  // ── Compute (Arc 1) — sandboxed code over the user's files/data; reversible by construction
  // (the sandbox cannot send). Gates itself on env config inside the executor. ──
  neutral.push(runComputeDefinition);

  // ── Action tools ────────────────────────────────────────────────────────────
  neutral.push(
    {
      name: 'request_clarification',
      description: "Present a confirmation card before generating a file. Call ONLY when: (1) the user's message explicitly requested a file artifact using words like 'document', 'Word doc', 'spreadsheet', 'presentation', 'deck', 'PDF', 'file', 'to download', 'to send as' AND (2) you have searched and found relevant content. Content type alone is never enough — 'write a press release / report / proposal / summary' does NOT qualify. Do NOT call when searches returned nothing — respond conversationally instead.",
      input_schema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            minLength: 10,
            description: 'A STATEMENT of what you will create — must be declarative, not a question. Example: "I\'ll create a pricing summary using the three documents I found."',
          },
          sources: {
            type: 'array',
            description: 'Documents/items found. Use EXACT full filenames from search results.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string', minLength: 3, description: 'EXACT full filename from search results — never abbreviated' },
                type: { type: 'string', enum: ['kb', 'email', 'calendar'] },
              },
              required: ['id', 'title', 'type'],
            },
          },
          options: {
            type: 'array',
            description: 'Optional choice groups (max 3) for genuinely ambiguous decisions.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                choices: { type: 'array', items: { type: 'string' } },
                default: { type: 'string' },
              },
              required: ['key', 'label', 'choices'],
            },
          },
        },
        required: ['question'],
      },
    },
    {
      name: 'generate_document',
      description: "Generate a downloadable file artifact. Call ONLY when the user explicitly asked for a file using words like 'document', 'Word doc', 'spreadsheet', 'presentation', 'deck', 'PDF', 'file', 'to download', 'to send as'. Content type alone is never a trigger — 'write a press release / report / proposal / summary / draft an email' always produces inline text, not a file. Only 'create a press release document' / 'I need a Word report' / 'make me a presentation' triggers this tool.",
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['word', 'excel', 'pptx', 'email'], description: 'File format. "word" = user asked for a Word doc / document / report to download. "excel" = user asked for a spreadsheet / tracker / budget. "pptx" = user asked for a presentation / deck / slides. "email" = user explicitly asked to send an email or open a draft in their mail client — NOT for "write an email about X" (that goes inline).' },
          instructions: { type: 'string', description: 'Detailed instructions: purpose, audience, key sections, tone, specific data to include.' },
        },
        required: ['type', 'instructions'],
      },
    },
  );

  // Worker-only tools — task management + document access
  if (isWorker) {
    neutral.push(
      listTasksDefinition, createTaskDefinition, getTaskDefinition, updateTaskDefinition, duplicateTaskDefinition, deleteTaskDefinition, runTaskDefinition,
      shareTaskDefinition, listTeamTasksDefinition, useTaskDefinition,
      listWorkerDocumentsDefinition, getWorkerDocumentDefinition,
      listSkillsDefinition, applySkillDefinition,
      slackListChannelsDefinition, slackPostMessageDefinition, slackReadMessagesDefinition, slackListMembersDefinition,
      findTeamWorkDefinition, readTeamWorkDefinition,
      composeEmailDefinition,
      {
        name: 'present_linkedin_post',
        description: "Present a finished LinkedIn post to the user as a rich, reviewable card (faithful preview, character count, the \"see more\" fold). Call this whenever you've written a LinkedIn post for the user — put the post text HERE, not in your chat reply. Display-only (it does not publish). Provide 1–3 variants only if you genuinely drafted alternatives. After calling it, keep your chat reply to a short intro line.",
        input_schema: {
          type: 'object',
          properties: {
            variants: {
              type: 'array',
              description: '1–3 post options.',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'The full post text.' },
                  hashtags: { type: 'array', items: { type: 'string' }, description: 'Optional hashtags (without #).' },
                },
                required: ['text'],
              },
            },
          },
          required: ['variants'],
        },
      },
    );
  }

  // Drop any tool whose workspace feature is off (single source: tool-capabilities map),
  // then convert to OpenAI function-calling format.
  return neutral.filter(t => isToolAllowed(t.name, features)).map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    search_knowledge_base: 'Searching knowledge base',
    read_document: 'Reading document',
    get_emails: 'Checking emails',
    get_email_body: 'Reading email',
    get_meeting_context: 'Checking meetings & calendar',
    deep_research: 'Researching…',
    web_search: 'Searching the web',
    fetch_url: 'Reading page',
    request_clarification: 'Preparing options',
    generate_document: 'Generating document',
    list_tasks: 'Checking tasks',
    create_task: 'Building task pipeline…',
    get_task: 'Reading task config',
    update_task: 'Updating task',
    delete_task: 'Deleting task',
    run_task: 'Running task…',
    share_task: 'Sharing task with team',
    list_team_tasks: 'Checking team tasks',
    use_task: 'Adding task from team…',
    list_worker_documents: 'Checking documents',
    get_worker_document: 'Retrieving document…',
    compose_email: 'Drafting email…',
    present_linkedin_post: 'Preparing LinkedIn post…',
  };
  return labels[name] ?? name;
}

interface RunContext {
  userId: string;
  threadId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any;
  thread: { user_attachments?: unknown };
  existingArtifacts: DocumentArtifact[];
  userContextBlock?: string;
  /** Accumulates real KB file data from search_knowledge_base calls — used to enrich request_clarification sources */
  kbSources: Array<{ id: string; title: string; type: 'kb' }>;
  /** Accumulates actual KB text chunks from search_knowledge_base calls — passed to generate_document to ground output */
  kbContext: string;
  /** Agent-scoped KB file IDs — search is scoped to these files first, then falls through to global KB */
  agentFileIds?: string[];
  /** Agent ID — used to trigger memory extraction after conversation */
  agentId?: string;
  /** True when the agent is a worker — enables task management tools */
  isWorker?: boolean;
  isTemporary?: boolean;
  /** Workspace feature flags — drives graceful degradation of context tools */
  features: WorkspaceFeatures;
}

// ── Clarification validator ───────────────────────────────────────────────────

function validateClarificationInput(input: Record<string, unknown>): string | null {
  const q = ((input.question as string) ?? '').trim();
  if (!q || q.length < 10) {
    return 'The "question" field is empty or too short. Write a 1–2 sentence statement describing exactly what you will create (minimum 10 characters).';
  }
  if (q.endsWith('?')) {
    return 'The "question" field must be a declarative statement, not a question. Remove the question mark and rewrite as a confident declaration of what you will create. Example: "I\'ll create a pricing summary using the three documents I found."';
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeDocContent(doc: import('@/lib/types/inbox').DocContent): string {
  const lines: string[] = [doc.title];
  if (doc.subtitle) lines.push(doc.subtitle);
  for (const section of doc.sections) {
    lines.push(`\n## ${section.heading}`);
    for (const p of section.paragraphs) lines.push(p);
  }
  return lines.join('\n\n');
}

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeChatTool(
  name: string,
  input: Record<string, unknown>,
  sources: string[],
  ctx: RunContext
): Promise<{ result: string; summary: string; artifact?: DocumentArtifact; citations?: string[]; clarification?: object; stopStream?: boolean; retryCorrection?: string; emailDraft?: EmailDraft; cardArtifact?: Record<string, unknown>; workflowDraft?: Record<string, unknown> }> {
  switch (name) {
    case 'compose_email': {
      const { result, draft } = await executeComposeEmail(input, ctx.userId, ctx.agentId, ctx.adminClient);
      return { result, summary: draft ? 'Drafted an email' : 'Email is off', emailDraft: draft ?? undefined };
    }
    case 'present_linkedin_post': {
      // Display-only render-registry card (mirrors the AgentOS present_linkedin_post tool).
      const raw = Array.isArray(input.variants) ? input.variants : [];
      const variants = raw
        .map((v) => {
          const o = (v ?? {}) as Record<string, unknown>;
          return {
            text: String(o.text ?? '').trim(),
            hashtags: Array.isArray(o.hashtags) ? (o.hashtags as unknown[]).map((h) => String(h)) : [],
          };
        })
        .filter((v) => v.text);
      if (!variants.length) return { result: 'No post text provided.', summary: 'No post' };
      return {
        result: `Presented the LinkedIn post${variants.length > 1 ? ` (${variants.length} variants)` : ''} to the user for review.`,
        summary: 'Presented LinkedIn post',
        cardArtifact: { type: 'linkedin_post', variants },
      };
    }
    case 'request_clarification': {
      // Validate question field before doing anything else
      const validationError = validateClarificationInput(input);
      if (validationError) {
        return {
          result: `Tool call rejected — fix these issues and call request_clarification again: ${validationError}`,
          summary: 'Retrying clarification',
          retryCorrection: validationError,
        };
      }

      // Enrich sources: replace KB-type sources (which models often fill with empty/bad titles)
      // with the real file data accumulated from search_knowledge_base calls.
      const modelSources = Array.isArray(input.sources)
        ? input.sources as Array<{ id: string; title: string; type: string }>
        : [];
      // Keep non-KB sources the model provided (emails, calendar items)
      const nonKbSources = modelSources.filter(s => s.type !== 'kb');
      // Use real KB file data if we have it; otherwise fall back to whatever the model provided
      const kbSources = ctx.kbSources.length > 0
        ? ctx.kbSources
        : modelSources.filter(s => s.type === 'kb');
      // Deduplicate by id and remove any sources with blank titles
      const seen = new Set<string>();
      const enrichedSources = [...kbSources, ...nonKbSources].filter(s => {
        if (!s.title || s.title.trim().length < 2) return false;
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      const clarification = {
        question: input.question as string,
        sources: enrichedSources,
        options: Array.isArray(input.options) ? input.options as Array<{ key: string; label: string; choices: string[]; default?: string }> : [],
      };
      return {
        result: 'Clarification presented to user. Stream will pause until user confirms.',
        summary: 'Awaiting your confirmation',
        clarification,
        stopStream: true,
      };
    }

    case 'search_knowledge_base': {
      if (!ctx.features.drive) {
        return {
          result: 'Knowledge base access is not enabled for this workspace.',
          summary: 'Drive module disabled',
        };
      }
      const query = input.query as string;
      const kbCtx = await buildKBContext(ctx.userId, query, ctx.adminClient, {
        fileLimit: 5,
        maxChunksPerFile: 3,
        threshold: 0.2,
        maxTotalChars: 8000,
        scopeFileIds: ctx.agentFileIds,
      });
      // SINGLE-SOURCE #2: the connected drives ride the same search — one helper, no new tool.
      const { driveSupplementLine } = await import('@/lib/knowledge/resolve');
      const driveLine = await driveSupplementLine(ctx.adminClient, ctx.userId, query);
      const result = (kbCtx.context || 'No relevant documents found in your knowledge base.') + driveLine;
      const filenames = kbCtx.filenames ?? [];
      const summary = filenames.length > 0 ? `Found ${filenames.length} relevant document${filenames.length > 1 ? 's' : ''}` : 'No relevant documents found';
      // Accumulate real file data for enriching request_clarification sources
      for (const g of kbCtx.fileGroups) {
        if (!ctx.kbSources.some(s => s.id === g.fileId)) {
          ctx.kbSources.push({ id: g.fileId, title: g.filename, type: 'kb' });
        }
      }
      // Accumulate actual KB text so generate_document can ground its output in it
      if (kbCtx.context) {
        ctx.kbContext = ctx.kbContext
          ? `${ctx.kbContext}\n\n${kbCtx.context}`
          : kbCtx.context;
      }
      return { result, summary, citations: filenames };
    }

    case 'read_document': {
      if (!ctx.features.drive) {
        return {
          result: 'Knowledge base access is not enabled for this workspace.',
          summary: 'Drive module disabled',
        };
      }
      const fileId = input.file_id as string;
      const filename = (input.filename as string) || 'document';
      const MAX_CHARS = 12000;
      const { data: chunks } = await ctx.adminClient
        .from('knowledge_chunks')
        .select('heading, content, chunk_index')
        .eq('file_id', fileId)
        .order('chunk_index', { ascending: true })
        .limit(50);
      if (!chunks || chunks.length === 0) {
        return { result: `No content found for "${filename}".`, summary: 'Document not found' };
      }
      let totalChars = 0;
      const sections: string[] = [];
      for (const chunk of chunks) {
        const text = chunk.heading ? `## ${chunk.heading}\n${chunk.content}` : chunk.content;
        if (totalChars + text.length > MAX_CHARS) {
          sections.push(text.slice(0, MAX_CHARS - totalChars) + '\n…[truncated]');
          break;
        }
        sections.push(text);
        totalChars += text.length;
      }
      const fullText = `[${filename}]\n\n${sections.join('\n\n')}`;
      // Also accumulate as KB context for grounding generation
      ctx.kbContext = ctx.kbContext ? `${ctx.kbContext}\n\n${fullText}` : fullText;
      if (!ctx.kbSources.some(s => s.id === fileId)) {
        ctx.kbSources.push({ id: fileId, title: filename, type: 'kb' });
      }
      return { result: fullText, summary: `Read "${filename}" (${chunks.length} sections)`, citations: [filename] };
    }

    case 'get_emails': {
      if (!ctx.features.email) {
        return {
          result: 'Email access is not enabled for this workspace.',
          summary: 'Email module disabled',
        };
      }
      // Map 'filter' (AI schema name) → 'topic' (executor param)
      const emailConfig: Record<string, unknown> = { ...input };
      if (typeof input.filter === 'string') emailConfig.topic = input.filter;
      const result = await executeGetEmails(emailConfig, ctx.userId, ctx.supabase);
      const lineCount = result.split('\n\n').length - 1;
      const summary = result.startsWith('No emails') ? 'No matching emails found' : `Found ${lineCount} email${lineCount !== 1 ? 's' : ''}`;
      return { result, summary };
    }

    case 'get_email_body': {
      if (!ctx.features.email) {
        return { result: 'Email access is not enabled for this workspace.', summary: 'Email module disabled' };
      }
      const emailId = input.email_id as string;
      const { data: item } = await ctx.supabase
        .from('inbox_items')
        .select('source_data, created_at')
        .eq('id', emailId)
        .eq('user_id', ctx.userId)
        .single();
      if (!item) {
        return { result: `Email not found: ${emailId}`, summary: 'Email not found' };
      }
      const sd = item.source_data as Record<string, unknown>;
      const from = sd?.from_name ? `${sd.from_name} <${sd.from_address || ''}>` : (sd?.from as string || 'Unknown');
      const subject = (sd?.subject as string) || '(no subject)';
      const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const rawBody = (sd?.body as string) ||
        (sd?.html_body ? (sd.html_body as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '') ||
        (sd?.snippet as string) || '';
      const body = rawBody.slice(0, 8000);
      const result = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${body}${rawBody.length > 8000 ? '\n…[truncated]' : ''}`;
      return { result, summary: `Read email: "${subject}"` };
    }

    case 'get_meeting_context': {
      if (!ctx.features.meetings) {
        return {
          result: 'Calendar and meetings access is not enabled for this workspace.',
          summary: 'Meetings module disabled',
        };
      }
      // Default include_upcoming=true for work chat (calendar awareness is the primary use case)
      const meetingConfig: Record<string, unknown> = { include_upcoming: true, ...input };
      const result = await executeGetMeetingContext(meetingConfig, ctx.userId, ctx.supabase);
      const summary = result.startsWith('No processed') ? 'No meetings found' : 'Meeting context retrieved';
      return { result, summary };
    }

    case 'deep_research': {
      const focus = (input.focus as string) || '';
      if (!focus) {
        return { result: 'No research topic provided.', summary: 'Research skipped' };
      }
      const result = await executeDeepResearch(
        { focus, queries: [focus], language: (input.language as string | undefined), model: 'fast' },
        ''
      );
      return { result, summary: `Research complete: ${focus.slice(0, 60)}` };
    }

    case 'generate_document': {
      const type = input.type as string;
      const instructions = input.instructions as string;

      // ── THE ONE PRODUCTION DOOR (plan AF): the native loop's inline generators pipeline is
      // RETIRED — generation runs through the ONE shared function the AgentOS route already
      // uses, which itself materializes through lib/documents/materialize (compiler for
      // charts/revision/templates · typed protocol · branded template renderers, with the
      // facts/content floors). Revision + tabular material auto-resolve from the thread
      // INSIDE the function — one behaviour for both runtimes, by construction. ──
      const { generateThreadDocument } = await import('@/lib/work/generate-thread-document');
      const gen = await generateThreadDocument({
        userId: ctx.userId,
        threadId: ctx.threadId,
        type,
        instructions,
        adminClient: ctx.adminClient,
        groundingContext: ctx.kbContext || undefined,
        userContext: ctx.userContextBlock || '',
        isTemporary: ctx.isTemporary,
      });
      if (!gen.artifact) {
        return { result: 'Document generation failed.', summary: 'Generation failed' };
      }
      const typeLabels: Record<string, string> = {
        word: 'Word document', excel: 'spreadsheet', pptx: 'presentation', email: 'email draft',
      };
      return {
        result: `Document created successfully: ${gen.artifact.title}${gen.summary.includes('One check:') ? ` — ${gen.summary.split('One check:')[1]}` : ''}`,
        summary: `${typeLabels[type] || 'Document'} created`,
        artifact: gen.artifact as unknown as DocumentArtifact,
      };
    }

    case 'web_search': {
      const result = await executeWebSearch(input);
      const query = typeof input.query === 'string' ? input.query : '';
      return { result, summary: `Web search: ${query.slice(0, 50)}` };
    }

    case 'run_compute': {
      const result = await executeRunCompute(input as ComputeConfig, ctx.userId, ctx.adminClient);
      const failed = /FAILED|nothing was run|unreachable|not configured/i.test(result.slice(0, 200));
      const desc = typeof input.description === 'string' ? input.description.slice(0, 50) : 'sandboxed script';
      return { result, summary: failed ? `Compute failed: ${desc}` : `Computed: ${desc}` };
    }

    case 'fetch_url': {
      const result = await executeFetchUrl(input);
      const urls = Array.isArray(input.urls) ? input.urls : [];
      return { result, summary: `Read ${urls.length} page${urls.length !== 1 ? 's' : ''}` };
    }

    // ── Worker task management tools ────────────────────────────────────────────
    case 'list_tasks': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No worker' };
      const result = await executeListTasks(ctx.agentId, ctx.userId, ctx.adminClient);
      const count = parseInt(result.match(/^Tasks \((\d+)\)/)?.[1] ?? '0', 10);
      return { result, summary: count > 0 ? `Found ${count} task${count !== 1 ? 's' : ''}` : 'No tasks found' };
    }

    case 'create_task': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No worker' };
      const description = typeof input.description === 'string' ? input.description : '';
      const skillNames = Array.isArray(input.skill_names) ? (input.skill_names as string[]) : undefined;
      const raw = await executeCreateTask(description, ctx.agentId, ctx.userId, ctx.supabase, ctx.adminClient, skillNames);
      // THE ONE CREATION CARD: the tool DRAFTS; the marker becomes the review card runtime-side
      // (the model never sees or echoes base64 — it gets the cleaned plan text).
      const { parseWorkflowDraftMarker } = await import('@/lib/workflows/draft-marker');
      const { draft, cleaned } = parseWorkflowDraftMarker(raw);
      return {
        result: cleaned, summary: draft ? 'Task drafted — awaiting your confirm' : 'Task creation failed',
        ...(draft ? { workflowDraft: draft as unknown as Record<string, unknown> } : {}),
      };
    }

    case 'get_task': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No worker' };
      const taskId = typeof input.task_id === 'string' ? input.task_id : '';
      const result = await executeGetTask(taskId, ctx.userId, ctx.adminClient);
      return { result, summary: 'Task config retrieved' };
    }

    case 'update_task': {
      const taskId = typeof input.task_id === 'string' ? input.task_id : '';
      const result = await executeUpdateTask(taskId, {
        ...(typeof input.name === 'string' ? { name: input.name } : {}),
        ...(typeof input.description === 'string' ? { description: input.description } : {}),
        ...(input.status === 'active' || input.status === 'paused' ? { status: input.status } : {}),
        ...(input.trigger && typeof input.trigger === 'object' ? { trigger: input.trigger as import('@/lib/workflows/types').WorkflowTrigger } : {}),
        ...(typeof input.output_language === 'string' ? { output_language: input.output_language } : {}),
        ...(typeof input.output_destination === 'string' ? { output_destination: input.output_destination } : {}),
        ...(typeof input.output_artifact_type === 'string' ? { output_artifact_type: input.output_artifact_type } : {}),
        ...(typeof input.output_title === 'string' ? { output_title: input.output_title } : {}),
        ...(typeof input.output_slack_channel === 'string' ? { output_slack_channel: input.output_slack_channel } : {}),
        ...(typeof input.output_report_mode === 'string' ? { output_report_mode: input.output_report_mode } : {}),
        ...(typeof input.output_email_to === 'string' ? { output_email_to: input.output_email_to } : {}),
        ...(typeof input.output_email_as_attachment === 'boolean' ? { output_email_as_attachment: input.output_email_as_attachment } : {}),
        ...(typeof input.output_email_body_instructions === 'string' ? { output_email_body_instructions: input.output_email_body_instructions } : {}),
        ...(typeof input.output_slack_announcement === 'string' ? { output_slack_announcement: input.output_slack_announcement } : {}),
        ...(typeof input.output_notification === 'string' ? { output_notification: input.output_notification } : {}),
        ...(typeof input.worker_instructions === 'string' ? { worker_instructions: input.worker_instructions } : {}),
        ...(Array.isArray(input.skill_names) ? { skill_names: input.skill_names as string[] } : {}),
        ...(input.step_patch && typeof input.step_patch === 'object' && typeof (input.step_patch as Record<string, unknown>).step_id === 'string' ? { step_patch: input.step_patch as { step_id: string; label?: string; prompt?: string; config?: Record<string, unknown> } } : {}),
        ...(Array.isArray(input.steps) ? { steps: input.steps as import('@/lib/workflows/types').WorkflowStep[] } : {}),
      }, ctx.userId, ctx.adminClient);
      return { result, summary: 'Task updated' };
    }

    case 'duplicate_task': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No worker' };
      const taskId = typeof input.task_id === 'string' ? input.task_id : '';
      const newName = typeof input.name === 'string' ? input.name : undefined;
      const result = await executeDuplicateTask(taskId, ctx.agentId, ctx.userId, newName, ctx.adminClient);
      return { result, summary: 'Task duplicated' };
    }

    case 'delete_task': {
      const taskId = typeof input.task_id === 'string' ? input.task_id : '';
      const result = await executeDeleteTask(taskId, ctx.userId, ctx.adminClient);
      return { result, summary: 'Task deleted' };
    }

    case 'share_task': {
      const taskId = typeof input.task_id === 'string' ? input.task_id : '';
      const action = input.action === 'unshare' ? 'unshare' : 'share';
      const result = await executeShareTask(taskId, action, ctx.userId, ctx.adminClient);
      return { result, summary: action === 'share' ? 'Task shared with team' : 'Task made private' };
    }

    case 'list_team_tasks': {
      const result = await executeListTeamTasks(ctx.userId, ctx.adminClient);
      return { result, summary: 'Team tasks listed' };
    }

    case 'use_task': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No worker' };
      const taskId = typeof input.task_id === 'string' ? input.task_id : '';
      const result = await executeUseTask(taskId, ctx.agentId, ctx.userId, ctx.adminClient);
      return { result, summary: 'Task added from team' };
    }

    case 'run_task': {
      const taskId = typeof input.task_id === 'string' ? input.task_id : '';
      const result = await executeRunTask(taskId, ctx.userId, ctx.adminClient, ctx.threadId);
      return { result, summary: 'Task started' };
    }

    case 'list_worker_documents': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No documents' };
      const result = await executeListWorkerDocuments(ctx.agentId, ctx.userId, ctx.adminClient);
      return { result, summary: 'Documents listed' };
    }

    case 'get_worker_document': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'Cannot retrieve' };
      const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
      const { content, artifact } = await executeGetWorkerDocument(artifactId, ctx.agentId, ctx.userId, ctx.adminClient);
      if (!artifact) return { result: content, summary: 'Document not found' };
      const docArtifact: DocumentArtifact = {
        id: artifact.id,
        title: artifact.title,
        type: artifact.type as import('@/lib/types/inbox').DeliverableType,
        generated_at: artifact.generated_at,
        storage_path: artifact.storage_path,
      };
      return {
        result: content,
        summary: `Retrieved "${artifact.title}"`,
        artifact: docArtifact,
      };
    }

    // ── Worker skill tools ──────────────────────────────────────────────────────
    case 'list_skills': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No worker' };
      const result = await executeListSkills(ctx.agentId, ctx.userId, ctx.adminClient);
      const count = parseInt(result.match(/^Skills \((\d+)\)/)?.[1] ?? '0', 10);
      return { result, summary: count > 0 ? `${count} skill${count !== 1 ? 's' : ''} in library` : 'No skills' };
    }

    case 'apply_skill': {
      if (!ctx.agentId) return { result: 'No worker context available.', summary: 'No worker' };
      const skillName = typeof input.skill_name === 'string' ? input.skill_name : '';
      const result = await executeApplySkill(skillName, ctx.agentId, ctx.userId, ctx.adminClient);
      const found = !result.startsWith('No skill named');
      return { result, summary: found ? `Applied "${skillName}"` : 'Skill not found' };
    }

    // ── Slack ───────────────────────────────────────────────────────────────────
    case 'slack_list_channels': {
      const result = await executeSlackListChannels(ctx.userId, ctx.adminClient, ctx.agentId);
      return { result, summary: 'Listed Slack channels' };
    }

    case 'slack_post_message': {
      const result = await executeSlackPostMessage(input, ctx.userId, ctx.agentId, ctx.adminClient);
      // Success strings: "Posted to Slack …" / "Sent you a Slack DM." / "Replied in thread …".
      const summary = /^Posted/.test(result) ? 'Posted to Slack'
        : /^Sent/.test(result) ? 'Sent a Slack DM'
        : /^Replied/.test(result) ? 'Replied on Slack'
        : 'Slack post failed';
      return { result, summary };
    }

    case 'slack_read_messages': {
      const result = await executeSlackReadMessages(input, ctx.userId, ctx.adminClient, ctx.agentId);
      return { result, summary: 'Read Slack messages' };
    }

    case 'slack_list_members': {
      const result = await executeSlackListMembers(input, ctx.userId, ctx.adminClient, ctx.agentId);
      return { result, summary: 'Listed channel members' };
    }

    case 'find_team_work': {
      const result = await executeFindTeamWork(input, ctx.userId, ctx.adminClient);
      return { result, summary: 'Found team work' };
    }

    case 'read_team_work': {
      const result = await executeReadTeamWork(input, ctx.userId, ctx.adminClient);
      return { result, summary: 'Read a teammate\'s document' };
    }

    default:
      return { result: 'Unknown tool', summary: 'Unknown tool' };
  }
}

// ── Auto-rename ──────────────────────────────────────────────────────────────

async function generateAutoTitle(
  firstMessage: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  threadId: string
): Promise<string | undefined> {
  try {
    // Use summarization task — lighter model per tier, not the conversation model
    const { client, model } = await getAIClient(userId, 'summarization', supabase);
    const res = await aiCreate(client, {
      model,
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Generate a concise 3-5 word title for this chat. Return ONLY the title, no punctuation, no quotes.\n\nMessage: "${firstMessage.slice(0, 200)}"`,
      }],
    });
    const title = (res.choices[0]?.message?.content ?? '').trim().replace(/^["']|["']$/g, '');
    if (title) {
      await adminClient.from('work_threads').update({ title }).eq('id', threadId);
      return title;
    }
  } catch {
    // Non-fatal — original title stays
  }
  return undefined;
}

// ── Mention context builder ──────────────────────────────────────────────────

async function buildMentionContext(
  mentions: Array<{ id: string; type: string; label: string; subtitle?: string }>,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any
): Promise<{ mentionContext: string | null; kbContext: string }> {
  const lines: string[] = [];
  const kbLines: string[] = [];

  await Promise.all(mentions.map(async (m) => {
    try {
      switch (m.type) {
        case 'email': {
          const { data } = await adminClient
            .from('emails')
            .select('subject, from_name, from_address, body, received_at')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            lines.push(
              `[EMAIL] "${data.subject || '(no subject)'}"\n` +
              `From: ${data.from_name || data.from_address} · ${new Date(data.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\n` +
              (data.body ? `Preview: ${data.body.slice(0, 300)}` : '')
            );
          }
          break;
        }
        case 'meeting': {
          const { data } = await adminClient
            .from('calendar_events')
            .select('title, start_time, end_time, attendees, description')
            .eq('id', m.id)
            .single();
          if (data) {
            const attendeeList = Array.isArray(data.attendees)
              ? (data.attendees as Array<{ name?: string; email?: string }>)
                  .slice(0, 8).map(a => {
                    if (a.name && a.email) return `${a.name} <${a.email}>`;
                    return a.name || a.email || '';
                  }).filter(Boolean).join(', ')
              : '';
            lines.push(
              `[MEETING] "${data.title}"\n` +
              `When: ${new Date(data.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}\n` +
              (attendeeList ? `Attendees: ${attendeeList}` : '') +
              (data.description ? `\nNotes: ${String(data.description).slice(0, 200)}` : '')
            );
          }
          break;
        }
        case 'kb': {
          const { data } = await adminClient
            .from('knowledge_files')
            .select('filename, summary')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (data) {
            const { data: chunks } = await adminClient
              .from('knowledge_chunks')
              .select('content, heading')
              .eq('file_id', m.id)
              .order('chunk_index', { ascending: true })
              .limit(20);
            const allChunks = (chunks as Array<{ heading?: string; content: string }> | null) ?? [];
            const fullText = allChunks
              .map(c => (c.heading ? `${c.heading}\n${c.content}` : c.content))
              .join('\n\n');
            // Short preview for the user-facing [Referenced items] block
            lines.push(
              `[DOCUMENT] "${data.filename}"\n` +
              (fullText ? `Content:\n${fullText.slice(0, 800)}` : data.summary ? `Summary: ${data.summary}` : '(no content available)')
            );
            // Full content for generation grounding (used by generate_document)
            if (fullText) {
              kbLines.push(`[${data.filename}]\n${data.summary ? `Summary: ${data.summary}\n` : ''}${fullText.slice(0, 6000)}`);
            }
          }
          break;
        }
        case 'contact': {
          const { data: contact } = await adminClient
            .from('relationship_graph')
            .select('contact_name, contact_email, relationship_type, typical_topics, last_interaction, interaction_frequency')
            .eq('id', m.id)
            .eq('user_id', userId)
            .single();
          if (!contact) break;

          const { contact_email, contact_name } = contact;

          const [fromEmailsRes, toEmailsRes, meetingsRes] = await Promise.all([
            // Emails FROM this contact
            adminClient
              .from('emails')
              .select('subject, received_at, body')
              .eq('user_id', userId)
              .ilike('from_address', contact_email)
              .order('received_at', { ascending: false })
              .limit(8),
            // Emails TO/CC this contact
            adminClient
              .from('emails')
              .select('subject, from_address, from_name, received_at, body')
              .eq('user_id', userId)
              .or(`to_addresses.cs.{"${contact_email}"},cc_addresses.cs.{"${contact_email}"}`)
              .order('received_at', { ascending: false })
              .limit(8),
            // Calendar events they attended
            adminClient
              .from('calendar_events')
              .select('title, start_time')
              .eq('user_id', userId)
              .contains('attendees', JSON.stringify([{ email: contact_email }]))
              .order('start_time', { ascending: false })
              .limit(5),
          ]);

          // Merge + deduplicate emails by subject+date
          const seenKeys = new Set<string>();
          const allEmails = [
            ...(fromEmailsRes.data ?? []),
            ...(toEmailsRes.data ?? []),
          ]
            .filter(e => {
              const key = `${e.subject}|${e.received_at}`;
              if (seenKeys.has(key)) return false;
              seenKeys.add(key);
              return true;
            })
            .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
            .slice(0, 10);

          const parts: string[] = [];

          // Header line
          const headerParts = [
            `[CONTACT] ${contact_name || contact_email}${contact_name ? ` <${contact_email}>` : ''}`,
            contact.relationship_type || null,
            contact.interaction_frequency ? `${contact.interaction_frequency} interactions` : null,
            contact.last_interaction
              ? `last contact: ${new Date(contact.last_interaction).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : null,
          ].filter(Boolean);
          parts.push(headerParts.join(' — '));

          if ((contact.typical_topics as string[] | null)?.length) {
            parts.push(`Topics: ${(contact.typical_topics as string[]).slice(0, 4).join(', ')}`);
          }

          if (allEmails.length > 0) {
            parts.push(`\nRecent emails (${allEmails.length}):`);
            for (const e of allEmails) {
              const date = new Date(e.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const snippet = e.body ? e.body.slice(0, 100).replace(/\s+/g, ' ') + '…' : '';
              parts.push(`  · "${e.subject || '(no subject)'}" — ${date}${snippet ? ` — "${snippet}"` : ''}`);
            }
          }

          const meetings = meetingsRes.data ?? [];
          if (meetings.length > 0) {
            parts.push(`\nShared meetings (${meetings.length}):`);
            for (const ev of meetings) {
              const date = new Date(ev.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              parts.push(`  · "${ev.title}" — ${date}`);
            }
          }

          lines.push(parts.join('\n'));
          break;
        }

        case 'coworker': {
          // @coworker → directive to build on that teammate's work (via find_team_work).
          lines.push(
            `[COWORKER] ${m.label}\n` +
            `Build on ${m.label}'s work for this — call find_team_work with coworker="${m.label}" to pull their relevant output, then read_team_work to use it.`
          );
          break;
        }

        case 'task': {
          // @task → the task + a preview of its latest output.
          const { data: wf } = await adminClient
            .from('workflows').select('name, status').eq('id', m.id).eq('user_id', userId).single();
          if (wf) {
            const { data: rthreads } = await adminClient
              .from('work_threads').select('artifacts').eq('user_id', userId).eq('workflow_id', m.id)
              .not('artifacts', 'is', null).order('updated_at', { ascending: false }).limit(1);
            const arts = Array.isArray(rthreads?.[0]?.artifacts) ? rthreads[0].artifacts : [];
            const latest = arts[arts.length - 1] as { content?: { sections?: Array<{ heading: string; paragraphs: string[] }> } } | undefined;
            let preview = '';
            const secs = latest?.content?.sections;
            if (Array.isArray(secs)) preview = secs.map(s => `${s.heading}\n${(s.paragraphs ?? []).join('\n')}`).join('\n\n').slice(0, 1200);
            lines.push(
              `[TASK] "${wf.name}"${wf.status === 'paused' ? ' (paused)' : ''}\n` +
              (preview ? `Latest output:\n${preview}` : 'No output yet — you can run it (run_task) or read its config (get_task).')
            );
          }
          break;
        }

        case 'document': {
          // @document → a knowledge-base file (meeting / upload / generated). Inject its
          // indexed content from knowledge_chunks (mirrors the 'kb' case above).
          const { data: kf } = await adminClient
            .from('knowledge_files').select('filename, summary').eq('id', m.id).eq('user_id', userId).single();
          if (kf) {
            const { data: chunks } = await adminClient
              .from('knowledge_chunks').select('content, heading').eq('file_id', m.id)
              .order('chunk_index', { ascending: true }).limit(20);
            const fullText = ((chunks as Array<{ heading?: string; content: string }> | null) ?? [])
              .map(c => (c.heading ? `${c.heading}\n${c.content}` : c.content)).join('\n\n');
            lines.push(
              `[DOCUMENT] "${kf.filename}"\n` +
              (fullText ? fullText.slice(0, 6000) : kf.summary ? `Summary: ${kf.summary}` : '(no indexed content)')
            );
          }
          break;
        }
      }
    } catch {
      // Non-fatal — if a mention fails to load, skip it
    }
  }));

  const mentionContext = lines.length > 0 ? `[Referenced items]\n${lines.join('\n\n')}` : null;
  const kbContext = kbLines.length > 0
    ? `RELEVANT KNOWLEDGE BASE (from your indexed files — use this content when answering):\n\n${kbLines.join('\n\n')}`
    : '';
  return { mentionContext, kbContext };
}

// ── Specificity detection ─────────────────────────────────────────────────────
// Determines whether a message names a specific subject (product, person, project,
// company, code) — without relying on an AI call that can be wrong.
// Returns false for generic requests like "create a pricing document" or
// "find something about proposals" where no named subject is present.

const GENERIC_DOC_WORDS = new Set([
  'document', 'doc', 'report', 'email', 'presentation', 'deck', 'spreadsheet',
  'proposal', 'summary', 'analysis', 'memo', 'brief', 'letter', 'contract',
  'update', 'draft', 'follow', 'followup', 'follow-up', 'note', 'notes',
  'create', 'make', 'write', 'draft', 'generate', 'build', 'prepare', 'need',
  'pricing', 'budget', 'plan', 'schedule', 'tracker', 'template', 'outline',
  'i', 'a', 'an', 'the', 'to', 'for', 'and', 'or', 'of', 'in', 'on', 'with',
  'my', 'me', 'our', 'us', 'new', 'some', 'this', 'that', 'about', 'please',
])

function hasSpecificSubject(message: string): boolean {
  // Quoted strings always count as specific
  if (/"[^"]{2,}"/.test(message)) return true

  // Alphanumeric codes: letters+digits mixed (Z100, Q3, GPT-4, ISO27001)
  if (/\b(?:[A-Za-z]+\d[\w-]*|\d+[A-Za-z][\w-]*)\b/.test(message)) return true

  // Proper nouns: capitalised words that aren't at sentence start and aren't generic
  const words = message.split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[^A-Za-z]/g, '')
    if (
      word.length >= 2 &&
      word[0] === word[0].toUpperCase() &&
      word[0] !== word[0].toLowerCase() &&
      !GENERIC_DOC_WORDS.has(word.toLowerCase())
    ) return true
  }

  // Possessive references to named things ("Acme's proposal", "John's report")
  if (/[A-Z][a-z]+'s\b/.test(message)) return true

  return false
}

// ── XML tool call detection (OSS-model / OpenAI-compat hosts) ───────────────────────
// DeepSeek models sometimes emit tool calls as XML text instead of structured
// tool_calls deltas when using OpenAI-compatible wrappers. These helpers detect
// and parse them so we can execute the tools correctly.

const XML_TOOL_NAMES = ['search_knowledge_base', 'get_emails', 'get_email_body', 'get_meeting_context', 'deep_research', 'request_clarification', 'generate_document'];

function parseXmlToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> | null {
  if (!text.includes('<')) return null;
  const results: Array<{ name: string; args: Record<string, unknown> }> = [];

  // Format 1: <tool_call>{"name":"...","arguments":{...}}</tool_call>
  const tcBlocks = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/g) ?? [];
  for (const block of tcBlocks) {
    try {
      const inner = block.replace(/<\/?tool_call>/g, '').trim();
      const p = JSON.parse(inner);
      if (p.name && p.arguments) results.push({ name: p.name, args: p.arguments });
    } catch {}
  }

  // Format 2: <tool_name><param>value</param>...</tool_name>
  for (const toolName of XML_TOOL_NAMES) {
    const re = new RegExp(`<${toolName}>([\\s\\S]*?)<\\/${toolName}>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const args: Record<string, unknown> = {};
      const paramRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(m[1])) !== null) {
        args[pm[1]] = pm[2].trim();
      }
      results.push({ name: toolName, args });
    }
  }

  // Format 3: Anthropic <function_calls><invoke name="..."><parameter name="...">value</parameter></invoke></function_calls>
  const fcBlocks = text.match(/<function_calls>[\s\S]*?<\/function_calls>/g) ?? [];
  for (const block of fcBlocks) {
    const invokeRe = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g;
    let im: RegExpExecArray | null;
    while ((im = invokeRe.exec(block)) !== null) {
      const toolName = im[1];
      if (!XML_TOOL_NAMES.includes(toolName)) continue;
      const args: Record<string, unknown> = {};
      const paramRe = /<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(im[2])) !== null) {
        args[pm[1]] = pm[2].trim();
      }
      results.push({ name: toolName, args });
    }
  }

  return results.length > 0 ? results : null;
}

function stripXmlToolCalls(text: string): string {
  // DeepSeek reasoning: <think>...</think>
  let r = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Anthropic format: <function_calls>...</function_calls> and <function_results>...</function_results>
  r = r.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');
  r = r.replace(/<function_results>[\s\S]*?<\/function_results>/g, '');
  // Qwen/JSON format: <tool_call>...</tool_call>
  r = r.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // DeepSeek format: <toolname>...</toolname>
  for (const toolName of XML_TOOL_NAMES) {
    r = r.replace(new RegExp(`<${toolName}>[\\s\\S]*?<\\/${toolName}>`, 'g'), '');
  }
  // Strip unclosed <think> block (model still reasoning when stream ended)
  r = r.replace(/<think>[\s\S]*$/gi, '');
  return r.trim();
}

// ── PATCH: edit a user message and truncate subsequent messages ──────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { messageId, newContent } = body as { messageId: string; newContent: string };

  if (!messageId || !newContent?.trim()) {
    return NextResponse.json({ error: 'messageId and newContent required' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Verify message belongs to this thread and is a user message
  const { data: msg } = await admin
    .from('work_messages')
    .select('id, role, created_at')
    .eq('id', messageId)
    .eq('thread_id', threadId)
    .single();

  if (!msg || msg.role !== 'user') {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  // Delete all messages that came strictly after the edited message
  await admin
    .from('work_messages')
    .delete()
    .eq('thread_id', threadId)
    .gt('created_at', msg.created_at);

  // Update the user message content
  await admin
    .from('work_messages')
    .update({ content: newContent.trim() })
    .eq('id', messageId);

  return NextResponse.json({ ok: true });
}
