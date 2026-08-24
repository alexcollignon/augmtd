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
//   5. an EVENT DOOR that cannot fire → judged door with no `when`: "The trigger needs an event to
//      react to." · a 'workflow' door with no workflow bound · a door whose SOURCE feature is off
//      (the doors are iterated through normalizeTriggers — legacy single reaction trigger folds in)
// Adding a rule = ONE entry in RULES below. Nothing else moves.
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
  status?: string | null;
  trigger?: { type?: string; when?: string; label?: string } | null;
  /** The event doors (relay canvas W1, additive jsonb). Read through normalizeTriggers. */
  triggers?: unknown;
  /** Any step array shape — WorkflowStep[] or raw jsonb rows. Read structurally, never trusted. */
  steps?: readonly unknown[] | null;
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
      if (String(d.when ?? '').trim().length <= 3) return 'The trigger needs an event to react to.';
      const req = def?.feature ?? null;
      if (features && req && features[req] === false) {
        const feature = FEATURE_LABEL[req] ?? req;
        const fixed = `The  door needs ${feature} enabled.`.length;
        return `The ${clip(def?.label ?? d.source, Math.max(8, READINESS_REASON_MAX - fixed))} door needs ${feature} enabled.`;
      }
    }
    return null;
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
