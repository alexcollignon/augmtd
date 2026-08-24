// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GATED-WORK ROOM (processes arc; owner walk, Aug 20) — WHAT IS BEING GATED.
//
// A source='handoff' commitment is a DECISION on a parked run. Until now its room asked for that
// decision while showing nothing of the work itself, and its source strip claimed "no linked
// source" — because the source is a workflow RUN, which the commitment routes never read. This
// module is the ONE derivation of that missing half: the ask, who asked, and THE OBJECT (the
// parked run's last step output) that the decision is actually about.
//
// LAWS HELD HERE:
//   • ADDITIVE AND NEVER FATAL. Every read is best-effort; an unreadable run/workflow yields null
//     and the room falls back to today's render. A gate that cannot be described is never an error.
//   • NO AI, NO SECOND ENDPOINT. Everything is read off existing truth, and it is served on the
//     SAME payload the decision card already learns `source`/`sourceId` from
//     (GET /api/commitments/[id]) — the card never makes a second call to know what it is gating.
//   • NOTHING IS FABRICATED. A name we cannot read is null, never "Someone"; a run we cannot read
//     is a null block, never a guess. The preview is the run's own bytes, never a summary.
//   • THE ROOM MAY SPEAK HISTORY. A settled handoff (commitment resolved, or the run moved on)
//     still gets the whole block with `parked:false` — the work that was gated is still the story.
//
// AUTHORIZATION (the entitlement, stated once): the caller's OWN commitment row is the warrant.
// A source='handoff' commitment row belonging to the caller means the caller was handed this
// gate — exactly the fact `canReadRunRecord` grants its 'holder' role on (a current OR PAST gate
// holder may read the record of the run they were asked about). We therefore read the run and its
// workflow with the ADMIN client on the strength of that row alone: the caller already holds the
// entitlement, and re-deriving it through canReadRunRecord would only re-read the same commitment.
// The caller-scoped row must be read RLS-safe FIRST (the route does); this module is only ever
// handed a runId that came off such a row.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HandoffStep, WorkflowStep } from './types';
import { parkedGateOf, type RunLike } from './process-state';

/** How much of the gated object we serve. The surface scrolls it; beyond this it is marked
 *  truncated and cut at a whitespace boundary — never a mid-word lie. */
export const HANDOFF_PREVIEW_MAX = 20_000;

export interface HandoffContext {
  workflowId: string;
  workflowName: string;
  runId: string;
  /** The run's started/created time. null when neither is recorded — never "now". */
  runAt: string | null;
  /** The gate's ask — the handoff step's own words, else the commitment description's head. */
  ask: string;
  slaHours: number | null;
  /** The workflow owner's first name. null when the profile can't be read. */
  askedByFirst: string | null;
  /** The assignee IS the workflow owner (the demo's case: you gate your own run). */
  selfGate: boolean;
  /** The presenting coworker — attribution only, never authority. */
  workerName: string | null;
  /** The run is STILL awaiting this decision (open ask + a parked handoff gate). */
  parked: boolean;
  /** THE OBJECT: the parked run's last step output. null when the run produced nothing yet. */
  preview: { text: string; truncated: boolean } | null;
}

/** The ask a handoff commitment was created from — `askAssignee` writes `${ask} — ${subject}`.
 *  (Same rule as run-record's decision labels; kept local so neither module owns the other.) */
function askFromDescription(description: string | null | undefined): string {
  const d = String(description ?? '').trim();
  if (!d) return 'Review and approve';
  const cut = d.lastIndexOf(' — ');
  return (cut > 0 ? d.slice(0, cut) : d).trim() || 'Review and approve';
}

/** First name of a user, or null — a missing profile is never a placeholder name. */
async function firstNameOrNull(admin: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    const full = String((data as { full_name?: string } | null)?.full_name ?? '').trim();
    return full.split(/\s+/)[0] || null;
  } catch { return null; }
}

/** THE OBJECT, as text. String outputs ride verbatim; anything else is JSON — the run's own bytes,
 *  never a rewrite. Truncation cuts back to the last whitespace so no word is halved. */
export function previewFromOutput(output: unknown): { text: string; truncated: boolean } | null {
  if (output === null || output === undefined) return null;
  let raw: string;
  if (typeof output === 'string') raw = output;
  else { try { raw = JSON.stringify(output); } catch { return null; } }
  if (typeof raw !== 'string' || !raw.length) return null;
  if (raw.length <= HANDOFF_PREVIEW_MAX) return { text: raw, truncated: false };
  const head = raw.slice(0, HANDOFF_PREVIEW_MAX);
  const ws = head.search(/\s\S*$/); // index of the last whitespace run in the head
  const cut = ws > HANDOFF_PREVIEW_MAX * 0.9 ? head.slice(0, ws) : head;
  return { text: cut, truncated: true };
}

/** The handoff step this gate stands at: the run's CURRENT step when it is still parked, else the
 *  last handoff step the run already walked past (a settled gate still names itself). */
function handoffStepOf(
  steps: WorkflowStep[] | null | undefined, outputCount: number,
): HandoffStep | null {
  const list = steps ?? [];
  const current = list[outputCount];
  if (current && current.type === 'handoff') return current;
  for (let i = Math.min(outputCount, list.length) - 1; i >= 0; i--) {
    const s = list[i];
    if (s && s.type === 'handoff') return s;
  }
  return null;
}

/**
 * THE ONE DERIVATION of a handoff commitment's gated work. Returns null for every non-handoff
 * commitment and whenever the run or its workflow can't be read — the room then renders as before.
 *
 * @param admin       service-role client (see the AUTHORIZATION note at the top of this file)
 * @param commitment  the caller's OWN commitment row (already read RLS-safe by the route)
 */
export async function handoffContextFor(
  admin: SupabaseClient,
  commitment: {
    userId: string;
    source: string | null;
    sourceId: string | null;
    description: string | null;
    status: string | null;
  },
): Promise<HandoffContext | null> {
  try {
    if (commitment.source !== 'handoff' || !commitment.sourceId) return null;
    const runId = String(commitment.sourceId);

    const { data: run } = await admin.from('workflow_runs')
      .select('id, workflow_id, user_id, status, step_outputs, started_at, created_at')
      .eq('id', runId).maybeSingle();
    if (!run) return null;

    const { data: wf } = await admin.from('workflows')
      .select('id, user_id, name, agent_id, steps').eq('id', String(run.workflow_id)).maybeSingle();
    if (!wf) return null;

    const steps = (wf.steps ?? null) as WorkflowStep[] | null;
    const outs = (Array.isArray(run.step_outputs) ? run.step_outputs : []) as Array<{ output?: unknown }>;
    const step = handoffStepOf(steps, outs.length);

    // PARKED = the run is still awaiting THIS decision. Both halves must hold: the run's current
    // gate is a handoff, and the caller's ask is still open (a reassigned-away or decided gate
    // leaves the run parked for someone else — never for this room).
    const gate = run.status === 'awaiting_approval'
      ? parkedGateOf({ step_outputs: outs as RunLike['step_outputs'] }, steps)
      : null;
    const askOpen = ['open', 'pending', 'in_progress'].includes(String(commitment.status ?? 'open'));
    const parked = gate?.kind === 'handoff' && askOpen;

    // The presenting coworker — attribution only (the same agent that signs the ask email).
    let workerName: string | null = null;
    if (wf.agent_id) {
      try {
        const { data: a } = await admin.from('custom_agents').select('name').eq('id', String(wf.agent_id)).maybeSingle();
        workerName = (String((a as { name?: string } | null)?.name ?? '').trim() || null);
      } catch { /* attribution is an enhancement */ }
    }

    // WHO ASKED = the workflow's execution identity (wf.user_id) — the same person `askAssignee`
    // stamped on this commitment's counterparty, so the room and the deck row name one person.
    const ownerId = String(wf.user_id);
    const askedByFirst = await firstNameOrNull(admin, ownerId);

    return {
      workflowId: String(wf.id),
      workflowName: String(wf.name ?? '').trim() || 'A process',
      runId,
      runAt: (run.started_at as string | null) ?? (run.created_at as string | null) ?? null,
      ask: (step?.ask ?? '').trim() || askFromDescription(commitment.description),
      slaHours: typeof step?.sla_hours === 'number' ? step.sla_hours : null,
      askedByFirst,
      // The assignee IS the workflow owner: they hold both ends of this gate.
      selfGate: commitment.userId === ownerId || commitment.userId === String(run.user_id ?? ''),
      workerName,
      parked,
      preview: previewFromOutput(outs[outs.length - 1]?.output),
    };
  } catch {
    // A gate we cannot describe is never an error — the room falls back to today's render.
    return null;
  }
}
