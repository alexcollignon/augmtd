import type { SupabaseClient } from '@supabase/supabase-js';
import { executeAgentStep } from '@/lib/workflows/execute-step';
import { generateReportBack, fallbackReport, type ReportFacts } from '@/lib/workflows/report-back';
import { getAIClient } from '@/lib/ai/factory';
import type { AgentStep, StepOutput } from '@/lib/workflows/types';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';
import { readPool, writeDeliverable, renderPoolForContext, type Deliverable } from './deliverable-pool';

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
  // Step 4 — grounded delegation: the person + initiative BRAIN for this item, so the coworker does the
  // work reasoning WITH the relationship + where the deal stands (not a cold prompt). Optional.
  brainContext?: string;
}): string {
  const { kind, itemContext, step, remainingSteps, brainContext } = args;

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
    ...(brainContext ? [brainContext, ``] : []),
    `--- THE ITEM (${kind}) ---`,
    itemContext || '(no additional context provided)',
    ``,
    `HOW TO HANDLE IT:`,
    `- Actually DO the work using your tools where you can (research, look things up, draft, analyze).`,
    `- PREPARE the deliverable and hand it back for review — do NOT send an email, post to Slack, or ` +
      `send a calendar invite on your own here. If the natural next step is a message, DRAFT it (in ` +
      `your voice / the right voice) and include the draft in your answer; the user sends it themselves.`,
    `- WORK WITH WHAT YOU HAVE: if some inputs are missing but the work can meaningfully proceed on ` +
      `what's available, DO IT and note the gaps honestly in your hand-back ("built from X; still ` +
      `needs Y for the final version"). Only stop and ask when the work is genuinely impossible or ` +
      `meaningless without the missing pieces — a partial deliverable with honest gaps beats a request list.`,
    `- Report back plainly: what you did, what you're handing over, and anything you couldn't do.`,
    `- Never invent facts to fill a gap — a named gap is honest; a fabricated fact is not.`,
    `- INSIDE a deliverable (a filled-in form, questionnaire, or document), keep every original ` +
      `section/question and where only the user can supply or verify a fact, write ` +
      `"[CONFIRM: <what's needed>]" in its place — a marked slot beats a dropped question.`,
    `- MIRROR THE DOCUMENT'S OWN STRUCTURE: when the material carries headings, tables, or ` +
      `numbered lists (markdown), your deliverable reproduces that structure in markdown — ` +
      `same headings, tables as | tables |, numbering as numbering. The document you hand ` +
      `back should look like the one you were handed, filled in.`,
  ].join('\n');
}

export interface DelegateResult {
  output: string;
  agentName: string;
  threadId: string | null;
  reportText: string;
  deliverable?: Deliverable;   // the coworker's output written to the per-item pool (S2)
  poolSize?: number;           // pool entries the coworker saw as context (for logging / smoke test)
  /** FIX 3 — the evaluator judged the output a genuine ASK for principal-only inputs; these are the
   *  concrete things requested. The output was routed as a room checklist, NOT stored as a deliverable. */
  needsInput?: string[];
  /** ARTIFACTS-INTO-ORIGIN (Aug 9): substantial delegated production is materialized as a REAL
   *  document artifact on the delegation thread (same primitives as workflow runs) — the origin
   *  conversation renders its card and opens it, instead of pointing at a text wall elsewhere. */
  artifact?: { id: string; title: string; threadId: string } | null;
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
  // ── task-workflows S2: the item this delegation belongs to, so the coworker READS the per-item
  // deliverable pool (build on prior steps — engine-gap #1: was `previousOutputs: []`) and WRITES its
  // output back into the pool for downstream steps. Optional/back-compatible: absent → no pool wiring
  // (identical to pre-S2 behaviour). `taskId` = the plan step being delegated (dedup key for the write).
  pool?: { kind: ItemPlanKind; entityId: string; taskId?: string | null };
  /** PROVENANCE (Prepared-Work): what this work was grounded in — rides the deliverable's metadata so
   *  the PreparedLead / entity ledger can show "from: <item> · <deal>" (trust is the product). */
  provenance?: Record<string, unknown>;
}): Promise<DelegateResult> {
  const { supabase, userId, worker, prompt, itemLabel, firstName, pool: poolScope } = args;

  // ── Read the per-item deliverable pool so the coworker builds on what prior steps produced (S2 — the
  // engine-gap #1 fix). The pool is rendered into a SINGLE previousOutputs entry, which both the native
  // `executeAgentStep` path and the AgentOS bridge fold into the coworker's context as `<previous_steps>`
  // → the coworker literally sees "ALREADY PRODUCED …". Instance-honest: only real deliverables render;
  // an empty pool renders '' → previousOutputs stays [] (identical to the old behaviour). Non-fatal.
  let pool: Deliverable[] = [];
  const previousOutputs: StepOutput[] = [];
  if (poolScope) {
    pool = await readPool(supabase, userId, poolScope.kind, poolScope.entityId);
    const poolContext = renderPoolForContext(pool, poolScope.taskId ?? undefined);
    if (poolContext) {
      previousOutputs.push({
        step_id: 'pool',
        step_type: 'ai',
        label: 'Already produced for this item',
        output: poolContext,
        duration_ms: 0,
      });
    }
  }

  // ── Run the coworker through the ONE worker entry point (flag-agnostic). ──
  const step: AgentStep = { type: 'agent', id: 'delegate', label: 'Delegated work', agent_id: worker.id, prompt };
  let output = (await executeAgentStep(step, {
    userId,
    supabase,
    previousOutputs,
    workflowName: `Delegation: ${itemLabel}`.slice(0, 120),
  })).trim();

  // ── THE EVALUATOR REVIEWS DELEGATED OUTPUT like every other artifact (promise fix): the same
  // `evaluateDeliverable` (incl. the deliverable-shape rule — deliberation/meta-monologue is not
  // a deliverable). One capped retry with the objection; still failing → the output is NOT stored
  // as prepared work and the report-back says so honestly. Non-fatal: an evaluator error → pass. ──
  let deliverableOk = true;
  let evalObjection: string | null = null;
  // FIX 3 (the Max monologue-ask class): when the evaluator's REASONED read is "this output is
  // fundamentally an ASK for things only the principal can supply", the work routes as a REQUEST —
  // an attributed room turn + input checklist — and is NEVER stored as prepared work. No retry:
  // a genuine missing-inputs ask can't be regenerated away.
  let needsInput: string[] | null = null;
  try {
    const { evaluateDeliverable } = await import('@/lib/prepare/evaluate');
    let review = await evaluateDeliverable(supabase, userId, { content: output, task: itemLabel, recipient: null, entityId: null, kind: 'deliverable' });
    if (review.verdict === 'revise' && review.objection) {
      const retry = (await executeAgentStep(
        { ...step, prompt: `${prompt}\n\nA REVIEWER REJECTED YOUR FIRST ATTEMPT:\n"${review.objection}"\nProduce the actual finished deliverable now — the thing itself, not commentary about it.` },
        { userId, supabase, previousOutputs, workflowName: `Delegation (retry): ${itemLabel}`.slice(0, 120) },
      ).catch(() => '')).trim();
      if (retry) {
        review = await evaluateDeliverable(supabase, userId, { content: retry, task: itemLabel, recipient: null, entityId: null, kind: 'deliverable' });
        if (review.verdict !== 'revise') output = retry;
      }
    }
    if (review.verdict === 'needs_input') { deliverableOk = false; needsInput = review.missing ?? []; }
    else if (review.verdict === 'revise') { deliverableOk = false; evalObjection = review.objection; }
  } catch { /* review is an enhancement */ }

  // ── Report-back (DM from the coworker) — reuse the scheduled-task report writer. A rejected
  // deliverable reports the PROBLEM honestly instead of pretending work exists. ──
  const facts: ReportFacts = {
    worker: { name: worker.name },
    firstName: firstName || undefined,
    taskName: itemLabel,
    home: 'message',
    deliverableGist: deliverableOk ? output : undefined,
    problem: deliverableOk ? undefined
      : needsInput ? `I need from you before I can finish: ${needsInput.join('; ')}`
      : (evalObjection ?? "the attempt didn't produce a usable deliverable"),
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
    // ONE STANDING HAND-OFF THREAD per (user, worker) — owner, Aug 9: a thread per delegation
    // flooded the coworker's conversation list with dozens of "Handed to Max: …" rows (engine
    // plumbing parading as conversations). Every delegation now appends to the worker's one
    // "Handed to <Name>" thread — the exchange reads as an ongoing working relationship, and
    // artifacts accumulate in one place.
    const standingTitle = `Handed to ${worker.name}`;
    const { data: standing } = await supabase.from('work_threads').select('id')
      .eq('user_id', userId).eq('agent_id', worker.id).eq('status', 'active')
      .eq('title', standingTitle).is('workflow_id', null)
      .limit(1).maybeSingle();
    if (standing?.id) {
      threadId = standing.id as string;
    } else {
      const { data: thread } = await supabase
        .from('work_threads')
        .insert({
          user_id: userId,
          agent_id: worker.id,
          title: standingTitle,
          status: 'active',
        })
        .select('id')
        .single();
      threadId = (thread?.id as string) ?? null;
    }
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

  // ── ARTIFACTS-INTO-ORIGIN (Aug 9): substantial produced work becomes a REAL document artifact
  // on the delegation thread — the same textToDocContent + storage path a workflow run uses, so
  // the viewer/download/versions machinery all just work. A short answer or an ask stays text
  // (not everything a coworker says is a document). Non-fatal: the delegation already landed. ──
  let artifact: DelegateResult['artifact'] = null;
  if (threadId && deliverableOk && output.length >= 600) {
    try {
      const { textToDocContent, uploadArtifact } = await import('@/lib/workflows/doc-content');
      const { randomUUID } = await import('crypto');
      const title = itemLabel.slice(0, 120) || 'Delegated work';
      const doc = textToDocContent(title, output);
      const artifactId = randomUUID();
      const { storagePath } = await uploadArtifact(supabase, userId, threadId, artifactId, 'document', doc);
      const row = {
        id: artifactId, title, type: 'document' as const,
        generated_at: new Date().toISOString(), storage_path: storagePath, content: doc,
      };
      const { data: th } = await supabase.from('work_threads').select('artifacts').eq('id', threadId).single();
      const existing = Array.isArray(th?.artifacts) ? (th!.artifacts as unknown[]) : [];
      await supabase.from('work_threads')
        .update({ artifacts: [...existing, row].slice(-20), artifact: row, updated_at: new Date().toISOString() })
        .eq('id', threadId);
      artifact = { id: artifactId, title, threadId };
    } catch (e) {
      console.error('[delegate] artifact materialization failed (non-fatal):', e);
    }
  }

  // ── Write the coworker's output into the per-item pool (S2 — ADDITIVE; report-back + thread +
  // handedTo attribution above are unchanged). Downstream steps + other coworkers read this. A coworker
  // output is stored as `text` (or `draft` when the delegated step was a draft) with the coworker's
  // deliverable in `content`; if the coworker produced a real document/artifact with an id, we'd store
  // its `ref` + type `document` — but the native/AgentOS text path returns text, so `text` is correct
  // here. Dedup on `task_id` (a re-run REPLACES). Non-fatal: a pool-write failure never loses the run.
  let deliverable: Deliverable | undefined;
  if (poolScope && deliverableOk) {
    const gist = output.replace(/\s+/g, ' ').slice(0, 140);
    deliverable = await writeDeliverable(supabase, userId, {
      kind: poolScope.kind,
      entityId: poolScope.entityId,
      taskId: poolScope.taskId ?? null,
      type: 'text',
      title: itemLabel.slice(0, 100),
      content: output.slice(0, 8000),
      gist,
      metadata: { source: 'delegation', agentId: worker.id, agentName: worker.name, ...(args.provenance ? { provenance: args.provenance } : {}) },
    }) ?? undefined;
  }

  // ── R1 (one-room): THE ENGINE NARRATES — the coworker's report-back ALSO lands as an authored
  // turn in the item's room (the group-channel model: contributors report where the work lives,
  // not only in their own chat tab). Deduped per delegated step so a re-run replaces. Non-fatal. ──
  if (poolScope) {
    try {
      const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
      const itemKind = poolScope.kind === 'commitment' || poolScope.kind === 'followup' ? 'commitment' as const
        : poolScope.kind === 'meeting' ? 'meeting' as const : 'inbox' as const;
      const roomKey = await roomKeyForItem(supabase, userId, itemKind, poolScope.entityId);
      await writeRoomTurn(supabase, userId, roomKey, {
        role: 'system', text: reportText,
        // Promise fix #6b — the report-back names its item (a shared deal room is never ambiguous).
        refs: [{ label: itemLabel.slice(0, 60), href: itemKind === 'commitment' ? `/item/${poolScope.entityId}?kind=commitment` : itemKind === 'meeting' ? `/item/${poolScope.entityId}?kind=meeting` : `/item/${poolScope.entityId}` }],
        author: { kind: 'coworker', id: worker.id, name: worker.name, role: worker.worker_role },
        dedupeKey: `delegate:${poolScope.entityId}:${poolScope.taskId ?? 'item'}`,
        // FIX 3 — the coworker's ASK is a durable inline CHECKLIST in the room (the group-channel
        // model: a teammate asking for inputs is a conversation event with affordances, never a
        // "Prepared by" card). Rows wire to the rail's ingest funnel (attach → the pool → every
        // reader sees it). Re-render on every load until satisfied; a re-run REPLACES (dedupeKey).
        ...(needsInput?.length ? { component: { key: 'input_checklist', state: { items: needsInput, taskId: poolScope.taskId ?? null } } } : {}),
      });
      // THE COWORKER SUPERSEDES: whatever the outcome — a real deliverable OR the coworker's own
      // ask — the engine's provisional requirements ask is now stale (the worker either did the
      // work with what existed, or asked for exactly what it needs). One ask per item.
      await supabase.from('room_turns').delete()
        .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', `requires:${poolScope.entityId}`)
        .then(() => {}, () => {});
    } catch { /* narration is an enhancement — the delegation already landed */ }
  }

  return { output, agentName: worker.name, threadId, reportText, deliverable, poolSize: pool.length, artifact, ...(needsInput?.length ? { needsInput } : {}) };
}
