// ─── Step execution engine ────────────────────────────────────────────────────
// Per-step handlers. Each handler receives the accumulated step outputs so far
// and produces a new output. Outputs are concatenated into the context for the
// next step.

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate, getSystemClient } from '@/lib/ai/factory';
import { isAgentOSEnabled, runWorkerStepViaAgentOS } from '@/lib/work/agentos-bridge';
import { buildChatSystemPrompt, detectModelFamily } from '@/lib/work/chat-system-prompt';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { buildSkillsBlock, buildSkillsBlockByIds } from '@/lib/work/worker-skills-context';
import { composeSlackMessage } from './slack-message';
import { executeWebSearch, executeFetchUrl, executeRssFeed, executeLinkedInPost, executeBrowserFetch, executePtTenders, executeDeepResearch, executeWorkflowOutput, executeGetEmails, executeGetMeetingContext, executeSlackReadMessages, executeSlackPostMessage, executeSendCalendarInvite } from '@/lib/tools';
import type { SendCalendarInviteConfig } from '@/lib/tools';
import type { WorkflowStep, StepOutput, ToolStep, AIStep, AgentStep } from './types';

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
  const content = maxChars && joined.length > maxChars ? joined.slice(0, maxChars) + '\n…[truncated]' : joined;
  return `<previous_steps>\n${content}\n</previous_steps>`;
}

// ── Tool step ─────────────────────────────────────────────────────────────────

async function executeToolStep(step: ToolStep, ctx: StepContext): Promise<string> {
  switch (step.tool) {
    case 'get_emails':        return await executeGetEmails(step.config, ctx.userId, ctx.supabase);
    case 'get_urgent_emails': return await executeGetEmails({ mode: 'urgent', ...step.config }, ctx.userId, ctx.supabase);
    case 'get_meeting_context': return await executeGetMeetingContext(step.config, ctx.userId, ctx.supabase);
    case 'get_calendar':      return await toolGetCalendar(ctx);
    case 'read_kb_file':      return await toolReadKbFile(step.config, ctx);
    case 'web_search':        return await executeWebSearch(step.config);
    case 'fetch_url':         return await executeFetchUrl(step.config);
    case 'rss_feed':          return await executeRssFeed(step.config, ctx.lastRunAt);
    case 'slack_read_channel': return await executeSlackReadMessages(step.config, ctx.userId, ctx.supabase, ctx.workerAgentId);
    case 'slack_send':         return await toolSlackSend(step, ctx);
    case 'send_calendar_invite': return await executeSendCalendarInvite(step.config as unknown as SendCalendarInviteConfig, ctx.userId, ctx.supabase);
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

async function executeAIStep(step: AIStep, ctx: StepContext): Promise<string> {
  const tier = step.model_tier === 'reasoning' ? 'conversation' : 'summarization';
  const resolved = await getAIClient(ctx.userId, tier, ctx.supabase);

  // Cap previous outputs when worker context will also be injected (token budget)
  const previousBlock = formatPreviousOutputs(
    ctx.previousOutputs,
    ctx.isLastStep && ctx.workerAgentId ? 30000 : undefined,
  );

  const formatNote =
    step.output_format === 'json'     ? '\n\nRespond with valid JSON only. No prose.' :
    step.output_format === 'markdown' ? '\n\nRespond in clean, scannable markdown.' :
                                        '';

  const langInstruction = ctx.outputLanguage && ctx.outputLanguage !== 'en'
    ? ` Write your response in ${getOutputLanguageName(ctx.outputLanguage)}.`
    : '';

  let systemPrompt =
    `You are executing one step of an automated workflow named "${ctx.workflowName}". ` +
    `Use the previous step outputs below as your source material and produce the requested transformation.` +
    langInstruction;

  // When this is the final step of a worker-owned workflow, replace the anonymous system prompt
  // with the worker's full identity: instructions + memory + KB.
  if (ctx.isLastStep && ctx.workerAgentId) {
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

  const userPrompt = [
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

async function executeAgentStep(step: AgentStep, ctx: StepContext): Promise<string> {
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
