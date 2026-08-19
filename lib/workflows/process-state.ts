// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROCESS DERIVATION (processes arc, docs/processes-plan.md — the machine pattern applied to
// runs). A PROCESS is a run wearing its human state: Needs my input · Running · Waiting on
// others · Delivered. ONE reader — the deck, the Workflows page strip, the drawer, and the
// deep-dive all consume THIS derivation; a surface computing its own bucket is the bug class
// this module exists to kill. Derived AT READ TIME from existing truth — no new table.
//
// LAWS (from the plan): failed folds under Needs-my-input with its reason spoken; rejected is
// history (held_back), never attention; Phase A has no handoff steps, so waiting_on_others is
// derivable-but-empty until Phase B gives parks an assignee; THE SUBJECT LADDER is derived,
// never stored (a scheduled repeat run deliberately keeps the plain workflow name — calm).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GateVerdict, WorkflowStep } from './types';

/** Lenient step-output shape — callers select partial columns; only `verdict` is read here. */
export type StepOutputLike = { verdict?: GateVerdict } & Record<string, unknown>;

export type ProcessState =
  | 'needs_you'          // parked for the owner (awaiting_approval / guardrail hold) or failed
  | 'running'            // queued or executing
  | 'waiting_on_others'  // Phase B: a handoff gate assigned to someone else
  | 'delivered'          // succeeded
  | 'held_back';         // rejected — history, never attention

export interface ProcessRow {
  runId: string;
  workflowId: string;
  workflowName: string;
  /** THE SUBJECT LADDER: trigger event title → deliverable/artifact title → workflow name. */
  subject: string;
  state: ProcessState;
  /** Spoken only when it changes what the user does next (e.g. the failure reason). */
  reason?: string;
  startedAt: string;
  endedAt?: string;
  stepsDone: number;
  stepsTotal: number;
  /** The gate's DELTA (existing rule): present only when the last verify verdict changed
   *  something or blocked — a clean pass is silent. */
  gate?: { status: string; fixed: number } | null;
  triggeredBy: string;
  /** Phase B: who the process waits on when not the owner. Absent in Phase A. */
  waitingOn?: { name: string; role?: string } | null;
}

export interface RunLike {
  id: string;
  workflow_id: string;
  status: string;
  triggered_by: string | null;
  step_outputs: StepOutputLike[] | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/** THE PARKED GATE (Phase B — viewer-aware): a parked run's CURRENT step decides whose wait
 *  this is. LAW ORDER: a blocked-verify tail is ALWAYS the owner's (the guardrail hold outranks
 *  — the NEXT step must never misattribute the wait); then an approval step → the owner's;
 *  a handoff step → the assignee's. Pure, table-testable. */
export function parkedGateOf(
  run: Pick<RunLike, 'step_outputs'>,
  steps: WorkflowStep[] | null | undefined,
  /** B2 REASSIGN: a per-run override (item_plans kind 'handoff_override') outranks the step's
   *  static assignee — a per-run decision never mutates the authored workflow. */
  override?: { assigneeUserId: string; assigneeName?: string } | null,
): { kind: 'guardrail' | 'approval' | 'handoff'; assigneeUserId?: string; assigneeName?: string } {
  const outs = run.step_outputs ?? [];
  const last = outs[outs.length - 1];
  const v = (last?.verdict ?? null) as GateVerdict | null;
  if (v?.status === 'blocked') return { kind: 'guardrail' };
  const current = (steps ?? [])[outs.length];
  if (current?.type === 'handoff') {
    if (override?.assigneeUserId) {
      return { kind: 'handoff', assigneeUserId: override.assigneeUserId, assigneeName: override.assigneeName };
    }
    return { kind: 'handoff', assigneeUserId: current.assignee_user_id, assigneeName: current.assignee_name };
  }
  return { kind: 'approval' };
}

/** The ONE state mapper — pure, table-testable. */
export function processStateOf(run: Pick<RunLike, 'status' | 'error'>): { state: ProcessState; reason?: string } {
  switch (run.status) {
    case 'queued':
    case 'running':
      return { state: 'running' };
    case 'awaiting_approval':
      return { state: 'needs_you' };
    case 'succeeded':
      return { state: 'delivered' };
    case 'failed':
      // A failure is the owner's to act on — it BUCKETS under Needs-my-input, reason spoken.
      return { state: 'needs_you', reason: (run.error ?? 'the run failed').slice(0, 140) };
    case 'rejected':
      return { state: 'held_back' };
    case 'cancelled':
      return { state: 'held_back', reason: 'cancelled' };
    default:
      return { state: 'running' };
  }
}

/** The gate's delta chip from a run's step outputs (silent on a clean pass — existing rule). */
export function gateDeltaOf(stepOutputs: StepOutputLike[] | null): { status: string; fixed: number } | null {
  let v: GateVerdict | undefined;
  for (const o of stepOutputs ?? []) if (o?.verdict?.status) v = o.verdict;
  if (!v || v.status === 'passed') return null;
  return { status: v.status, fixed: v.findings?.length ?? 0 };
}

/** Bucket order for every surface (attention first). Empty buckets DON'T render (calm floor). */
export const PROCESS_BUCKETS: Array<{ state: ProcessState; label: string }> = [
  { state: 'needs_you', label: 'Needs my input' },
  { state: 'running', label: 'Running' },
  { state: 'waiting_on_others', label: 'Waiting on others' },
  { state: 'delivered', label: 'Delivered' },
];

/** Assemble served ProcessRows for a set of runs — the ledger route's helper. Batched lookups:
 *  reaction fires (subject from the triggering event) and thread artifacts (deliverable title).
 *  Failure of either lookup degrades to the workflow-name subject, never breaks the serve. */
export async function deriveProcessRows(
  admin: SupabaseClient,
  userId: string,
  runs: RunLike[],
  wfById: Map<string, { name: string; steps?: WorkflowStep[] | null }>,
  threadArtifactTitle?: Map<string, string>,
  /** Whose eyes (Phase B): a parked handoff reads needs_you for its assignee,
   *  waiting_on_others for everyone else. Defaults to the owner. */
  viewerId?: string,
): Promise<ProcessRow[]> {
  const viewer = viewerId ?? userId;
  // Reaction-fired runs carry their triggering event (the exactly-once fire record is keyed by run).
  const eventRunIds = runs.filter((r) => r.triggered_by === 'event').map((r) => r.id);
  const subjectByRun = new Map<string, string>();
  if (eventRunIds.length) {
    try {
      const { data: fires } = await admin.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', 'reaction_fire')
        .in('tasks->>runId', eventRunIds).limit(eventRunIds.length);
      for (const f of (fires ?? []) as Array<{ tasks: { runId?: string; context?: string } }>) {
        const rid = f.tasks?.runId;
        // The context block's second line is the event's title (triggerBlock's shape).
        const title = String(f.tasks?.context ?? '').split('\n')[1]?.trim();
        if (rid && title) subjectByRun.set(rid, title.slice(0, 120));
      }
    } catch { /* subject ladder degrades to the workflow name */ }
  }

  return runs.map((r) => {
    let { state, reason } = processStateOf(r);
    const wf = wfById.get(r.workflow_id);
    const wfName = wf?.name ?? 'Workflow';
    const outs = r.step_outputs ?? [];
    // Phase B — viewer-aware park attribution (the handoff gate belongs to its assignee).
    let waitingOn: { name: string } | null = null;
    if (r.status === 'awaiting_approval') {
      const gate = parkedGateOf(r, wf?.steps);
      if (gate.kind === 'handoff' && gate.assigneeUserId && gate.assigneeUserId !== viewer) {
        state = 'waiting_on_others';
        reason = undefined;
        waitingOn = { name: gate.assigneeName ?? 'a teammate' };
      }
    }
    const subject =
      subjectByRun.get(r.id)
      ?? (r.triggered_by === 'manual' ? threadArtifactTitle?.get(r.id) : undefined)
      ?? wfName;
    return {
      runId: r.id,
      workflowId: r.workflow_id,
      workflowName: wfName,
      subject,
      state,
      ...(reason ? { reason } : {}),
      startedAt: r.started_at ?? r.created_at,
      ...(r.completed_at ? { endedAt: r.completed_at } : {}),
      stepsDone: outs.length,
      stepsTotal: 0, // filled by the route, which holds the workflow's steps
      gate: gateDeltaOf(outs),
      triggeredBy: r.triggered_by ?? 'manual',
      ...(waitingOn ? { waitingOn } : {}),
    };
  });
}
