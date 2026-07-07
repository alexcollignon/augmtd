import type { SupabaseClient } from '@supabase/supabase-js';
import { executeAgentStep } from '@/lib/workflows/execute-step';
import { generateReportBack, fallbackReport, type ReportFacts } from '@/lib/workflows/report-back';
import { getAIClient } from '@/lib/ai/factory';
import type { AgentStep } from '@/lib/workflows/types';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HOME ITEM DELEGATION (stage 3b) — hand a Home item, OR a single identified step, to a named coworker
// who executes it via the EXISTING worker-run infrastructure and reports back. This module ONLY
// orchestrates; it runs NO new coworker runtime:
//   • the coworker runs through `executeAgentStep` — the ONE flag-agnostic worker entry point
//     (AgentOS when WORKERS_USE_AGENTOS is on, the native inline call otherwise), with the coworker's
//     tools + skills + persona + per-user context, exactly like a workflow `agent` step.
//   • the report-back reuses `lib/workflows/report-back.ts` `generateReportBack` — the same
//     "DM from a colleague" the scheduled-task path posts.
//
// SAFETY: delegation is EXPLICIT (only on the user picking a coworker + confirming). For this first
// increment the delegated task prompt is framed to PRODUCE the work (draft the reply, prepare the
// invite details, do the research) and report back — NOT to auto-fire an irreversible send from the
// Home. The coworker technically HAS send tools (compose_email is confirm-only, but sendCoworkerEmail /
// slack_post_message / send_calendar_invite can send); the prompt below tells it to prepare and hand
// back rather than send, keeping the user in the loop. See DELEGATION_SAFETY_NOTE.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const DELEGATION_SAFETY_NOTE =
  'The delegated coworker is instructed to PREPARE the work (draft the reply, lay out the invite ' +
  'details, do the research) and report back for the user to review — NOT to send/post/commit an ' +
  'irreversible action from the Home. The coworker still holds send-capable tools; this is a prompt-' +
  'level guardrail, not a hard block. Sending stays an explicit, user-in-the-loop step.';

export interface DelegateWorker {
  id: string;
  name: string;
  worker_role: string | null;
  is_worker: boolean | null;
}

/**
 * Build the task prompt handed to the coworker. If `step` is given, delegate THAT single step's
 * intent; otherwise delegate the whole live (non-dismissed, not-yet-done, not-already-handed-off)
 * remaining plan. Either way the item's grounding context is included so the coworker has the facts.
 */
export function buildDelegationPrompt(args: {
  kind: ItemPlanKind;
  itemContext: string;
  step?: Pick<ItemPlanTask, 'text' | 'detail'> | null;
  remainingSteps?: ItemPlanTask[];
}): string {
  const { kind, itemContext, step, remainingSteps } = args;

  const job = step
    ? `You're being handed ONE specific piece of work to do for me:\n\n` +
      `• ${step.text}${step.detail ? ` — ${step.detail}` : ''}`
    : `You're being handed this whole item to work on for me. Here's what it takes:\n\n` +
      ((remainingSteps ?? [])
        .filter((t) => !t.dismissed && !t.done && !t.handedTo)
        .map((t, i) => `${i + 1}. ${t.text}${t.detail ? ` — ${t.detail}` : ''}`)
        .join('\n') || '(work out what needs to happen from the item below)');

  return [
    `A colleague is handing you real work to do. Treat this like a task a coworker just dropped on your desk.`,
    ``,
    job,
    ``,
    `--- THE ITEM (${kind}) ---`,
    itemContext || '(no additional context provided)',
    ``,
    `HOW TO HANDLE IT:`,
    `- Actually DO the work using your tools where you can (research, look things up, draft, analyze).`,
    `- PREPARE the deliverable and hand it back for review — do NOT send an email, post to Slack, or ` +
      `send a calendar invite on your own here. If the natural next step is a message, DRAFT it (in ` +
      `your voice / the right voice) and include the draft in your answer; the user sends it themselves.`,
    `- Report back plainly: what you did, what you're handing over, and anything you couldn't do.`,
    `- If you genuinely can't do the work with what's here, say so honestly — don't invent facts.`,
  ].join('\n');
}

export interface DelegateResult {
  output: string;
  agentName: string;
  threadId: string | null;
  reportText: string;
}

/**
 * Run a delegation end-to-end: execute the coworker on the assembled prompt (via the flag-agnostic
 * `executeAgentStep`), generate a report-back, and post the delegated task + the coworker's output +
 * the report-back into the coworker's OWN chat thread (a `work_thread` with `agent_id` = the coworker,
 * which surfaces in that coworker's chat tab — the natural home for their work). Non-fatal side
 * effects: a failed thread write never loses the coworker's output.
 */
export async function runDelegation(args: {
  supabase: SupabaseClient;      // service-role client (runs as system, no auth.uid())
  userId: string;
  worker: DelegateWorker;
  prompt: string;
  itemLabel: string;             // short label for the thread title + report-back task name
  firstName?: string | null;
}): Promise<DelegateResult> {
  const { supabase, userId, worker, prompt, itemLabel, firstName } = args;

  // ── Run the coworker through the ONE worker entry point (flag-agnostic). ──
  const step: AgentStep = { type: 'agent', id: 'delegate', label: 'Delegated work', agent_id: worker.id, prompt };
  const output = (await executeAgentStep(step, {
    userId,
    supabase,
    previousOutputs: [],
    workflowName: `Delegation: ${itemLabel}`.slice(0, 120),
  })).trim();

  // ── Report-back (DM from the coworker) — reuse the scheduled-task report writer. ──
  const facts: ReportFacts = {
    worker: { name: worker.name },
    firstName: firstName || undefined,
    taskName: itemLabel,
    home: 'message',
    deliverableGist: output,
  };
  let reportText: string;
  try {
    const { client, model } = await getAIClient(userId, 'conversation', supabase);
    reportText = await generateReportBack(client, model, facts);
  } catch {
    reportText = fallbackReport(facts);
  }

  // ── Post into the coworker's chat thread (non-fatal). The delegated ask is the `user` message; the
  // coworker's output is the `assistant` message — so opening the coworker's chat shows the exchange. ──
  let threadId: string | null = null;
  try {
    const { data: thread } = await supabase
      .from('work_threads')
      .insert({
        user_id: userId,
        agent_id: worker.id,
        title: `Handed to ${worker.name}: ${itemLabel}`.slice(0, 200),
        status: 'active',
      })
      .select('id')
      .single();
    threadId = (thread?.id as string) ?? null;
    if (threadId) {
      await supabase.from('work_messages').insert([
        { thread_id: threadId, role: 'user', content: prompt },
        {
          thread_id: threadId,
          role: 'assistant',
          content: output,
          metadata: { source: 'delegation', report_back: reportText },
        },
      ]);
      await supabase.from('work_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
    }
  } catch (e) {
    console.error('[delegate] thread write failed (non-fatal):', e);
  }

  return { output, agentName: worker.name, threadId, reportText };
}
