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
  /** THE SUBJECT LADDER (order = specificity, most specific first):
   *    1. the trigger event's own title (what arrived)
   *    2. the deliverable/artifact title (manual runs)
   *    3. THE CASE the run resolved (relay canvas W4) — the opening this run served
   *    4. the workflow name (a scheduled repeat deliberately keeps this — calm). */
  subject: string;
  /** THE SUBJECT WEARS THE CASE (relay canvas W4): the case this run resolved, when it did.
   *  Read from the durable `run_case` stamp the case step writes — never re-reasoned at read. */
  caseRef?: { entityId: string; name: string } | null;
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
  /** WHAT KIND OF GATE this parked run stands at — present only while parked. Every surface reads
   *  its word from GATE_WORDS below; nothing derives a gate word from a status again. */
  gateKind?: GateKind | null;
  /** The input station's own question, served so a surface can say what is being asked without
   *  re-reading the workflow's steps. Present only on an `input` park. */
  gateAsk?: string | null;
  /** Input gates only — the open supply ask's commitment id, served by the ledger route so the
   *  drawer's gate card can be a DOOR to the one answerable surface (never a prose pointer). */
  askId?: string;
}

export type GateKind = 'guardrail' | 'approval' | 'handoff' | 'subprocess' | 'input';

/** THE ONE GATE WORD TABLE. `station` = the gate's own title on a card; `waiting` = the same fact
 *  in a running sentence ("… · waiting for your approval"). Adding a gate kind = one row here; a
 *  surface that invents its own word is the drift class this table exists to kill. */
export const GATE_WORDS: Record<GateKind, { station: string; waiting: string }> = {
  approval:   { station: 'Your approval',        waiting: 'waiting for your approval' },
  guardrail:  { station: 'Your approval',        waiting: 'waiting for your approval' },
  input:      { station: 'Needs input from you', waiting: 'waiting for something from you' },
  handoff:    { station: 'Wait on a person',     waiting: 'waiting on a teammate' },
  subprocess: { station: 'Another process',      waiting: 'waiting on another process' },
};

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
): {
  kind: 'guardrail' | 'approval' | 'handoff' | 'subprocess' | 'input';
  assigneeUserId?: string; assigneeName?: string;
  /** Subprocess + input parks — the station's authored label (and, for ⧉, the child it handed the
   *  baton to). `ask` is the input station's own question. */
  stepId?: string; label?: string; childWorkflowId?: string; ask?: string;
} {
  const outs = run.step_outputs ?? [];
  const last = outs[outs.length - 1];
  const v = (last?.verdict ?? null) as GateVerdict | null;
  if (v?.status === 'blocked') return { kind: 'guardrail' };
  const current = (steps ?? [])[outs.length];
  // THE ⧉ STATION (relay canvas W3): a subprocess park holds no human — the wait belongs to a
  // MACHINE, so it is never anyone's needs_you. Sits beside the handoff branch, same precedence
  // (the blocked-verify tail still outranks both).
  if (current?.type === 'workflow') {
    return {
      kind: 'subprocess', stepId: current.id,
      label: current.label || 'Process', childWorkflowId: current.workflow_id,
    };
  }
  // THE INPUT STATION (relay canvas, THE WAVE): the wait is the OWNER'S, like an approval — but it
  // asks for MATERIAL, not a yes/no, so the kind is its own and every surface says a different word
  // (GATE_WORDS) and offers a different door (the resume route refuses a bare approve here).
  if (current?.type === 'input') {
    return {
      kind: 'input', stepId: current.id,
      label: current.label || 'Ask me for something',
      ask: String(current.ask ?? '').trim() || undefined,
    };
  }
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

  // THE CASE STAMP (relay canvas W4) — batched beside the fire read, for the same reason: it is a
  // durable fact written at resolve time (`item_plans` kind 'run_case', entity_id = the run id),
  // so BOTH readers of this derivation (the ledger and the run record) wear the case with no route
  // change. Failure degrades to a case-less row, never a broken serve.
  const caseByRun = new Map<string, { entityId: string; name: string }>();
  if (runs.length) {
    try {
      const { data: stamps } = await admin.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', 'run_case')
        .in('entity_id', runs.map((r) => r.id)).limit(runs.length);
      for (const s of (stamps ?? []) as Array<{ entity_id: string; tasks: { entityId?: string; name?: string } | null }>) {
        if (s.tasks?.entityId && s.tasks?.name) {
          caseByRun.set(String(s.entity_id), { entityId: s.tasks.entityId, name: String(s.tasks.name).slice(0, 120) });
        }
      }
    } catch { /* the ladder degrades one rung */ }
  }

  return runs.map((r) => {
    let { state, reason } = processStateOf(r);
    const wf = wfById.get(r.workflow_id);
    const wfName = wf?.name ?? 'Workflow';
    const outs = r.step_outputs ?? [];
    // Phase B — viewer-aware park attribution (the handoff gate belongs to its assignee).
    // `role` is the SURFACE DISCRIMINATOR: a machine wait must never be drawn in the people
    // grammar (a facepile of a process name is a lie). Only the ⧉ station sets it.
    let waitingOn: { name: string; role?: string } | null = null;
    let gateKind: GateKind | null = null;
    let gateAsk: string | null = null;
    if (r.status === 'awaiting_approval') {
      const gate = parkedGateOf(r, wf?.steps);
      gateKind = gate.kind;
      gateAsk = gate.kind === 'input' ? (gate.ask ?? null) : null;
      // A ⧉ STATION WAITS ON A MACHINE (relay canvas W3): no human holds this gate, so it reads
      // waiting_on_others for EVERY viewer — the owner included. Never needs_you.
      if (gate.kind === 'subprocess') {
        state = 'waiting_on_others';
        reason = undefined;
        waitingOn = { name: gate.label ?? 'another process', role: 'process' };
      } else if (gate.kind === 'handoff' && gate.assigneeUserId && gate.assigneeUserId !== viewer) {
        state = 'waiting_on_others';
        reason = undefined;
        waitingOn = { name: gate.assigneeName ?? 'a teammate' };
      }
    }
    const caseRef = caseByRun.get(r.id) ?? null;
    const subject =
      subjectByRun.get(r.id)
      ?? (r.triggered_by === 'manual' ? threadArtifactTitle?.get(r.id) : undefined)
      ?? caseRef?.name          // W4: the case outranks the workflow's static name, never the event
      ?? wfName;
    return {
      runId: r.id,
      workflowId: r.workflow_id,
      workflowName: wfName,
      subject,
      ...(caseRef ? { caseRef } : {}),
      state,
      ...(reason ? { reason } : {}),
      startedAt: r.started_at ?? r.created_at,
      ...(r.completed_at ? { endedAt: r.completed_at } : {}),
      stepsDone: outs.length,
      stepsTotal: 0, // filled by the route, which holds the workflow's steps
      gate: gateDeltaOf(outs),
      triggeredBy: r.triggered_by ?? 'manual',
      ...(waitingOn ? { waitingOn } : {}),
      ...(gateKind ? { gateKind } : {}),
      ...(gateAsk ? { gateAsk } : {}),
    };
  });
}
