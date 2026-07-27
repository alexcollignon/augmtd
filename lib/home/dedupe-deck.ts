// ════════════════════════════════════════════════════════════════════════════════════════════════
// CROSS-TYPE DEDUP (just-works P2) — one obligation surfaces ONCE on the deck.
//
// The duplication class: a commitment EXTRACTED from an email/meeting that the deck ALSO shows as an
// actionable row (the reply card, the meeting action item) — the same obligation wearing two types.
// The actionable ITEM is the surface that resolves it (replying / doing the action item clears both),
// so the commitment FOLDS; it keeps existing in the data (nothing is deleted) — it just doesn't get a
// second row.
//
// Deterministic, no AI. Two ways a commitment counts as the same obligation as a visible item:
//   • STRUCTURAL + text — it was extracted from that very email/meeting (source_id / thread match)
//     AND the wording overlaps moderately (a same-source commitment about something ELSE — "send the
//     deck" extracted from a pricing thread — survives).
//   • STRONG text alone — near-identical wording even across sources (the same promise captured from
//     both the meeting and the follow-up email).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { isNearDuplicate } from '@/lib/commitments/extract';

export type VisibleObligation = {
  title: string;                 // the row's work title / subject / action-item text
  sourceId?: string | null;      // the item's source_id (email message id)
  threadId?: string | null;      // the email thread
  meetingId?: string | null;     // source_meeting_transcript_id for meeting action items
};

type CommitmentRow = {
  id: string;
  description?: string | null;
  status?: string | null;
  source?: string | null;
  source_id?: string | null;
  thread_id?: string | null;
  direction?: string | null;
};

// Promise fix #2 (one obligation = one task): the extractor REPHRASES ("Reply to N with
// clarification on pricing questions" vs the row "Clarify pricing details for the platform" —
// token overlap ~0.09), so NO text floor can reliably recognize a structurally-tied pair. The rule
// is therefore structural: a YOU_OWE commitment tied to a live actionable row's thread/source IS
// that row's obligation — one thread, one surface; the reply row covers the thread's asks (the
// checklist idiom holds its parts). AWAITING commitments keep a text floor (a follow-up you're
// owed is its own work even on a shared thread). No structural tie → near-identical wording only.
const AWAITING_STRUCTURAL_TEXT_FLOOR = 0.45;
const PURE_TEXT_FLOOR = 0.65;

export function isDupOfVisible(c: CommitmentRow, visible: VisibleObligation[]): boolean {
  const desc = String(c.description || '');
  if (!desc) return false;
  const awaiting = c.direction === 'awaiting';
  for (const v of visible) {
    if (!v.title) continue;
    const structural =
      (!!c.source_id && (c.source_id === v.sourceId || c.source_id === v.meetingId)) ||
      (!!c.thread_id && c.thread_id === v.threadId);
    if (structural && !awaiting) return true;
    if (structural && awaiting && isNearDuplicate(desc, v.title, AWAITING_STRUCTURAL_TEXT_FLOOR)) return true;
    if (!structural && isNearDuplicate(desc, v.title, PURE_TEXT_FLOOR)) return true;
  }
  return false;
}

/** Fold commitments that duplicate a visible actionable item. Returns the kept set + what folded
 *  (ids, for the watchdog log / smoke). Order-preserving; never mutates. */
export function foldDuplicateCommitments<T extends CommitmentRow>(
  commitments: T[],
  visible: VisibleObligation[],
): { kept: T[]; foldedIds: string[] } {
  const kept: T[] = [];
  const foldedIds: string[] = [];
  for (const c of commitments) {
    if (isDupOfVisible(c, visible)) foldedIds.push(c.id);
    else kept.push(c);
  }
  return { kept, foldedIds };
}

/** The deck's visible-obligation list — ONLY rows that actually SURFACE as tasks. With the
 *  structural fold now unconditional for you_owe pairs, this filter is load-bearing: a commitment
 *  must never fold behind an FYI/noted row that the user never sees (the obligation would vanish
 *  from both). An explicit actionable type_override always counts; a bulk/FYI posture never does. */
/** THE one visibility predicate — is this inbox row a row the user actually SEES as a task?
 *  Shared by the fold AND the promise gate (P3), so they can never disagree about what counts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isVisibleObligationRow(it: any): boolean {
  const or = String(it.type_override || '');
  if (or === 'needs_reply' || or === 'to_do' || or === 'waiting_on') return true;
  const rt = String(it.rule_type || '');
  if (rt === 'fyi' || rt === 'notifications' || rt === 'marketing' || rt === 'done') return false;
  const ws = String(it.work_state || '');
  if (ws === 'noted' || ws === 'noise') return rt === 'needs_reply' || rt === 'to_do' || rt === 'waiting_on';
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function visibleObligationsFromItems(items: any[]): VisibleObligation[] {
  return items.filter(isVisibleObligationRow).map((it) => ({
    title: String(it.work_title || it.source_data?.subject || ''),
    sourceId: (it.source_id as string) ?? null,
    threadId: (it.source_data?.thread_id as string) ?? null,
    meetingId: (it.source_meeting_transcript_id as string) ?? null,
  })).filter((v) => v.title);
}
