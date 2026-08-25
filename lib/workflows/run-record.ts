// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RUN RECORD (mockup-fidelity wave, docs/processes-plan.md) — the read-only story of ONE run:
// who decided what, how long they were waited on, and what changed since the last time this
// workflow ran. ONE module, so the History chips, the drawer's Decisions tab and the
// vs.-previous tab can never disagree about the same run.
//
// LAWS HELD HERE:
//   • DETERMINISTIC, NO AI. Every line is read off existing truth (step outputs, commitment rows,
//     the activity ledger). v1 of "drift" is arithmetic, not judgment.
//   • NOTHING IS FABRICATED. A timestamp we cannot know is `null`, never "now"; a missing profile
//     is a `null` name, never "Someone"; a missing activity table is `false`, never a guess.
//   • THE PURE HALF IS TABLE-TESTABLE. `driftChipsOf` / `vsPrevious` take RunSummary shapes and
//     touch no database — the gates test the laws on fixtures. `summarizeRun` is the ONE place
//     that assembles a summary FROM the DB.
//   • THE COMMENT LIVES IN THE THREAD, NOT HERE. `Decision.comment` is always null in this module
//     (the surface joins the `run:<id>` room through the comments route — no second store).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StepOutput, WorkflowStep } from './types';
import type { RunLike } from './process-state';

// ── SHAPES ────────────────────────────────────────────────────────────────────────────────────

export interface Decision {
  kind: 'approval' | 'handoff';
  /** What was decided, in the run's own words (the gate's ask / 'Your approval'). */
  label: string;
  /** WHO decided. null when the deciding identity isn't recorded (an owner approval carries no
   *  decider row) or the profile can't be read — never a placeholder name. */
  deciderName: string | null;
  deciderRole?: string | null;
  /** When it was decided. null is honest: an approval gate stores no timestamp of its own. */
  decidedAt: string | null;
  /** true approved · false held back · null = not a yes/no outcome (still open, reassigned away,
   *  or a test-mode auto-pass, which is not a human decision at all). */
  approved: boolean | null;
  /** How long the person was waited on (asked → resolved). null while still open. */
  waitedMs: number | null;
  overTarget: boolean;
  slaHours?: number | null;
  /** Always null here — the thread is the comment store (see the comments route). */
  comment?: string | null;
  /** Additive detail for surfaces that want the exact outcome word. */
  outcome?: 'approved' | 'held_back' | 'reassigned' | 'pending' | 'auto_passed';
}

/** The PURE shape both derivations read — no database, table-testable on fixtures. */
export interface RunSummary {
  runId: string;
  workflowId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  /** Labels of the steps that actually EXECUTED (one per step output, in order). */
  executedStepLabels: string[];
  /** The executed subset that were REVIEW steps (verify · approval · handoff) — the drift rule's
   *  input: a review the previous run performed and this one lacks is config/behaviour drift. */
  reviewStepLabels: string[];
  /** Total gate findings across the run's verdicts. */
  gateFindings: number;
  decisions: Decision[];
}

export interface DriftOptions {
  /** Computed by the route from `activity_events` (type workflow_owner_changed) between the two
   *  runs' windows. Absent table/data → false: an unknown is never a chip. */
  ownerChangedBetween?: boolean;
}

export interface VsPrevious {
  durationDeltaMs: number | null;
  stepsAdded: string[];
  stepsRemoved: string[];
  gateFindingsDelta: number;
  decisionsDelta: number;
}

// ── DECISIONS (DB) ────────────────────────────────────────────────────────────────────────────

type CommitmentRow = {
  id: string;
  user_id: string;
  description: string | null;
  status: string | null;
  resolved_reason: string | null;
  resolved_at: string | null;
  created_at: string;
};

/** The approval marker the run loop writes (`[Approved by the user — …]`). */
const APPROVED_MARK = /^\s*\[approved\b/i;
const TEST_MARK = /auto-passed in test mode/i;

const outputsOf = (run: Pick<RunLike, 'step_outputs'>): StepOutput[] =>
  (Array.isArray(run.step_outputs) ? run.step_outputs : []) as unknown as StepOutput[];

const isReviewType = (t: string | undefined): boolean =>
  t === 'verify' || t === 'approval' || t === 'handoff';

/** The ask a handoff commitment was created from — `askAssignee` writes `${ask} — ${subject}`. */
function askFromDescription(description: string | null): string {
  const d = String(description ?? '').trim();
  if (!d) return 'Handoff';
  const cut = d.lastIndexOf(' — ');
  return (cut > 0 ? d.slice(0, cut) : d).trim() || 'Handoff';
}

/** Names + job roles for a set of users. A user we cannot read is simply absent (→ null name). */
async function peopleOf(
  admin: SupabaseClient, userIds: string[],
): Promise<Map<string, { name: string | null; role: string | null }>> {
  const out = new Map<string, { name: string | null; role: string | null }>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', ids);
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
      const full = String(p.full_name ?? '').trim();
      out.set(p.id, { name: full || null, role: null });
    }
  } catch { /* a missing profile is a null name, never a placeholder */ }
  try {
    const { data } = await admin.from('context_profiles')
      .select('user_id, profile_data').eq('profile_type', 'identity').in('user_id', ids);
    for (const c of (data ?? []) as Array<{ user_id: string; profile_data: { role?: string } | null }>) {
      const role = String(c.profile_data?.role ?? '').trim() || null;
      const prev = out.get(c.user_id) ?? { name: null, role: null };
      out.set(c.user_id, { ...prev, role });
    }
  } catch { /* a role we can't read is null */ }
  return out;
}

/** The batched half of `decisionsOf`, for a whole page of runs. */
export type DecisionInputs = {
  commitmentsByRun: Map<string, CommitmentRow[]>;
  people: Map<string, { name: string | null; role: string | null }>;
};

/** ONE READ FOR A PAGE OF RUNS (latency, Aug 25 — the deep-dive's cold paint).
 *
 *  `decisionsOf` reads a run's handoff commitments and then the deciders' names; done per run over
 *  a 30-run history that is ~90 round-trips for a single paint. The rows are keyed by
 *  `source_id = run.id`, so the whole page is ONE `.in()` — and every decider on the page is ONE
 *  more. Semantics are byte-identical: same columns, same `created_at` ordering, same 50-row cap
 *  per run, and a failed read degrades to an empty map exactly as the per-run try/catch did. */
export async function prefetchDecisionInputs(
  admin: SupabaseClient,
  runIds: string[],
): Promise<DecisionInputs> {
  const commitmentsByRun = new Map<string, CommitmentRow[]>();
  const ids = [...new Set(runIds.map(String).filter(Boolean))];
  if (!ids.length) return { commitmentsByRun, people: new Map() };
  let rows: Array<CommitmentRow & { source_id: string }> = [];
  try {
    const { data } = await admin.from('commitments')
      .select('id, user_id, description, status, resolved_reason, resolved_at, created_at, source_id')
      .eq('source', 'handoff').in('source_id', ids)
      .order('created_at', { ascending: true });
    rows = (data ?? []) as Array<CommitmentRow & { source_id: string }>;
  } catch { /* an unreadable ledger is a run with no handoff decisions, never a wrong one */ }
  for (const r of rows) {
    const key = String(r.source_id);
    const arr = commitmentsByRun.get(key) ?? [];
    if (arr.length < 50) arr.push(r); // the per-run cap the single-run read applies
    commitmentsByRun.set(key, arr);
  }
  const people = await peopleOf(admin, rows.map((r) => String(r.user_id)));
  return { commitmentsByRun, people };
}

/** EVERY HUMAN GATE OF THIS RUN, oldest first.
 *
 *  APPROVAL steps: the gate's own step output is the record — `[Approved by the user…]` means
 *  yes, a test-mode auto-pass is not a human decision (approved null), and a rejected run's
 *  un-executed approval gate is the rejection itself (decided at the run's end — the only
 *  timestamp the run actually carries). No approval gate stores WHO or WHEN otherwise, so both
 *  stay null rather than being inferred.
 *
 *  HANDOFF steps: their commitment rows (source='handoff', source_id=runId) INCLUDING resolved
 *  ones and every reassign generation, ordered by created_at — the ask, the person, the wait.
 *  A reassign closes a row without a yes/no, so it reads `approved: null` / outcome 'reassigned'. */
export async function decisionsOf(
  admin: SupabaseClient,
  args: {
    run: Pick<RunLike, 'id' | 'status' | 'step_outputs' | 'completed_at'>;
    workflow: { steps?: WorkflowStep[] | null };
    /** THE BATCHED READ (latency): the handoff commitments and their people, already fetched for a
     *  WHOLE PAGE of runs by `prefetchDecisionInputs`. Per-run this module issued 1 commitments
     *  read + 2 people reads, so a 30-run deep-dive fired ~90 queries for one paint. When present
     *  the rows are read from here instead — same rows, same order, same decisions; absent, the
     *  single-run path below is untouched (the run-record drawer still calls it that way). */
    prefetch?: DecisionInputs;
  },
): Promise<Decision[]> {
  const { run, workflow } = args;
  const steps = (workflow.steps ?? []) as WorkflowStep[];
  const outs = outputsOf(run);
  const decisions: Decision[] = [];

  // ── APPROVAL GATES ──
  // A rejected run stopped exactly where its outputs end — the gate AT that index is the one that
  // was held back. Any later gate never happened, and is never spoken for.
  const parkedIndex = run.status === 'rejected' ? outs.length : -1;
  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    if ((step as { type?: string }).type !== 'approval') continue;
    const label = String((step as { label?: string }).label ?? '').trim() || 'Your approval';
    const out = outs.find((o) => String(o?.step_id ?? '') === step.id);
    if (out) {
      const text = typeof out.output === 'string' ? out.output : '';
      const testPass = TEST_MARK.test(text);
      decisions.push({
        kind: 'approval',
        label,
        deciderName: null,
        deciderRole: null,
        decidedAt: null,
        approved: testPass ? null : APPROVED_MARK.test(text) ? true : null,
        waitedMs: null,
        overTarget: false,
        slaHours: null,
        comment: null,
        outcome: testPass ? 'auto_passed' : APPROVED_MARK.test(text) ? 'approved' : 'pending',
      });
      continue;
    }
    if (idx === parkedIndex) {
      // The run ended `rejected` and stopped AT this gate: the rejection IS this gate's decision.
      decisions.push({
        kind: 'approval',
        label,
        deciderName: null,
        deciderRole: null,
        decidedAt: run.completed_at ?? null,
        approved: false,
        waitedMs: null,
        overTarget: false,
        slaHours: null,
        comment: null,
        outcome: 'held_back',
      });
    }
  }

  // ── HANDOFF GATES ──
  const handoffSteps = steps.filter((s) => (s as { type?: string }).type === 'handoff') as Array<
    WorkflowStep & { label?: string; ask?: string; sla_hours?: number }
  >;
  let rows: CommitmentRow[] = [];
  if (args.prefetch) {
    rows = args.prefetch.commitmentsByRun.get(String(run.id)) ?? [];
  } else {
    try {
      const { data } = await admin.from('commitments')
        .select('id, user_id, description, status, resolved_reason, resolved_at, created_at')
        .eq('source', 'handoff').eq('source_id', run.id)
        .order('created_at', { ascending: true }).limit(50);
      rows = (data ?? []) as CommitmentRow[];
    } catch { rows = []; }
  }

  if (rows.length) {
    const people = args.prefetch?.people
      ?? await peopleOf(admin, rows.map((r) => String(r.user_id)));
    // A run with exactly ONE handoff step can name its gate and its SLA with certainty. With
    // several, the commitment rows carry no step id — so the ask is read from the row's own
    // description and the SLA stays null rather than being guessed from the wrong step.
    const only = handoffSteps.length === 1 ? handoffSteps[0] : null;
    for (const r of rows) {
      const created = Date.parse(String(r.created_at ?? ''));
      const resolved = r.resolved_at ? Date.parse(String(r.resolved_at)) : NaN;
      const waitedMs = Number.isFinite(created) && Number.isFinite(resolved)
        ? Math.max(0, resolved - created) : null;
      const slaHours = only?.sla_hours ?? null;
      const reassigned = String(r.resolved_reason ?? '').toLowerCase() === 'reassigned';
      const open = String(r.status ?? '') === 'open';
      const approved = open || reassigned ? null : String(r.status) === 'completed';
      const who = people.get(String(r.user_id)) ?? { name: null, role: null };
      decisions.push({
        kind: 'handoff',
        label: (only?.ask ?? '').trim() || askFromDescription(r.description),
        deciderName: who.name,
        deciderRole: who.role,
        decidedAt: r.resolved_at ?? null,
        approved,
        waitedMs,
        overTarget: slaHours != null && waitedMs != null && waitedMs > slaHours * 3600_000,
        slaHours,
        comment: null,
        outcome: open ? 'pending' : reassigned ? 'reassigned' : approved ? 'approved' : 'held_back',
      });
    }
  }

  return decisions;
}

// ── THE SUMMARY (DB assembly) ─────────────────────────────────────────────────────────────────

/** Assemble the pure RunSummary the drift rules read. The ONLY DB half of this module's laws. */
export async function summarizeRun(
  admin: SupabaseClient,
  run: Pick<RunLike, 'id' | 'workflow_id' | 'status' | 'step_outputs' | 'started_at' | 'completed_at' | 'created_at'>,
  workflow: { steps?: WorkflowStep[] | null },
  /** Batched decision inputs for a page of runs — see `prefetchDecisionInputs`. */
  prefetch?: DecisionInputs,
): Promise<RunSummary> {
  const outs = outputsOf(run);
  const startedAt = run.started_at ?? run.created_at;
  const started = Date.parse(String(startedAt ?? ''));
  const ended = run.completed_at ? Date.parse(String(run.completed_at)) : NaN;
  const executedStepLabels = outs.map((o, i) => String(o?.label ?? '').trim() || `Step ${i + 1}`);
  // SAME fallback rendering as executedStepLabels (indexed on the FULL list) — the drift rule
  // set-checks review labels against executed labels, so a diverging fallback ("Review 1" vs
  // "Step 3") would chip "Review step skipped" chronically on unlabeled steps.
  const reviewStepLabels = outs
    .map((o, i) => (isReviewType(String(o?.step_type ?? '')) ? executedStepLabels[i] : null))
    .filter((l): l is string => l != null);
  let gateFindings = 0;
  for (const o of outs) gateFindings += Array.isArray(o?.verdict?.findings) ? o.verdict!.findings.length : 0;

  return {
    runId: String(run.id),
    workflowId: String(run.workflow_id),
    status: String(run.status),
    startedAt: String(startedAt ?? ''),
    endedAt: run.completed_at ?? null,
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null,
    executedStepLabels,
    reviewStepLabels,
    gateFindings,
    decisions: await decisionsOf(admin, { run, workflow, prefetch }),
  };
}

// ── THE DRIFT CHIPS (PURE) ────────────────────────────────────────────────────────────────────

export const DRIFT_REJECTED = 'Rejected';
export const DRIFT_OVER_SLA = 'Handoff over SLA';
export const DRIFT_REVIEW_SKIPPED = 'Review step skipped';
export const DRIFT_OWNER_CHANGED = 'Owner changed';

/** What is DIFFERENT about this run — deterministic, order-stable, no AI, no database.
 *
 *   • `Rejected`            — the run's own status.
 *   • `Handoff over SLA`    — any decision waited longer than its stated sla_hours.
 *   • `Review step skipped` — the previous completed run EXECUTED a review step (verify /
 *                             approval / handoff) whose label this run's executed steps lack.
 *                             No previous run → no claim.
 *   • `Owner changed`       — the caller's ledger read, passed in. Unknown is never a chip. */
export function driftChipsOf(
  current: RunSummary,
  previous?: RunSummary | null,
  opts?: DriftOptions,
): string[] {
  const chips: string[] = [];
  if (current.status === 'rejected') chips.push(DRIFT_REJECTED);
  if (current.decisions.some((d) => d.overTarget)) chips.push(DRIFT_OVER_SLA);
  if (previous) {
    const here = new Set(current.executedStepLabels);
    if (previous.reviewStepLabels.some((l) => !here.has(l))) chips.push(DRIFT_REVIEW_SKIPPED);
  }
  if (opts?.ownerChangedBetween === true) chips.push(DRIFT_OWNER_CHANGED);
  return chips;
}

/** THIS RUN vs THE SAME WORKFLOW'S PREVIOUS COMPLETED RUN — pure arithmetic over two summaries.
 *  No previous run → null (nothing to compare is not a delta of zero). */
export function vsPrevious(current: RunSummary, previous?: RunSummary | null): VsPrevious | null {
  if (!previous) return null;
  const prevSet = new Set(previous.executedStepLabels);
  const curSet = new Set(current.executedStepLabels);
  return {
    durationDeltaMs: current.durationMs != null && previous.durationMs != null
      ? current.durationMs - previous.durationMs : null,
    stepsAdded: current.executedStepLabels.filter((l) => !prevSet.has(l)),
    stepsRemoved: previous.executedStepLabels.filter((l) => !curSet.has(l)),
    gateFindingsDelta: current.gateFindings - previous.gateFindings,
    decisionsDelta: current.decisions.length - previous.decisions.length,
  };
}

// ── THE ONE VISIBILITY READ (record + comments) ───────────────────────────────────────────────

export interface RunAccess {
  ok: boolean;
  role: 'owner' | 'holder' | null;
  run?: RunLike & { user_id: string };
  workflow?: { id: string; user_id: string; name: string; agent_id?: string | null; steps?: WorkflowStep[] | null };
  /** The workflow CREATOR — the execution identity that owns the run's bookkeeping rows AND the
   *  `run:<id>` room the comments live in (no second room, no second owner). */
  creatorUserId?: string;
}

/** WHO MAY READ THE RECORD OF THIS RUN — the same predicate the comments route authorizes with,
 *  a superset of `canResumeRun` in exactly one direction: a PAST gate holder keeps their history
 *  (they decided; the record of that decision is theirs to see), while resuming stays the current
 *  holder's alone. Everyone else gets nothing — a refusal and a missing run look identical. */
export async function canReadRunRecord(
  admin: SupabaseClient, runId: string, callerId: string,
): Promise<RunAccess> {
  try {
    const { data: run } = await admin.from('workflow_runs')
      .select('id, workflow_id, user_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
      .eq('id', runId).maybeSingle();
    if (!run) return { ok: false, role: null };
    const { data: wf } = await admin.from('workflows')
      .select('id, user_id, name, agent_id, steps').eq('id', run.workflow_id).maybeSingle();
    if (!wf) return { ok: false, role: null };

    const workflow = wf as RunAccess['workflow'];
    const runRow = run as unknown as RunLike & { user_id: string };
    const creatorUserId = workflow!.user_id;

    if (creatorUserId === callerId || runRow.user_id === callerId) {
      return { ok: true, role: 'owner', run: runRow, workflow, creatorUserId };
    }
    try {
      const { ownerOf } = await import('./owner');
      const owner = await ownerOf(admin, workflow!.id, creatorUserId);
      if (owner.userId === callerId) {
        return { ok: true, role: 'owner', run: runRow, workflow, creatorUserId };
      }
    } catch { /* the creator check already stands */ }

    // CURRENT *OR PAST* GATE HOLDER: any status — a settled ask is still a held gate.
    const { data: held } = await admin.from('commitments').select('id')
      .eq('user_id', callerId).eq('source', 'handoff').eq('source_id', runId)
      .limit(1).maybeSingle();
    if (held?.id) return { ok: true, role: 'holder', run: runRow, workflow, creatorUserId };

    return { ok: false, role: null };
  } catch { return { ok: false, role: null }; }
}
