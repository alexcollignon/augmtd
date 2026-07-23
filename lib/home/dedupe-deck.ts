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
};

const STRUCTURAL_TEXT_FLOOR = 0.45; // same source → moderate overlap is enough
const PURE_TEXT_FLOOR = 0.65;       // no structural tie → the wording must be near-identical

export function isDupOfVisible(c: CommitmentRow, visible: VisibleObligation[]): boolean {
  const desc = String(c.description || '');
  if (!desc) return false;
  for (const v of visible) {
    if (!v.title) continue;
    const structural =
      (!!c.source_id && (c.source_id === v.sourceId || c.source_id === v.meetingId)) ||
      (!!c.thread_id && c.thread_id === v.threadId);
    if (structural && isNearDuplicate(desc, v.title, STRUCTURAL_TEXT_FLOOR)) return true;
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

/** The deck's visible-obligation list from the brief route's raw actionable inbox rows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function visibleObligationsFromItems(items: any[]): VisibleObligation[] {
  return items.map((it) => ({
    title: String(it.work_title || it.source_data?.subject || ''),
    sourceId: (it.source_id as string) ?? null,
    threadId: (it.source_data?.thread_id as string) ?? null,
    meetingId: (it.source_meeting_transcript_id as string) ?? null,
  })).filter((v) => v.title);
}
