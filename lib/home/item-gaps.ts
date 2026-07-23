// ════════════════════════════════════════════════════════════════════════════════════════════════
// GAP DERIVATION + DEPENDENCY HONESTY (just-works P1, docs/just-works-plan.md).
//
// The plan engine (item_plans) SURVIVES as substrate but users never see steps — the deep-dive shows
// the OUTCOME (a draft in the composer) plus, when preparation is incomplete, ONE plain suggestion
// derived from the unmet producing steps. Two exports:
//
//   • isSendBlocked(tasks, sendTask) — the DEPENDENCY RULE: a send/commit step can NEVER be "ready"
//     while a producing step before it is still open (the exact screenshot bug: "Send pricing offer —
//     Draft ready" above an open "Draft pricing offer — Needs you"). Deterministic, order-based.
//   • deriveGap(tasks) — the ONE gap line: the FIRST unmet producing input, phrased as a plain
//     colleague suggestion. Grounded-or-absent: no unmet producers → null (never invented urgency,
//     never a step list).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { detectAttachmentRequest, type ItemPlanTask } from './item-plan';

/** A step is OPEN when it still needs resolving (not done, not dismissed, not handed off + finished). */
export function isOpenStep(t: ItemPlanTask): boolean {
  return !t.done && !t.dismissed && t.status !== 'done';
}

/** A COMMIT step delivers a result outward (send capability). Producing steps are everything else. */
function isCommitStep(t: ItemPlanTask): boolean {
  return t.actor === 'system' && t.capability === 'send';
}

/**
 * THE DEPENDENCY RULE — a send/commit step is blocked while ANY earlier open producing step exists.
 * (Steps are already dependency-ordered by `orderCommunicationLast`, so "earlier" is meaningful.)
 */
export function isSendBlocked(tasks: ItemPlanTask[], sendTask: ItemPlanTask): boolean {
  const idx = tasks.findIndex((t) => t.id === sendTask.id);
  if (idx <= 0) return false;
  return tasks.slice(0, idx).some((t) => isOpenStep(t) && !isCommitStep(t));
}

/**
 * THE GAP LINE — one plain suggestion from the first unmet producing input, or null.
 * Priority: an explicit awaiting_input request (the step literally asked the user for something) →
 * the first open [You] producing step that precedes an open commit/draft outcome. A plan with no
 * commit step and only [You] steps yields no gap (there's no prepared outcome to complete).
 */
export function deriveGap(tasks: ItemPlanTask[] | null | undefined): string | null {
  if (!tasks?.length) return null;
  const live = tasks.filter((t) => !t.dismissed);

  // 1 — an explicit request for input is the sharpest gap: surface its own ask. VALIDATED against the
  // CURRENT grader: a stored step whose request predates the grader fix (the "upload the Note" class —
  // a step that doesn't actually consume a document) is a stale artifact, never a live ask.
  const awaiting = live.find((t) =>
    isOpenStep(t) && t.status === 'awaiting_input' && t.request?.prompt && detectAttachmentRequest(t) !== null);
  if (awaiting?.request?.prompt) {
    const ask = awaiting.request.prompt.replace(/\.+$/, '');
    return `I still need one thing: ${lowerFirst(ask)} — attach it below or tell me where it is and I'll fold it in.`;
  }

  // 2 — an open [You] producing step standing before an open commit step: the outcome is prepared or
  // preparable, but this input is missing. One line, the FIRST such step (never a list).
  const commitIdx = live.findIndex((t) => isCommitStep(t) && isOpenStep(t));
  if (commitIdx > 0) {
    const producer = live.slice(0, commitIdx).find((t) => isOpenStep(t) && t.actor === 'you');
    if (producer) {
      const what = (producer.detail && producer.detail.length > producer.text.length ? producer.detail : producer.text).replace(/\.+$/, '');
      return `Before this goes out: ${lowerFirst(what)}. Add what you know below and I'll complete it.`;
    }
  }
  return null;
}

function lowerFirst(s: string): string {
  // Leave acronyms/proper nouns intact — only lowercase a leading capital followed by lowercase.
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}
