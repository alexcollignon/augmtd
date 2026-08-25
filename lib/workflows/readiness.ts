// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READINESS WAVE — a workflow that cannot run SAYS SO BEFORE RUNNING.
//
// The pilot incident: a DRAFT reaction workflow was run with no triggering event. Six steps
// politely narrated their own emptiness, the run SUCCEEDED, and its "deliverable" was a failure
// report. THE LAW: unreadiness is spoken at the door — on the ledger row before anyone clicks Run,
// at the dispatcher before a doomed run row exists, and inside runWorkflow as a refusal whose
// spoken reason lands in `error` (an ordinary `failed` run — no new status, no new UI state).
//
// THIS IS THE ONE DERIVATION. Pure, synchronous, table-testable: same answer on the ledger, in the
// dispatcher, and at the door — by construction, not by three agreeing copies.
//
// ── THE RULE TABLE (first failing rule speaks; order IS severity) ───────────────────────────────
//   1. no steps                       → "No steps yet — build it in Studio."
//   2. status 'draft'                 → "Still a draft — finish it in Studio."
//   3. handoff without an assignee    → "The 'Wait on a person' step needs a person."
//   4. a step whose tool is feature-gated OFF for this workspace
//                                     → "The <label> step needs <Feature> enabled."
//   5. an EVENT DOOR that cannot fire → a content door with NEITHER a judged `when` NOR a
//      deterministic filter (W5): "The trigger needs a condition or a filter to react to." ·
//      a 'workflow' door with no workflow bound · a door whose SOURCE feature is off
//      (the doors are iterated through normalizeTriggers — legacy single reaction trigger folds in)
//   6. a `workflow` (⧉ subprocess) step with no workflow bound
//                                     → "The '<label>' process step needs a workflow."
//   7. a `workflow` step naming THIS workflow
//                                     → "A workflow can't include itself as a step."
//   8. a `case` step with NEITHER shape of case key (no instruction AND no stated case name)
//                                     → "The 'file it under its record' step needs to know what identifies
//                                        a case."
//   9. a SCOPED workflow whose every event door reacts to a source that cannot carry an entity
//                                     → "Scoped to “X” — no file event can arrive inside that project."
// Adding a rule = ONE entry in RULES below. Nothing else moves.
//
// ⚠️ RULE 9 IS VISIBILITY, NEVER A NEW REFUSAL (Aug 25). The scope is a SERVED fact, so only the
// surface that already holds it passes it (the ledger row). The dispatcher and the run door pass no
// scope, the rule abstains there by construction, and no run that would have happened is refused.
// The fail-closed scope semantics in runDoors are untouched — this rule only makes their
// consequence SAYABLE, where the workflow's own row can be fixed.
//
// PAUSED IS NOT UNREADINESS — a paused (or auto-paused) workflow is ready, just asleep.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { TOOL_FEATURE } from '@/lib/workspace/tool-capabilities';
import type { WorkspaceFeatures, FeatureKey } from '@/lib/workspace/types';
import { normalizeTriggers, triggerSource } from '@/lib/workflows/trigger-sources';

export type Readiness = { ready: true } | { ready: false; reason: string };

/** The reason a human reads. Kept short on purpose — it sits on a ledger row. */
export const READINESS_REASON_MAX = 90;

/** Feature keys in the words the product uses (platform-admin labels), not the column names. */
const FEATURE_LABEL: Record<FeatureKey, string> = {
  email: 'Email',
  meetings: 'Meetings',
  drive: 'Knowledge',
  agents: 'Coworkers',
  studio: 'Workflows',
  home: 'Home',
};

/** The shape readiness needs — every caller already holds these three columns. */
export interface ReadinessInput {
  /** The workflow's own id — only rule 7 (self-reference) reads it; absent = that rule abstains. */
  id?: string | null;
  status?: string | null;
  trigger?: { type?: string; when?: string; label?: string } | null;
  /** The event doors (relay canvas W1, additive jsonb). Read through normalizeTriggers. */
  triggers?: unknown;
  /** Any step array shape — WorkflowStep[] or raw jsonb rows. Read structurally, never trusted. */
  steps?: readonly unknown[] | null;
  /** THE PROJECT SCOPE (item_plans kind 'workflow_scope'), when the caller already holds it.
   *  Absent = rule 9 abstains — a caller that does not read the scope never invents unreadiness. */
  scope?: { entityName?: string | null } | null;
}

function asRec(s: unknown): Record<string, unknown> {
  return (s && typeof s === 'object') ? (s as Record<string, unknown>) : {};
}

function typeOf(step: Record<string, unknown> | null | undefined): string {
  return typeof step?.type === 'string' ? step.type : '';
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** A step's human name, for a sentence a person reads. Never a raw id. */
function stepLabel(step: Record<string, unknown>): string {
  const label = typeof step.label === 'string' ? step.label.trim() : '';
  if (label) return label;
  const tool = typeof step.tool === 'string' ? step.tool.trim() : '';
  if (tool) return tool.replace(/_/g, ' ');
  return 'tool';
}

type Rule = (wf: ReadinessInput, features: WorkspaceFeatures | null) => string | null;

const RULES: Rule[] = [
  // 1 — nothing to run.
  (wf) => ((wf.steps ?? []).length ? null : 'No steps yet — build it in Studio.'),

  // 2 — never finished. (paused/auto-paused is NOT unreadiness — asleep is ready.)
  (wf) => (wf.status === 'draft' ? 'Still a draft — finish it in Studio.' : null),

  // 3 — a human gate with nobody behind it: the run would park on no one.
  (wf) => {
    const orphan = (wf.steps ?? []).map(asRec).some(
      (s) => typeOf(s) === 'handoff' && !String((s.assignee_user_id as string | undefined) ?? '').trim(),
    );
    return orphan ? "The 'Wait on a person' step needs a person." : null;
  },

  // 4 — a step whose tool this workspace has switched off. TOOL_FEATURE is the one map.
  (wf, features) => {
    if (!features) return null;
    for (const raw of wf.steps ?? []) {
      const s = asRec(raw);
      if (typeOf(s) !== 'tool') continue;
      const tool = typeof s.tool === 'string' ? s.tool : '';
      const req = tool ? TOOL_FEATURE[tool] : null;
      if (req == null) continue;
      if (features[req] !== false) continue;
      const feature = FEATURE_LABEL[req] ?? req;
      // Budget the label so the whole sentence stays inside READINESS_REASON_MAX.
      const fixed = `The  step needs ${feature} enabled.`.length;
      return `The ${clip(stepLabel(s), Math.max(8, READINESS_REASON_MAX - fixed))} step needs ${feature} enabled.`;
    }
    return null;
  },

  // 5 — THE DOORS (relay canvas W1): every event door must be able to fire honestly. Read through
  // normalizeTriggers, so a legacy single reaction trigger and an authored `triggers[]` are the
  // same thing here. A judged door with no condition can never be judged; a 'when another workflow
  // delivers' door with no workflow is bound to nothing; a door whose source feature is off cannot
  // reach its events. First offending door speaks (order = authoring order).
  (wf, features) => {
    const { doors } = normalizeTriggers(wf);
    for (const d of doors) {
      const def = triggerSource(d.source);
      if (d.source === 'workflow') {
        if (!String(d.workflow_id ?? '').trim()) return "The 'when another workflow delivers' door needs a workflow.";
        continue;
      }
      // W5 — FIREABLE = a judged condition OR at least one deterministic filter. A door with
      // filters and no `when` is fully deterministic and perfectly able to fire; only a door with
      // NEITHER has nothing to react to.
      const judged = String(d.when ?? '').trim().length > 3;
      const filtered = (d.filters?.length ?? 0) > 0;
      if (!judged && !filtered) return 'The trigger needs a condition or a filter to react to.';
      const req = def?.feature ?? null;
      if (features && req && features[req] === false) {
        const feature = FEATURE_LABEL[req] ?? req;
        const fixed = `The  door needs ${feature} enabled.`.length;
        return `The ${clip(def?.label ?? d.source, Math.max(8, READINESS_REASON_MAX - fixed))} door needs ${feature} enabled.`;
      }
    }
    return null;
  },

  // 6 — THE ⧉ STATION WITH NOTHING BEHIND IT (relay canvas W3, law 5): a process step bound to no
  // workflow can never hand the baton anywhere. Pure: existence/ownership/status/depth are facts
  // only the database holds, so those live in the door check at fire time (lib/workflows/subprocess).
  (wf) => {
    for (const raw of wf.steps ?? []) {
      const s = asRec(raw);
      if (typeOf(s) !== 'workflow') continue;
      if (String((s.workflow_id as string | undefined) ?? '').trim()) continue;
      const fixed = `The '' process step needs a workflow.`.length;
      return `The '${clip(stepLabel(s), Math.max(8, READINESS_REASON_MAX - fixed))}' process step needs a workflow.`;
    }
    return null;
  },

  // 7 — SELF-REFERENCE: a workflow that includes ITSELF would park on its own park, forever. The
  // one circularity a pure rule can see (deeper cycles are impossible by the depth cap: the door
  // check refuses a child that itself contains a process step).
  (wf) => {
    const self = String(wf.id ?? '').trim();
    if (!self) return null;
    const loops = (wf.steps ?? []).map(asRec).some(
      (s) => typeOf(s) === 'workflow' && String((s.workflow_id as string | undefined) ?? '').trim() === self,
    );
    return loops ? "A workflow can't include itself as a step." : null;
  },

  // 8 — THE CASE STATION WITH NOTHING TO RECOGNIZE (relay canvas W4): a case step whose
  // instruction is blank cannot tell one case from another, so every run would either found a
  // duplicate or file nothing. The sentence names the missing knowledge, not the field.
  // EITHER SHAPE SATISFIES IT (Aug 25): the identity QUESTION each event answers about itself
  // (`case_instruction`), or the case the author STATED once for every run (`case_name`). Both are
  // a case key; only having neither leaves the station unable to tell one case from another.
  (wf) => {
    const blank = (wf.steps ?? []).map(asRec).some(
      (s) => typeOf(s) === 'case'
        && !String((s.case_instruction as string | undefined) ?? '').trim()
        && !String((s.case_name as string | undefined) ?? '').trim(),
    );
    return blank ? "The 'file it under its record' step needs to know what identifies a case." : null;
  },

  // 9 — THE SCOPE THAT SILENCES EVERY DOOR (Aug 25, found live). A workflow scoped to a project
  // only ever sees THAT project's events (runDoors' fail-closed pre-filter). Where every door it
  // holds reacts to a source whose events cannot carry an entity at all, nothing can ever match —
  // the workflow looks armed and is deaf. Said, so the row can be fixed (un-scope it, or react to
  // a source that carries its project). ONE door that CAN carry the scope makes the workflow work,
  // so partial deadness is not unreadiness — it is not a fact about whether this workflow runs.
  (wf) => {
    const project = String(wf.scope?.entityName ?? '').trim();
    if (!project) return null;
    const { doors } = normalizeTriggers(wf);
    if (!doors.length) return null;
    if (doors.some((d) => triggerSource(d.source)?.carriesEntity !== false)) return null;
    const sources = [...new Set(doors.map((d) => d.source))].join('/');
    const fixed = `Scoped to “” — no ${sources} event can arrive inside that project.`.length;
    return `Scoped to “${clip(project, Math.max(8, READINESS_REASON_MAX - fixed))}” — `
      + `no ${sources} event can arrive inside that project.`;
  },
];

/** THE ONE DERIVATION. First failing rule speaks; `features` null = skip the feature rule. */
export function readinessOf(wf: ReadinessInput, features: WorkspaceFeatures | null): Readiness {
  for (const rule of RULES) {
    const reason = rule(wf, features);
    if (reason) return { ready: false, reason: clip(reason, READINESS_REASON_MAX) };
  }
  return { ready: true };
}

// ── THE REFUSAL SENTENCES (spoken at the door, not on the ledger) ───────────────────────────────
// These are run-time emptiness, not configuration — they can only be known once a run is asked
// for. They live here so the words have ONE home with the readiness reasons.

/** A reaction workflow asked to run with nothing that happened. Names the remedy. */
export function nothingToReactTo(trigger: { when?: string; label?: string } | null | undefined): string {
  const what = clip(String(trigger?.when ?? trigger?.label ?? 'a matching event arrives'), 80);
  // The remedy claims ONLY what exists — and as of THE MATERIAL DOOR (relay canvas W2) the second
  // clause is TRUE: `POST /api/workflows/[id]/run` accepts `{ material: { text, name? } }`, which
  // rides as the run's trigger context, so a reaction workflow can be tested by hand. The
  // lying-door floor inverted here: before W2 offering this door was the lie; after W2, hiding it
  // is (the affordance exists and the refusal is the one place a person is looking for it).
  return (
    `Nothing to react to — this workflow runs when ${what}. ` +
    `It will run by itself when that happens — or Run it now with sample material to test.`
  );
}

/** The first tool step came back with nothing. The run stops rather than inventing a deliverable. */
export function emptyFirstMaterial(label: string): string {
  return (
    `Step 1 (${clip(label || 'the first step', 60)}) returned nothing to work with — ` +
    `the run stopped rather than inventing a deliverable.`
  );
}

/** Structural emptiness ONLY — a "no new items" sentence is CONTENT, not emptiness.
 *  Conservative by design: whitespace, null/undefined, and empty JSON containers. */
export function isStructurallyEmpty(output: unknown): boolean {
  if (output == null) return true;
  if (typeof output === 'string') return output.trim().length === 0;
  if (Array.isArray(output)) return output.length === 0;
  if (typeof output === 'object') {
    const s = JSON.stringify(output);
    return !s || s === '{}' || s === '[]' || s === '""';
  }
  return false;
}
