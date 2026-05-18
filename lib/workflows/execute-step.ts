// ─── Step execution engine ────────────────────────────────────────────────────
// Per-step handlers. Each handler receives the accumulated step outputs so far
// and produces a new output. Outputs are concatenated into the context for the
// next step.

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate, getSystemClient } from '@/lib/ai/factory';
import { buildChatSystemPrompt, detectModelFamily } from '@/lib/work/chat-system-prompt';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { buildInboxSnapshot } from '@/lib/inbox/chat-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { executeWebSearch, executeFetchUrl, executeRssFeed, executeLinkedInPost, executeBrowserFetch, executePtTenders, executeDeepResearch } from '@/lib/tools';
import type { WorkflowStep, StepOutput, ToolStep, AIStep, AgentStep } from './types';

export interface StepContext {
  userId: string;
  supabase: SupabaseClient;   // service-role client — runs as system, no auth.uid()
  previousOutputs: StepOutput[];
  workflowName: string;
  lastRunAt?: string | null;  // workflow.last_run_at — used by rss_feed since:'last_run'
  outputLanguage?: string;    // BCP-47 from output_config.output_language — injected into AI steps
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

function formatPreviousOutputs(outputs: StepOutput[]): string {
  if (outputs.length === 0) return '';
  const parts = outputs.map((o, i) => {
    const body = typeof o.output === 'string'
      ? o.output
      : JSON.stringify(o.output, null, 2);
    return `[Step ${i + 1} — ${o.label}]\n${body}`;
  });
  return `<previous_steps>\n${parts.join('\n\n')}\n</previous_steps>`;
}

// ── Tool step ─────────────────────────────────────────────────────────────────

async function executeToolStep(step: ToolStep, ctx: StepContext): Promise<string> {
  switch (step.tool) {
    case 'get_urgent_emails': return await toolGetUrgentEmails(step.config, ctx);
    case 'get_calendar':      return await toolGetCalendar(ctx);
    case 'read_kb_file':      return await toolReadKbFile(step.config, ctx);
    case 'web_search':        return await executeWebSearch(step.config);
    case 'fetch_url':         return await executeFetchUrl(step.config);
    case 'rss_feed':          return await executeRssFeed(step.config, ctx.lastRunAt);
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
    default:
      throw new Error(`Unknown tool: ${step.tool}`);
  }
}

async function toolGetUrgentEmails(
  config: Record<string, unknown>,
  ctx: StepContext,
): Promise<string> {
  const snapshot = await buildInboxSnapshot(ctx.userId, null, ctx.supabase);
  const limit = typeof config.limit === 'number' ? config.limit : 15;

  // Urgency = unread, not dismissed (already filtered by buildInboxSnapshot)
  const urgent = snapshot.filter(e => !e.isRead).slice(0, limit);
  if (urgent.length === 0) return 'No urgent unread emails.';

  return urgent.map(e =>
    `- From: ${e.fromName || e.fromEmail}\n  Subject: ${e.subject}\n  Preview: ${e.snippet?.slice(0, 200) || ''}`
  ).join('\n\n');
}

async function toolGetCalendar(ctx: StepContext): Promise<string> {
  const cal = await getCalendarContext(ctx.userId, ctx.supabase);
  return formatCalendarContextForChat(cal) || 'No upcoming meetings.';
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

  const previousBlock = formatPreviousOutputs(ctx.previousOutputs);
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
    .select('id, name, instructions, memory_text, agent_knowledge_sources(knowledge_file_id)')
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
    agent_knowledge_sources: Array<{ knowledge_file_id: string | null }>;
  };

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
