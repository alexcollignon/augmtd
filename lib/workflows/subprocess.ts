// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SUBPROCESS STATION (THE RELAY CANVAS W3 — docs/relay-canvas-plan.md, LAW 5:
// "A SUBPROCESS IS A HANDOFF TO A MACHINE").
//
// The parent parks at the ⧉ station using the EXACT machinery the human gates use
// (`awaiting_approval` — the existing status; the house lesson is that a new CHECK-constraint
// value is a silent park failure). The child runs its own rail, with its OWN gate, owner and SLA.
// Its completion RESUMES the parent, its deliverable landing as the station's step output — the
// get_workflow_output semantics, awaited instead of read out of history.
//
// THE LINK ROW is the whole contract: `item_plans` kind 'subprocess_link',
// entity_id `<parentRunId>:<stepId>` — the insert-first CLAIM (the handoff_nudge idiom: two
// concurrent fires cannot both win on (user_id, kind, entity_id)), carrying the child run id,
// the child workflow id and when it fired.
//
// FLOORS:
//  · THE DOOR CHECK (async, at fire time — readiness stays pure): the child must exist, belong to
//    the same user, be ACTIVE, and contain NO workflow step. DEPTH CAP 1 — which also makes
//    circularity structurally impossible beyond self-reference (readiness refuses that, purely).
//  · EXACTLY ONCE both ways: the link row claims the fire; an atomic status claim on the parent
//    (awaiting_approval → queued) fences a double resume. A second child completion loses silently.
//  · A FAILED CHILD NEVER STRANDS ITS PARENT: the parent fails honestly with the reason spoken.
//  · THE SWEEP: a lost resume (crash between the child's tail and the parent's claim) is repaired
//    by `sweepStrandedSubprocessParks`, wired into the hourly dispatcher beside the SLA chase.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import type { StepOutput, SubprocessStep, WorkflowStep } from './types';

export const SUBPROCESS_LINK_KIND = 'subprocess_link';

/** The baton the parent hands down: its accumulated context, capped and excerpt-honest. */
export const BATON_MAX_CHARS = 12_000;
/** The deliverable the child hands back, capped and excerpt-honest. */
export const DELIVERABLE_MAX_CHARS = 30_000;

export interface SubprocessLink {
  parentRunId: string;
  stepId: string;
  childRunId: string | null;
  childWorkflowId: string;
  firedAt: string;
  /** THE BATON as actually handed over — stored so the fire is auditable and the context survives
   *  the process that built it. */
  context?: string;
}

export function linkEntityId(parentRunId: string, stepId: string): string {
  return `${parentRunId}:${stepId}`;
}

// ── THE DOOR CHECK ───────────────────────────────────────────────────────────────────────────────

export type DoorCheck =
  | { ok: true; child: { id: string; name: string } }
  | { ok: false; reason: string };

/** The spoken refusal — ONE sentence shape, three clauses. The station's own label leads so the
 *  person reads WHICH station refused, not just that one did. */
export function subprocessRefusal(label: string, clause: string): string {
  return `The '${(label || 'process').slice(0, 60)}' process step points at a workflow that ${clause}.`;
}

/** Load the child and prove it can be handed the baton. ASYNC ON PURPOSE — readiness is pure and
 *  synchronous; ownership, status and depth are facts only the database holds. */
export async function checkSubprocessDoor(
  admin: SupabaseClient,
  userId: string,
  step: Pick<SubprocessStep, 'label' | 'workflow_id'>,
  parentWorkflowId: string,
): Promise<DoorCheck> {
  const label = step.label || 'process';
  const childId = String(step.workflow_id ?? '').trim();
  if (!childId) return { ok: false, reason: subprocessRefusal(label, "doesn't exist") };
  if (childId === parentWorkflowId) {
    return { ok: false, reason: "A workflow can't include itself as a step." };
  }
  const { data: child, error } = await admin.from('workflows')
    .select('id, user_id, name, status, steps')
    .eq('id', childId).maybeSingle();
  if (error || !child) return { ok: false, reason: subprocessRefusal(label, "doesn't exist") };
  const row = child as { id: string; user_id: string; name: string; status: string; steps: WorkflowStep[] | null };
  // A workflow that isn't yours is, for this purpose, one that doesn't exist (a stranger learns
  // nothing about another account's workflows).
  if (row.user_id !== userId) return { ok: false, reason: subprocessRefusal(label, "doesn't exist") };
  if (row.status === 'draft') return { ok: false, reason: subprocessRefusal(label, 'is a draft') };
  const nested = (row.steps ?? []).some((s) => (s as { type?: string })?.type === 'workflow');
  if (nested) {
    return { ok: false, reason: subprocessRefusal(label, 'itself contains a process step — one level deep only') };
  }
  return { ok: true, child: { id: row.id, name: row.name } };
}

// ── THE CLAIM ────────────────────────────────────────────────────────────────────────────────────

/** Insert-first claim (the handoff_nudge idiom). A losing insert falls back to a read: an existing
 *  row means someone already fired this station for this run — never fire twice. */
export async function claimSubprocess(
  admin: SupabaseClient, userId: string,
  parentRunId: string, stepId: string, childWorkflowId: string,
): Promise<boolean> {
  const entityId = linkEntityId(parentRunId, stepId);
  const tasks: SubprocessLink = {
    parentRunId, stepId, childRunId: null, childWorkflowId,
    firedAt: new Date().toISOString(),
  };
  const { error } = await admin.from('item_plans').insert({
    user_id: userId, kind: SUBPROCESS_LINK_KIND, entity_id: entityId, tasks,
  });
  if (!error) return true;
  // Either an existing row (someone already fired this station for this run) or a record layer
  // that is down — NEITHER may fire. An unclaimed fire is a child that can never resume its parent.
  return false;
}

/** Record the child's run id on the claim — the resume reads the link BY this id. */
export async function bindChildRun(
  admin: SupabaseClient, userId: string,
  parentRunId: string, stepId: string, childRunId: string,
  context?: string,
): Promise<void> {
  const entityId = linkEntityId(parentRunId, stepId);
  const { data: row } = await admin.from('item_plans').select('tasks')
    .eq('user_id', userId).eq('kind', SUBPROCESS_LINK_KIND).eq('entity_id', entityId).maybeSingle();
  const tasks = {
    ...(row?.tasks as Record<string, unknown> ?? {}),
    childRunId, ...(context ? { context } : {}),
  };
  await admin.from('item_plans').update({ tasks })
    .eq('user_id', userId).eq('kind', SUBPROCESS_LINK_KIND).eq('entity_id', entityId);
}

// ── THE RESUME ───────────────────────────────────────────────────────────────────────────────────

export interface ChildOutcome {
  ok: boolean;
  deliverable?: string;
  error?: string;
}

/** The parent's honest failure sentence when its child did not deliver. */
export function subprocessFailure(label: string, outcome: ChildOutcome): string {
  const name = (label || 'process').slice(0, 60);
  if (outcome.error) {
    return `The '${name}' process failed: ${String(outcome.error).replace(/\s+/g, ' ').trim().slice(0, 160)}.`;
  }
  return `The '${name}' process was held back.`;
}

/**
 * THE ONE RESUME DOOR: every terminal end of a child run calls this. Finds the parent(s) parked on
 * this child (≤1 by construction — N tolerated), claims each atomically, and either continues the
 * parent past its station with the deliverable in hand, or fails it honestly.
 * Best-effort by contract: it never throws into a child's own tail.
 */
export async function resumeParentsOf(
  admin: SupabaseClient,
  childRunId: string,
  outcome: ChildOutcome,
): Promise<{ resumed: string[]; failed: string[] }> {
  const resumed: string[] = [];
  const failed: string[] = [];
  try {
    const { data: links } = await admin.from('item_plans')
      .select('user_id, entity_id, tasks')
      .eq('kind', SUBPROCESS_LINK_KIND)
      .eq('tasks->>childRunId', childRunId)
      .limit(10);
    for (const link of (links ?? []) as Array<{ user_id: string; entity_id: string; tasks: SubprocessLink }>) {
      const parentRunId = link.tasks?.parentRunId ?? String(link.entity_id).split(':')[0];
      const stepId = link.tasks?.stepId ?? String(link.entity_id).split(':').slice(1).join(':');
      if (!parentRunId || !stepId) continue;
      const r = await resumeOneParent(admin, parentRunId, stepId, outcome);
      if (r === 'resumed') resumed.push(parentRunId);
      else if (r === 'failed') failed.push(parentRunId);
    }
  } catch (e) {
    console.error('[subprocess] resumeParentsOf failed:', e);
  }
  return { resumed, failed };
}

async function resumeOneParent(
  admin: SupabaseClient,
  parentRunId: string,
  stepId: string,
  outcome: ChildOutcome,
): Promise<'resumed' | 'failed' | 'skipped'> {
  // THE ATOMIC CLAIM: only a run still parked at the station may be resumed. A lost claim means
  // someone else already took it (a second child completion, the sweep) — stop silently.
  const { data: claimed } = await admin.from('workflow_runs')
    .update({ status: 'queued' })
    .eq('id', parentRunId).eq('status', 'awaiting_approval')
    .select('id, workflow_id, step_outputs');
  if (!claimed?.length) return 'skipped';
  const parent = claimed[0] as { id: string; workflow_id: string; step_outputs: StepOutput[] | null };

  // The station's label comes from the authored step (surfaces render it without a lookup).
  const { data: wf } = await admin.from('workflows').select('id, steps').eq('id', parent.workflow_id).maybeSingle();
  const step = ((wf?.steps ?? []) as WorkflowStep[]).find((s) => s.id === stepId) as SubprocessStep | undefined;
  const label = step?.label || 'process';

  if (!outcome.ok) {
    // A FAILED CHILD NEVER STRANDS A PARKED PARENT — the parent ends honestly, no steps re-run.
    const reason = subprocessFailure(label, outcome);
    await admin.from('workflow_runs').update({
      status: 'failed', error: reason, completed_at: new Date().toISOString(),
    }).eq('id', parentRunId);
    return 'failed';
  }

  const outs = (parent.step_outputs ?? []) as StepOutput[];
  const already = outs.some((o) => o.step_id === stepId);
  if (!already) {
    outs.push({
      step_id: stepId,
      step_type: 'workflow',
      label,
      output: clipForPrompt(String(outcome.deliverable ?? '').trim() || '(the process delivered no text.)', DELIVERABLE_MAX_CHARS),
    });
    await admin.from('workflow_runs').update({ step_outputs: outs }).eq('id', parentRunId);
  }

  const go = async () => {
    try {
      const { runWorkflow } = await import('@/lib/workflows/run-workflow');
      await runWorkflow({
        workflowId: parent.workflow_id, runId: parentRunId,
        triggerSource: 'manual', resumeSeeded: true,
      });
    } catch (e) { console.error('[subprocess] parent resume failed:', e); }
  };
  try {
    const { after } = await import('next/server');
    after(go);
  } catch {
    // No request scope (scripts/cron-less contexts): run inline. The dispatcher sweep is the
    // backstop if even that is lost.
    await go();
  }
  return 'resumed';
}

// ── THE SWEEP ────────────────────────────────────────────────────────────────────────────────────

/** A parent parked whose child is terminally done but whose resume was lost (a crash between the
 *  child's tail and the parent's claim). Repairs ≤20 per pass; wired into the hourly dispatcher. */
export async function sweepStrandedSubprocessParks(admin: SupabaseClient): Promise<string[]> {
  const repaired: string[] = [];
  try {
    const { data: links } = await admin.from('item_plans')
      .select('entity_id, tasks')
      .eq('kind', SUBPROCESS_LINK_KIND)
      .order('created_at', { ascending: false })
      .limit(200);
    for (const link of (links ?? []) as Array<{ entity_id: string; tasks: SubprocessLink }>) {
      if (repaired.length >= 20) break;
      const childRunId = link.tasks?.childRunId;
      const parentRunId = link.tasks?.parentRunId ?? String(link.entity_id).split(':')[0];
      const stepId = link.tasks?.stepId ?? String(link.entity_id).split(':').slice(1).join(':');
      if (!childRunId || !parentRunId || !stepId) continue;
      const { data: parent } = await admin.from('workflow_runs')
        .select('id, status').eq('id', parentRunId).maybeSingle();
      if ((parent as { status?: string } | null)?.status !== 'awaiting_approval') continue;
      const { data: child } = await admin.from('workflow_runs')
        .select('id, status, error, step_outputs').eq('id', childRunId).maybeSingle();
      const c = child as { status?: string; error?: string | null; step_outputs?: StepOutput[] | null } | null;
      if (!c) continue;
      if (c.status === 'succeeded') {
        const outs = (c.step_outputs ?? []) as StepOutput[];
        const last = outs[outs.length - 1];
        const text = typeof last?.output === 'string' ? last.output : JSON.stringify(last?.output ?? '');
        const r = await resumeOneParent(admin, parentRunId, stepId, { ok: true, deliverable: text });
        if (r !== 'skipped') repaired.push(parentRunId);
      } else if (c.status === 'failed' || c.status === 'rejected' || c.status === 'cancelled') {
        const r = await resumeOneParent(admin, parentRunId, stepId, {
          ok: false, ...(c.status === 'failed' && c.error ? { error: c.error } : {}),
        });
        if (r !== 'skipped') repaired.push(parentRunId);
      }
    }
  } catch (e) {
    console.error('[subprocess] sweep failed:', e);
  }
  return repaired;
}

// ── TEST MODE ────────────────────────────────────────────────────────────────────────────────────

/** TEST MODE NEVER FIRES THE CHILD (law 5). It reads the child's LATEST DELIVERED output — exactly
 *  the get_workflow_output semantics (last successful run · final step output) — and says so. No
 *  delivery in hand → an honest placeholder; the run continues either way. */
export async function testModeSubprocessOutput(
  admin: SupabaseClient, userId: string,
  step: Pick<SubprocessStep, 'label' | 'workflow_id'>,
): Promise<string> {
  const label = step.label || 'process';
  const childId = String(step.workflow_id ?? '').trim();
  if (!childId) return `[${label} — test mode: no workflow is bound to this process step, so nothing ran.]`;
  try {
    const { data: child } = await admin.from('workflows')
      .select('id, user_id, name').eq('id', childId).maybeSingle();
    const row = child as { id: string; user_id: string; name: string } | null;
    if (!row || row.user_id !== userId) {
      return `[${label} — test mode: that workflow could not be read, so nothing ran.]`;
    }
    const { data: runs } = await admin.from('workflow_runs')
      .select('id, step_outputs, completed_at')
      .eq('workflow_id', childId).eq('status', 'succeeded')
      .order('completed_at', { ascending: false }).limit(1);
    const run = (runs ?? [])[0] as { step_outputs?: StepOutput[] | null } | undefined;
    const outs = (run?.step_outputs ?? []) as StepOutput[];
    const last = outs[outs.length - 1];
    const text = typeof last?.output === 'string' ? last.output : (last ? JSON.stringify(last.output ?? '') : '');
    if (!text.trim()) {
      return `[${label} — test mode: it has never delivered yet, so there is nothing to stand in for it. The real run would wait for it.]`;
    }
    return `[from ${label}'s last delivery — test mode]\n${clipForPrompt(text, DELIVERABLE_MAX_CHARS)}`;
  } catch {
    return `[${label} — test mode: its last delivery could not be read, so nothing ran.]`;
  }
}

/** THE BATON: the parent's accumulated context, handed to the child as its trigger context.
 *  Excerpt-honest by construction (formatPreviousOutputs' shape, clipped with the marker). */
export function batonFor(parentWorkflowName: string, outputs: StepOutput[]): string {
  // THE EXCERPT-HONESTY LAW rides the HEADER, not the tail — a clipped baton can never strip the
  // rule that explains its own marker (the delegation-contract lesson, Aug 17).
  const head = `[SUBPROCESS — invoked by ${parentWorkflowName}]\n${EXCERPT_RULE}`;
  if (!outputs.length) return `${head}\n(The calling process had produced nothing yet when it handed over.)`;
  const body = outputs.map((o, i) => {
    const text = typeof o.output === 'string' ? o.output : JSON.stringify(o.output ?? '', null, 2);
    return `[Step ${i + 1} — ${o.label}]\n${text}`;
  }).join('\n\n');
  return `${head}\n${clipForPrompt(body, BATON_MAX_CHARS)}`;
}
