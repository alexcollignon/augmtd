// ─── Workflow output reader ───────────────────────────────────────────────────
// Reads the output of another workflow's recent successful runs and injects it
// as context for the next step. Works for any workflow/user — access-controlled
// to owned workflows and workspace-shared workflows.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StepContext } from '@/lib/workflows/execute-step';

export interface WorkflowOutputConfig {
  /** UUID of the workflow to read from */
  source_workflow_id: string;
  /** How many recent successful runs to include — 1–7, default 1 */
  run_count?: number;
  /** true (default) = final step output only; false = all step outputs */
  output_only?: boolean;
}

const MAX_CHARS = 20_000;
const MAX_RUNS = 7;

export async function executeWorkflowOutput(
  config: Record<string, unknown>,
  ctx: StepContext,
): Promise<string> {
  const sourceId = typeof config.source_workflow_id === 'string' ? config.source_workflow_id.trim() : '';
  if (!sourceId) return '[get_workflow_output] No source workflow configured.';

  const runCount = Math.min(Math.max(typeof config.run_count === 'number' ? config.run_count : 1, 1), MAX_RUNS);
  const outputOnly = config.output_only !== false; // default true

  // Circular reference guard
  if (ctx.workflowId && sourceId === ctx.workflowId) {
    return '[get_workflow_output] A workflow cannot read its own output.';
  }

  const callerId = ctx.runnerId ?? ctx.userId;

  // Load source workflow metadata
  const { data: sourceWorkflow } = await ctx.supabase
    .from('workflows')
    .select('id, user_id, company_id, sharing_mode, name')
    .eq('id', sourceId)
    .single();

  if (!sourceWorkflow) {
    return '[get_workflow_output] Source workflow not found.';
  }

  // Access control — owned or workspace-shared
  const isOwned = sourceWorkflow.user_id === callerId;
  let isShared = false;

  if (!isOwned && sourceWorkflow.sharing_mode && sourceWorkflow.company_id) {
    const { data: membership } = await ctx.supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', callerId)
      .eq('company_id', sourceWorkflow.company_id)
      .maybeSingle();
    isShared = !!membership;
  }

  if (!isOwned && !isShared) {
    return '[get_workflow_output] Access denied: workflow is not owned by you or shared with your workspace.';
  }

  // Fetch recent successful runs
  const { data: runs } = await ctx.supabase
    .from('workflow_runs')
    .select('id, step_outputs, completed_at')
    .eq('workflow_id', sourceId)
    .eq('status', 'succeeded')
    .order('completed_at', { ascending: false })
    .limit(runCount);

  if (!runs || runs.length === 0) {
    return `[get_workflow_output] No successful runs found for workflow "${sourceWorkflow.name}".`;
  }

  const parts: string[] = [];

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] as { id: string; step_outputs: Array<{ step_id: string; label: string; output: unknown; error?: string }>; completed_at: string };
    const outputs = Array.isArray(run.step_outputs) ? run.step_outputs : [];
    if (outputs.length === 0) continue;

    const runLabel = runs.length > 1
      ? `[${sourceWorkflow.name} — ${new Date(run.completed_at).toLocaleDateString()}]`
      : null;

    if (outputOnly) {
      // Final step output only
      const last = outputs[outputs.length - 1];
      const text = coerceOutput(last.output);
      if (runLabel) parts.push(`${runLabel}\n${text}`);
      else parts.push(text);
    } else {
      // All steps
      const stepParts = outputs
        .filter(o => !o.error)
        .map(o => `[${o.label}]\n${coerceOutput(o.output)}`);
      const block = stepParts.join('\n\n');
      if (runLabel) parts.push(`${runLabel}\n${block}`);
      else parts.push(block);
    }
  }

  if (parts.length === 0) {
    return `[get_workflow_output] Runs found but all outputs were empty for "${sourceWorkflow.name}".`;
  }

  const joined = parts.join('\n\n---\n\n');

  if (joined.length > MAX_CHARS) {
    return joined.slice(0, MAX_CHARS) + `\n\n[Output truncated at ${MAX_CHARS} characters]`;
  }

  return joined;
}

function coerceOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null || output === undefined) return '';
  return JSON.stringify(output, null, 2);
}
