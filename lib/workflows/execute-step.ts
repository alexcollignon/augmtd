// ─── Step execution engine ────────────────────────────────────────────────────
// Per-step handlers. Each handler receives the accumulated step outputs so far
// and produces a new output. Outputs are concatenated into the context for the
// next step.

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate, getSystemClient } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { isAgentOSEnabled, runWorkerStepViaAgentOS } from '@/lib/work/agentos-bridge';
import { buildChatSystemPrompt, detectModelFamily } from '@/lib/work/chat-system-prompt';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { buildSkillsBlock, buildSkillsBlockByIds } from '@/lib/work/worker-skills-context';
import { composeSlackMessage } from './slack-message';
import { executeWebSearch, executeFetchUrl, executeRssFeed, executeLinkedInPost, executeBrowserFetch, executePtTenders, executeDeepResearch, executeWorkflowOutput, executeGetEmails, executeGetMeetingContext, executeSlackReadMessages, executeSlackPostMessage, executeSendCalendarInvite, executeForwardEmail, executeFindTeamWork, executeRunCompute } from '@/lib/tools';
import type { SendCalendarInviteConfig, ForwardEmailConfig, ComputeConfig } from '@/lib/tools';
import type { WorkflowStep, StepOutput, ToolStep, AIStep, AgentStep, VerifyStep } from './types';

export interface StepContext {
  userId: string;
  supabase: SupabaseClient;   // service-role client — runs as system, no auth.uid()
  previousOutputs: StepOutput[];
  workflowName: string;
  lastRunAt?: string | null;  // workflow.last_run_at — used by rss_feed since:'last_run'
  outputLanguage?: string;    // BCP-47 from output_config.output_language — injected into AI steps
  workflowId?: string;        // current workflow id — used by get_workflow_output to prevent self-reference
  runnerId?: string;          // user who triggered this run (may differ from userId for shared runs)
  workerAgentId?: string;     // set when workflow.agent_id is non-null — injects worker identity into final AI step
  isLastStep?: boolean;       // true for the final step in the ordered list
  workerInstructions?: string | null; // task-specific tone/persona, injected between KB and step prompt
  skillIds?: string[];        // task-pinned skill IDs (selector); empty/undefined → fall back to the worker's assigned skills
  /** THE ENTITY EDGE — the scoped project's current room page (workflowRunGrounding). Injected
   *  into AI steps only; a verify gate (use_worker_identity: false) never sees it. */
  projectGrounding?: string | null;
  /** STANDING REACTIONS — the triggering event block. Unlike projectGrounding this IS source
   *  material, so the verify gate sees it too (a claim about the trigger must be checkable). */
  triggerEvent?: string | null;
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

export async function executeStep(step: WorkflowStep, ctx: StepContext): Promise<StepOutput> {
  const startedAt = Date.now();
  try {
    let output: unknown;
    switch (step.type) {
      case 'tool':  output = await executeToolStep(step, ctx); break;
      case 'ai':    output = await executeAIStep(step, ctx); break;
      case 'agent': output = await executeAgentStep(step, ctx); break;
      // The APPROVAL step is handled by the RUN LOOP (pause/resume in run-workflow) — reaching
      // it here means a caller bypassed the loop; pass through harmlessly, never park.
      case 'approval': output = '[Approval gate — handled by the run loop]'; break;
      case 'verify': output = await executeVerifyStep(step, ctx); break;
      default: {
        // exhaustiveness check
        const _never: never = step;
        throw new Error(`Unknown step type: ${JSON.stringify(_never)}`);
      }
    }
    return {
      step_id: step.id,
      step_type: step.type,
      label: step.label,
      output,
      duration_ms: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      step_id: step.id,
      step_type: step.type,
      label: step.label,
      output: null,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startedAt,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPreviousOutputs(outputs: StepOutput[], maxChars?: number): string {
  if (outputs.length === 0) return '';
  const parts = outputs.map((o, i) => {
    const body = typeof o.output === 'string'
      ? o.output
      : JSON.stringify(o.output, null, 2);
    return `[Step ${i + 1} — ${o.label}]\n${body}`;
  });
  const joined = parts.join('\n\n');
  // Over-budget: cut the MIDDLE, never the tail — the latest steps are the most
  // load-bearing (a verification gate's draft, the freshest tool data). Head-slicing
  // here silently blinded final AI steps to every step past the cap (real incident:
  // multi-source briefings shipped without their later sources).
  const content = maxChars && joined.length > maxChars
    ? joined.slice(0, Math.floor(maxChars * 0.55)) +
      '\n\n…[middle of the source material truncated for length — the steps above and below are intact]…\n\n' +
      joined.slice(-Math.floor(maxChars * 0.45))
    : joined;
  return `<previous_steps>\n${content}\n</previous_steps>`;
}

// ── Tool step ─────────────────────────────────────────────────────────────────

// THE REGISTRY GATE (production arc step 1, Aug 8): a pipeline tool without a workflow-exposed
// registry row does not run — parity enforced at RUNTIME, not just review (the workflow engine
// was the last consumer of the pre-registry flat toolkit). Legacy ids predating the registry
// keep running for existing tasks but are never pickable.
const LEGACY_STEP_TOOLS = new Set(['linkedin_post', 'get_urgent_emails']);

async function executeToolStep(step: ToolStep, ctx: StepContext): Promise<string> {
  const { isWorkflowStepTool } = await import('@/lib/work/surface-registry');
  if (!isWorkflowStepTool(step.tool) && !LEGACY_STEP_TOOLS.has(step.tool)) {
    return `Tool step "${step.tool}" is not registered for workflows — it did not run. (Every step needs a workflow-exposed row in the capability registry.)`;
  }
  switch (step.tool) {
    case 'get_emails':        return await executeGetEmails(step.config, ctx.userId, ctx.supabase);
    case 'get_urgent_emails': return await executeGetEmails({ mode: 'urgent', ...step.config }, ctx.userId, ctx.supabase);
    case 'get_meeting_context': return await executeGetMeetingContext(step.config, ctx.userId, ctx.supabase);
    case 'get_calendar':      return await toolGetCalendar(ctx);
    case 'read_kb_file':      return await toolReadKbFile(step.config, ctx);
    case 'search_knowledge_base': return await toolSearchKnowledgeBase(step.config, ctx);
    case 'find_team_work':    return await executeFindTeamWork(step.config, ctx.userId, ctx.supabase);
    case 'web_search':        return await executeWebSearch(step.config);
    case 'fetch_url':         return await executeFetchUrl(step.config);
    case 'rss_feed':          return await executeRssFeed(step.config, ctx.lastRunAt);
    case 'slack_read_channel': return await executeSlackReadMessages(step.config, ctx.userId, ctx.supabase, ctx.workerAgentId);
    case 'slack_send':         return await toolSlackSend(step, ctx);
    case 'send_calendar_invite': return await executeSendCalendarInvite(step.config as unknown as SendCalendarInviteConfig, ctx.userId, ctx.supabase);
    case 'forward_email':     return await executeForwardEmail(step.config as unknown as ForwardEmailConfig, ctx.userId, ctx.supabase);
    case 'run_compute':       return await executeRunCompute(step.config as unknown as ComputeConfig, ctx.userId, ctx.supabase);
    case 'linkedin_post':     return await executeLinkedInPost(step.config, {
      userId: ctx.userId,
      supabase: ctx.supabase,
      previousContent: formatPreviousOutputs(ctx.previousOutputs),
    });
    case 'browser_fetch':     return await executeBrowserFetch(step.config);
    case 'get_pt_tenders':    return await executePtTenders(step.config);
    case 'deep_research': {
      const drConfig = { ...(step.config as unknown as Parameters<typeof executeDeepResearch>[0]) };
      // Inherit output language if not explicitly set on the step
      if (!drConfig.language && ctx.outputLanguage) drConfig.language = ctx.outputLanguage;
      return await executeDeepResearch(drConfig, formatPreviousOutputs(ctx.previousOutputs));
    }
    case 'get_workflow_output':
      return await executeWorkflowOutput(step.config, ctx);
    default:
      throw new Error(`Unknown tool: ${step.tool}`);
  }
}


async function toolGetCalendar(ctx: StepContext): Promise<string> {
  const cal = await getCalendarContext(ctx.userId, ctx.supabase);
  return formatCalendarContextForChat(cal) || 'No upcoming meetings.';
}

// Action step: write a Slack message from an instruction + the pipeline's context,
// in the coworker's voice, and post it (mentions/threads handled by the executor).
// Side-effect only — not the deliverable (run-workflow excludes send steps).
async function toolSlackSend(step: ToolStep, ctx: StepContext): Promise<string> {
  const channel = String(step.config.channel ?? '').trim();
  const instruction = String(step.config.instruction ?? '').trim();
  if (!channel) return 'No Slack channel set for this send step.';

  const context = ctx.previousOutputs
    .map(o => (typeof o.output === 'string' ? o.output : JSON.stringify(o.output)))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 6000);

  let workerName = 'Your coworker';
  let workerInstructions: string | null = null;
  if (ctx.workerAgentId) {
    const { data } = await ctx.supabase.from('custom_agents').select('name, instructions').eq('id', ctx.workerAgentId).maybeSingle();
    if (data) { workerName = (data.name as string) ?? workerName; workerInstructions = (data.instructions as string) ?? null; }
  }

  let text = instruction;
  try {
    const { client, model } = await getAIClient(ctx.userId, 'conversation', ctx.supabase);
    text = await composeSlackMessage(client, model, { workerName, workerInstructions, channel, instruction, context, fallback: instruction });
  } catch { /* fall back to the raw instruction */ }
  if (!text) return 'Nothing to send to Slack.';

  return await executeSlackPostMessage({ channel, text }, ctx.userId, ctx.workerAgentId, ctx.supabase);
}

// Semantic search across the user's indexed knowledge base (Drive + uploads + meetings). Returns the
// matched content as context text. Mirrors the chat `search_knowledge_base` tool via buildKBContext.
async function toolSearchKnowledgeBase(
  config: Record<string, unknown>,
  ctx: StepContext,
): Promise<string> {
  const query = typeof config.query === 'string' ? config.query.trim() : '';
  if (!query) return 'No search query provided.';
  const kb = await buildKBContext(ctx.userId, query, ctx.supabase, {
    fileLimit: 5,
    maxChunksPerFile: 3,
    threshold: 0.2,
    maxTotalChars: 8000,
  });
  return kb?.context || `No knowledge-base results for "${query}".`;
}

async function toolReadKbFile(
  config: Record<string, unknown>,
  ctx: StepContext,
): Promise<string> {
  const fileId = typeof config.file_id === 'string' ? config.file_id : null;
  if (!fileId) return 'No file_id provided.';

  const { data: chunks } = await ctx.supabase
    .from('knowledge_chunks')
    .select('content, heading, chunk_index')
    .eq('file_id', fileId)
    .order('chunk_index', { ascending: true });

  if (!chunks || chunks.length === 0) return `No content found for file ${fileId}.`;

  return (chunks as Array<{ content: string; heading?: string; chunk_index: number }>)
    .map(c => (c.heading ? `§ ${c.heading}\n${c.content}` : c.content))
    .join('\n\n')
    .slice(0, 12000);
}


// ── AI step ───────────────────────────────────────────────────────────────────

// ── THE STRUCTURAL VERIFICATION GATE (production arc step 3) ─────────────────────────────────
// The AHK arc's hand-built gate promoted into the engine: ONE implementation, versioned — never
// copy-pasted into workflow prompts again. Order matters: the ARITHMETIC FLOOR runs first (code
// recomputes the draft's computable claims; its findings become MUST-FIX lines the reasoned pass
// cannot ignore), then one persona-free reasoned pass verifies the draft against the sources.
export const VERIFY_GATE_VERSION = 1;

function verifyGatePrompt(instruction?: string): string {
  return (
    `THE VERIFICATION GATE (v${VERIFY_GATE_VERSION}). The LAST previous-step output below is THE DRAFT. ` +
    `Everything before it is SOURCE MATERIAL. Your ONLY job is to verify the draft against the sources ` +
    `and return the CORRECTED DRAFT — nothing else.\n` +
    `Rules:\n` +
    `1. Every factual claim must be grounded in the source material. DELETE or CORRECT any claim the ` +
    `sources do not support — never keep an ungrounded claim because it sounds plausible.\n` +
    `2. Citations must point at REAL URLs from the source material — fix wrong ones; remove unfixable ones.\n` +
    `3. Keep the draft's structure EXACTLY: every section and heading stays; a section emptied by ` +
    `deletions keeps its header with an honest empty line; never renumber, reorder, or add sections.\n` +
    `4. Dates are sacred: never shift a date, year, or figure toward the present; source material older ` +
    `than the task's window is HISTORICAL and must read as such.\n` +
    `5. Respect the draft's own language and style rules; change wording only where correction requires it.\n` +
    `6. Return ONLY the corrected draft — no commentary, no preamble, no list of changes.` +
    (instruction?.trim() ? `\nWorkflow-specific rules:\n${instruction.trim()}` : '')
  );
}

async function executeVerifyStep(step: VerifyStep, ctx: StepContext): Promise<string> {
  const prev = ctx.previousOutputs;
  const rawDraft = prev.length ? prev[prev.length - 1]?.output : null;
  const draft = typeof rawDraft === 'string' ? rawDraft : JSON.stringify(rawDraft ?? '');
  if (!draft.trim()) return '[Verification gate: nothing to verify — no prior step output]';
  // 1 — the arithmetic floor (deterministic; an outage speaks no verdict and the reasoned gate still runs).
  let mismatchBlock = '';
  try {
    const { verifyComputableClaims } = await import('@/lib/prepare/verify-claims');
    const mismatches = await verifyComputableClaims(ctx.supabase, ctx.userId, draft.slice(0, 12000));
    if (mismatches.length) {
      mismatchBlock =
        `\n\nCOMPUTED BY CODE — these numbers in the draft are WRONG and MUST be corrected ` +
        `(recomputed deterministically from the draft's own figures):\n` +
        mismatches.map((m) => `- "${m.quote.slice(0, 100)}" states ${m.stated}; the correct value is ${m.expected}`).join('\n');
    }
  } catch { /* enhancement only */ }
  // 2 — the reasoned gate, persona-free, through the ONE AI-step executor (clock, language,
  // previous-outputs context, and the use_worker_identity:false contract all ride along).
  const gate: AIStep = {
    type: 'ai', id: step.id, label: step.label || 'Verification gate',
    model_tier: 'reasoning', output_format: 'markdown', use_worker_identity: false,
    prompt: verifyGatePrompt(step.instruction) + mismatchBlock,
  };
  return executeAIStep(gate, ctx);
}

async function executeAIStep(step: AIStep, ctx: StepContext): Promise<string> {
  // Task type (NOT the company's billing tier — see resolved.tier below for that).
  const task = step.model_tier === 'reasoning' ? 'conversation' : 'summarization';
  const resolved = await getAIClient(ctx.userId, task, ctx.supabase);

  // Cap previous outputs when worker context will also be injected. 30k chars (~8k
  // tokens) was far too tight for multi-source pipelines (~110k chars) on models with
  // 200k-token contexts — later steps silently vanished from the final synthesis.
  const previousBlock = formatPreviousOutputs(
    ctx.previousOutputs,
    ctx.isLastStep && ctx.workerAgentId ? 150_000 : undefined,
  );

  const formatNote =
    step.output_format === 'json'     ? '\n\nRespond with valid JSON only. No prose.' :
    step.output_format === 'markdown' ? '\n\nRespond in clean, scannable markdown.' :
                                        '';

  const langInstruction = ctx.outputLanguage && ctx.outputLanguage !== 'en'
    ? ` Write your response in ${getOutputLanguageName(ctx.outputLanguage)}.`
    : '';

  // The clock — workflow AI steps used to run dateless, and a model writing a "this week"
  // deliverable normalized years-old source material into the present (real client incident:
  // a 2021 article rewritten as current news with a fabricated citation date).
  const now = new Date();
  const dateLine =
    `Today is ${now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}, ` +
    `${now.toISOString().slice(0, 10)} (UTC). Source material carries its own dates — treat anything ` +
    `meaningfully older than the task's time window as historical: never present it as current, and ` +
    `never shift dates, years, or figures to fit the present.`;

  let systemPrompt =
    `You are executing one step of an automated workflow named "${ctx.workflowName}". ` +
    `Use the previous step outputs below as your source material and produce the requested transformation.` +
    langInstruction +
    `\n\n${dateLine}`;

  // When this is the final step of a worker-owned workflow, replace the anonymous system prompt
  // with the worker's full identity: instructions + memory + KB. Steps can opt out
  // (use_worker_identity: false) — a verification gate must stay persona-free, or the
  // "produce it in your voice" framing overrides its keep-the-draft contract.
  if (ctx.isLastStep && ctx.workerAgentId && step.use_worker_identity !== false) {
    const { data: agentRow } = await ctx.supabase
      .from('custom_agents')
      .select('name, instructions, memory_text, agent_knowledge_sources(knowledge_file_id)')
      .eq('id', ctx.workerAgentId)
      .eq('user_id', ctx.userId)
      .single();

    if (agentRow) {
      const row = agentRow as {
        name: string;
        instructions: string | null;
        memory_text: string | null;
        agent_knowledge_sources: Array<{ knowledge_file_id: string | null }>;
      };

      const agentFileIds = row.agent_knowledge_sources
        .map((s) => s.knowledge_file_id)
        .filter((id): id is string => Boolean(id));

      const parts: string[] = [
        [
          `You are "${row.name}".`,
          row.instructions?.trim() ?? '',
          `This is a scheduled automated task — produce the requested deliverable directly, in your voice.`,
          langInstruction,
          dateLine,
        ].filter(Boolean).join('\n\n'),
      ];

      // Skills — the task's pinned skills if selected, else the worker's assigned
      // skills (parity with chat). Enforced on the deliverable-producing step.
      const skillsBlock = ctx.skillIds && ctx.skillIds.length > 0
        ? await buildSkillsBlockByIds(ctx.supabase, ctx.userId, ctx.skillIds)
        : await buildSkillsBlock(ctx.supabase, ctx.workerAgentId);
      if (skillsBlock) parts.push(skillsBlock);

      if (row.memory_text?.trim()) {
        parts.push(`[MEMORY — things you've learned about this user]\n${row.memory_text.trim()}`);
      }

      if (agentFileIds.length > 0) {
        try {
          const kb = await buildKBContext(ctx.userId, step.prompt, ctx.supabase, {
            fileLimit: 4,
            maxChunksPerFile: 3,
            threshold: 0.15,
            maxTotalChars: 8000,
            scopeFileIds: agentFileIds,
          });
          if (kb?.context) {
            parts.push(`<agent_knowledge_base>\n${kb.context}\n</agent_knowledge_base>`);
          }
        } catch { /* non-fatal */ }
      }

      if (ctx.workerInstructions?.trim()) {
        parts.push(`[TASK INSTRUCTIONS — for this specific task only]\n${ctx.workerInstructions.trim()}`);
      }

      systemPrompt = parts.join('\n\n');
    }
  }

  if (step.kb_file_ids && step.kb_file_ids.length > 0) {
    try {
      const kb = await buildKBContext(ctx.userId, step.prompt, ctx.supabase, {
        fileLimit: step.kb_file_ids.length,
        maxChunksPerFile: 4,
        threshold: 0.1,
        maxTotalChars: 10000,
        scopeFileIds: step.kb_file_ids,
      });
      if (kb?.context) {
        systemPrompt += `\n\n<reference_documents>\nUse these documents as format and style reference for your output.\n${kb.context}\n</reference_documents>`;
      }
    } catch { /* non-fatal */ }
  }

  // THE ENTITY EDGE — scope inheritance: the linked project's current state rides every AI
  // step EXCEPT the verify gate (use_worker_identity === false), which must judge the draft
  // against the run's own sources alone — outside knowledge would let it "correct" the draft
  // from memory instead of from the material.
  if (ctx.projectGrounding && step.use_worker_identity !== false) {
    systemPrompt += `\n\n${ctx.projectGrounding}`;
  }

  const userPrompt = [
    ctx.triggerEvent ? `<triggering_event>\n${ctx.triggerEvent}\n</triggering_event>` : null,
    previousBlock,
    `<instruction>\n${step.prompt}${formatNote}\n</instruction>`,
  ].filter(Boolean).join('\n\n');

  const res = await aiCreate(resolved.client, {
    model: resolved.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: step.model_tier === 'reasoning' ? 12000 : 4000,
    ...(step.output_format === 'json' ? { response_format: { type: 'json_object' } } : {}),
  });

  logAIUsage(ctx.supabase, {
    userId: ctx.userId,
    agentId: ctx.workerAgentId ?? null,
    workflowId: ctx.workflowId ?? null,
    source: 'workflow_step',
    provider: resolved.endpoint.provider,
    model: resolved.model,
    tier: resolved.tier,
    taskType: task,
    usage: res.usage,
  }).catch(() => {});

  return res.choices[0]?.message?.content?.trim() ?? '';
}

// ── Language helper ───────────────────────────────────────────────────────────

function getOutputLanguageName(code: string): string {
  const map: Record<string, string> = {
    de: 'German (Deutsch)',
    pt: 'Portuguese (Português)',
    fr: 'French (Français)',
    es: 'Spanish (Español)',
    it: 'Italian (Italiano)',
    nl: 'Dutch (Nederlands)',
    zh: 'Chinese (中文)',
    ja: 'Japanese (日本語)',
  };
  return map[code] ?? code;
}

// ── Agent step ────────────────────────────────────────────────────────────────

// Exported: the single, FLAG-AGNOSTIC entry point that runs ONE coworker with a prompt and returns its
// output text. Internally routes through AgentOS when `WORKERS_USE_AGENTOS` is on (with the coworker's
// tools + per-user context) and falls back to the native inline call otherwise — so the caller never
// has to know which path is live. Reused by the Home item-delegation route (`/api/items/delegate`).
export async function executeAgentStep(step: AgentStep, ctx: StepContext): Promise<string> {
  // Load agent
  const { data: agent, error } = await ctx.supabase
    .from('custom_agents')
    .select('id, name, instructions, memory_text, worker_role, is_worker, agent_knowledge_sources(knowledge_file_id)')
    .eq('id', step.agent_id)
    .eq('user_id', ctx.userId)
    .single();

  if (error || !agent) {
    throw new Error(`Agent ${step.agent_id} not found or not owned by user`);
  }

  const agentRow = agent as unknown as {
    id: string;
    name: string;
    instructions: string | null;
    memory_text: string | null;
    worker_role: string | null;
    is_worker: boolean | null;
    agent_knowledge_sources: Array<{ knowledge_file_id: string | null }>;
  };

  // ── AgentOS path (Phase 5, dormant) ──
  // When enabled and this agent is a worker, run the step through AgentOS so it
  // gets the tool-enabled loop + per-user context. Falls back to the inline AI
  // call below on any failure. Flag-off in prod → this block is skipped.
  if (agentRow.is_worker && agentRow.worker_role && isAgentOSEnabled()) {
    try {
      const stepMessage = [
        formatPreviousOutputs(ctx.previousOutputs),
        `<workflow_task>\n${step.prompt}\n</workflow_task>`,
      ].filter(Boolean).join('\n\n');
      return await runWorkerStepViaAgentOS({
        workerRole: agentRow.worker_role,
        agentId: agentRow.id,
        userId: ctx.userId,
        message: stepMessage,
        sessionId: `wf-${ctx.workflowId ?? 'run'}-${agentRow.id}`,
        adminClient: ctx.supabase,
      });
    } catch (err) {
      console.error('[execute-step] AgentOS agent step failed, falling back to inline:', err);
    }
  }

  const agentFileIds: string[] = agentRow.agent_knowledge_sources
    .map(s => s.knowledge_file_id)
    .filter((id): id is string => Boolean(id));

  // Resolve AI client (conversation tier — agents get the best model available)
  const resolved = await getAIClient(ctx.userId, 'conversation', ctx.supabase);
  const modelFamily = detectModelFamily(resolved.model);

  // Build agent-first system prompt (mirrors chat route pattern)
  const systemParts: string[] = [];
  const agentHeader = [
    `You are "${agentRow.name}", a custom AI assistant with a specific role.`,
    agentRow.instructions?.trim() ? `Your instructions:\n${agentRow.instructions.trim()}` : '',
    `Stay in this role for the entire task. This is an automated workflow run — produce the requested deliverable directly, no conversation.`,
  ].filter(Boolean).join('\n\n');
  systemParts.push(agentHeader);

  if (agentRow.memory_text?.trim()) {
    systemParts.push(`[MEMORY — things you've learned about this user from past conversations]\n${agentRow.memory_text.trim()}`);
  }

  systemParts.push(buildChatSystemPrompt(modelFamily));

  const userContextBlock = await buildUserContextBlock(ctx.userId, ctx.supabase).catch(() => null);
  if (userContextBlock) systemParts.push(userContextBlock);

  // Optionally inject agent KB (all chunks across attached files, capped)
  if (agentFileIds.length > 0) {
    try {
      const kb = await buildKBContext(ctx.userId, step.prompt, ctx.supabase, {
        fileLimit: 4,
        maxChunksPerFile: 3,
        threshold: 0.15,
        maxTotalChars: 8000,
        scopeFileIds: agentFileIds,
      });
      if (kb?.context) systemParts.push(`<agent_knowledge_base>\n${kb.context}\n</agent_knowledge_base>`);
    } catch { /* non-fatal */ }
  }

  const previousBlock = formatPreviousOutputs(ctx.previousOutputs);

  const userPrompt = [
    previousBlock,
    `<workflow_task>\n${step.prompt}\n</workflow_task>`,
  ].filter(Boolean).join('\n\n');

  const res = await aiCreate(resolved.client, {
    model: resolved.model,
    messages: [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 3000,
  });

  return res.choices[0]?.message?.content?.trim() ?? '';
}
