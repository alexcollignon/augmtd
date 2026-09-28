// ════════════════════════════════════════════════════════════════════════════════════════════════
// A REPLY IS NOT A DELIVERY (stabilization W19.A · invariant 7 EVIDENCE SETTLES; owner walk Sep 28).
//
// THE FINDING: an inbox item asking the user to SEND something ("Send RIB for the pilot payment") was
// closed by the reply resolver the moment the user wrote back — and the reply PROMISED the RIB "next
// week" with nothing attached. The fulfillment law (delivered vs promised) guarded only commitments;
// an inbox item's deliverable ask was settled by direction + time alone, and after the flip nothing
// tracked the promise at all.
//
// THE LAW: when an item's ask is a DELIVERABLE the user owes, a structural reply is only a CANDIDATE —
// the one fulfillment judge (lib/commitments/fulfillment.ts) decides delivered · promised · unclear;
// only `delivered` closes; a promise is recorded as a you-owe commitment through the one creation door
// (writeCommitments). An item that needs only an ANSWER (a question, a confirmation) still closes on
// the reply — the reply IS the answer.
//
// WHICH SIGNAL: the item's own JUDGMENT first (the judge's work verb + its `requires` inventory — the
// structured record the prepare lane already routes on): `send_file` / `produce`, or a `reply` that
// must carry an attachable artifact, are deliverables; every other judged verb is answer-shaped. No
// judgment yet → the understanding: an ACTION the user owes (relevance 'action' + ownership 'you_owe')
// is not settled by words alone. Zero keyword lists.
//
// Pure, zero IO, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { ExtractedCommitment } from '@/lib/commitments/extract';

/** The judged verbs whose work is a THING handed over, not an answer given. */
export const DELIVERABLE_WORKS: ReadonlySet<string> = new Set(['send_file', 'produce']);

export type DeliverableFacts = {
  /** the item's judged work verb (item_plans 'judgment' → tasks.verdict.work), when judged. */
  work?: string | null;
  /** the judged `requires` inventory (attachable artifacts the work must include). */
  requires?: unknown[] | null;
  /** the item's understanding (source_data.understanding). */
  understanding?: { relevance?: string | null; ownership?: string | null } | null;
};

/** Is this item's ask a DELIVERABLE the user owes (a reply alone cannot settle it)? Pure. */
export function isDeliverableAsk(f: DeliverableFacts): boolean {
  const work = typeof f.work === 'string' ? f.work.trim() : '';
  if (work) {
    if (DELIVERABLE_WORKS.has(work)) return true;
    return work === 'reply' && Array.isArray(f.requires) && f.requires.length > 0;
  }
  const u = f.understanding ?? null;
  return u?.relevance === 'action' && u?.ownership === 'you_owe';
}

/**
 * The you-owe commitment a PROMISING reply records — pure. The item's ask is the obligation (THE
 * TITLE LAW: its understanding.ask is already an imperative), the user is the doer, the judge's
 * verified quote is the promise's own words (the quote floor re-checks it against the message), and
 * the new due date is the one the judge found STATED in the message (code-verified). No verified
 * quote → null: an unquoted promise is never recorded (W15.4 — the item itself stays open instead).
 */
export function promiseCommitmentOf(
  item: { work_title?: string | null; source_data?: Record<string, unknown> | null },
  verdict: { verdict: string; quote?: string | null; newDue?: string | null },
  counterparty: string | null,
): ExtractedCommitment | null {
  if (verdict.verdict !== 'promised' || !verdict.quote) return null;
  const sd = (item.source_data ?? {}) as Record<string, unknown>;
  const u = (sd.understanding ?? {}) as { ask?: unknown; initiative?: unknown };
  const description = String((typeof u.ask === 'string' && u.ask.trim()) || item.work_title || sd.subject || '').trim();
  if (!description) return null;
  return {
    direction: 'you_owe',
    doer: 'user',
    description: description.slice(0, 500),
    due_date: verdict.newDue ?? null,
    counterparty,
    initiative: typeof u.initiative === 'string' ? u.initiative : null,
    quote: verdict.quote,
    explicit_promise: true,
  };
}
