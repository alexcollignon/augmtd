import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateCostEur } from './pricing';
import { effortOf, type AIEffort } from './effort';

export type AIUsageSource =
  | 'workflow_step'       // Studio workflow AI steps
  | 'chat'                // native-loop worker/inbox/meeting chat
  | 'agentos_step'        // Studio workflow `agent` steps routed through AgentOS
  | 'agentos_chat'        // live worker chat routed through AgentOS (majority of chat traffic in prod)
  | 'email_processing'
  | 'meeting_insights'
  | 'kb_indexing'
  | 'memory_extraction'      // worker chat memory (lib/agents/extract-memory.ts)
  | 'profile_rendering'      // context_profiles → human-readable prose (lib/context/render-memory.ts)
  | 'generate_config'
  | 'brief_synthesis'
  | 'worker_briefing'
  | 'team_briefing'
  | 'alignment_synthesis'
  | 'brain_synthesis'        // initiative/person brain state synthesis (lib/initiatives/brain.ts, lib/people/brain.ts)
  | 'bundle_naming'          // Home deck bundle naming (lib/home/name-bundles.ts)
  | 'task_preparation'       // the Preparation Pass over tasks (lib/prepare/pass.ts — shapes + doc-send judges)
  | 'member_directory'       // member-directory sector derivation (lib/tenders/member-directory.ts)
  | 'member_enrichment'      // member website → profile paragraph (lib/tenders/enrich-members.ts)
  | 'tender_matching'        // legacy label, kept so historical rows keep their meaning
  | 'profile_matching'       // the items→profiles match judge (lib/matching/match-profiles.ts)
  | 'deep_research';         // the agentic research loop (lib/tools/deep-research.ts — always Bedrock EU)

export interface LogAIUsageParams {
  userId: string;
  agentId?: string | null;
  workflowId?: string | null;
  source: AIUsageSource;
  provider: string;
  model: string;
  /** The company's actual billing tier (e.g. 'standard', 'bedrock_optimised') — NOT the AI task
   *  type. Kept as a plain string (not TierType) so this file doesn't need to import lib/ai/types
   *  just for a label; callers should pass ResolvedClient.tier. */
  tier?: string;
  /** The AI task type (e.g. 'conversation', 'summarization') — separate dimension from tier. */
  taskType?: string;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
  /** W27.C — the effort the call ran at, when a caller knows it. Otherwise read from the stamp aiCreate
   *  leaves on `usage` (lib/ai/effort.ts), so direct aiCreate producers record it without an edit. */
  effort?: AIEffort | null;
}

/** THE EFFORT RECORD (W27.C): a call that ran ABOVE the param floor is recorded as `<task>@<effort>` in
 *  task_type (no schema change — the table has no effort column, and code must work before any
 *  migration). The floor ('minimal', or nothing stated) keeps the bare task type, so every default row —
 *  and every existing channel grouping (lib/platform/status.ts) — is unchanged. Pure. */
export function taskTypeWithEffort(taskType: string | null | undefined, effort: AIEffort | null | undefined): string | null {
  if (!taskType) return taskType ?? null;
  return effort && effort !== 'minimal' ? `${taskType}@${effort}` : taskType;
}

/**
 * Non-fatal usage logger. Never throws — a logging failure must never break the AI call it's
 * observing. See AIUsageSource for what's covered; each new call site adds its own source label
 * here rather than overloading an existing one, so cost can eventually be sliced by feature.
 */
export async function logAIUsage(supabase: SupabaseClient, params: LogAIUsageParams): Promise<void> {
  const promptTokens = params.usage?.prompt_tokens ?? 0;
  const completionTokens = params.usage?.completion_tokens ?? 0;
  if (promptTokens === 0 && completionTokens === 0) return;

  try {
    await supabase.from('ai_usage_events').insert({
      user_id: params.userId,
      agent_id: params.agentId ?? null,
      workflow_id: params.workflowId ?? null,
      source: params.source,
      provider: params.provider,
      model: params.model,
      tier: params.tier ?? null,
      // The transport's stamp (what was APPLIED — null when the model had nothing to steer) wins.
      task_type: taskTypeWithEffort(params.taskType, effortOf(params.usage) !== undefined ? effortOf(params.usage) : params.effort),
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_eur: estimateCostEur(params.model, promptTokens, completionTokens),
    });
  } catch (err) {
    console.error('[logAIUsage] failed to log usage event:', err);
  }
}
