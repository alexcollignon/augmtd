// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEED'S OWN WORDS (docs/attention-plan.md, law A7) — types + the deterministic composers.
//
// PURE BY CONSTRUCTION: no crypto, no Supabase, no provider SDK, no AI. It exists apart from the
// engine for two reasons, both structural:
//
//   1 · THE CLIENT-SAFE MODULE LAW. The card is a client component, and importing a runtime value
//       from the engine would drag googleapis and the whole server graph into the browser bundle.
//       The card imports THESE words; it never imports the engine.
//   2 · A DEED DESCRIBES ITSELF THE SAME WAY EVERYWHERE. The card, the spoken door, and the
//       activity row all print the output of the same four functions, so the words on screen and
//       the words in the record can never drift. No model ever authors a deed's own description.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { HeldClassId } from '@/lib/home/attention';
import type { UnsubscribeLane } from './unsubscribe';

/** A7's four natural verbs. `surface` (brought_forward's deed) is a NAVIGATION, not a deed — it
 *  moves nothing and belongs to the ledger surface, so it is deliberately not one of these. */
export const BULK_VERBS = ['archive', 'unsubscribe', 'expire', 'trash'] as const;
export type BulkVerb = (typeof BULK_VERBS)[number];

export const BULK_DEED_KIND = 'bulk_deed';

/** The bound on one deed. A deed larger than this is not a deed, it is a migration. */
export const MAX_DEED_ITEMS = 200;

/** Unsubscribe reads one live header per member. Bounded so a preview stays a preview; anything
 *  beyond the cap is REPORTED as unchecked rather than silently dropped. */
export const MAX_UNSUBSCRIBE_HEADER_READS = 80;

export type DeedItemRef = {
  itemId: string;
  subject: string;
  /** unsubscribe only — the lane the live header put this message in. */
  lane?: UnsubscribeLane;
  /** unsubscribe only — the one-click target (fired) or the needs-a-click target (REPORTED). */
  url?: string;
  mailto?: string;
  mailtoSubject?: string;
  /** expire only — the deterministic nomination. The judge disposes at commit. */
  pastDue?: boolean;
};

export type BulkBreakdown = {
  total: number;
  /** archive · trash — how many carry a mailbox we can actually act on. */
  withMailbox?: number;
  noMailbox?: number;
  /** unsubscribe — THE HONEST SUBSET. */
  oneClick?: number;
  mailto?: number;
  needsClick?: number;
  none?: number;
  /** unsubscribe — members whose headers were not read because the read cap was reached. */
  unread?: number;
  /** expire — nominated deterministically. */
  pastDue?: number;
};

export type DeedOutcomeStatus = 'done' | 'partial' | 'skipped' | 'failed';
export type DeedOutcome = { itemId: string; status: DeedOutcomeStatus; note?: string };

export type BulkDeed = {
  id: string;
  verb: BulkVerb;
  classKey: HeldClassId | null;
  className: string | null;
  items: DeedItemRef[];
  breakdown: BulkBreakdown;
  intro: string;
  undoNote: string;
  createdAt: string;
  committedAt?: string | null;
  outcomes?: DeedOutcome[];
  tally?: { done: number; partial: number; skipped: number; failed: number; line: string };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function composeIntro(verb: BulkVerb, count: number, className: string | null): string {
  const where = className ? ` from ${className}` : '';
  switch (verb) {
    case 'archive': return `Archive ${plural(count, 'message')}${where}.`;
    case 'trash': return `Move ${plural(count, 'message')}${where} to trash.`;
    case 'unsubscribe': return `Unsubscribe from ${plural(count, 'message')}${where}.`;
    case 'expire': return `Close ${plural(count, 'commitment')} whose moment has passed.`;
  }
}

/**
 * THE UNDO NOTE — and the one place this arc refuses to flatter itself.
 *
 * A7 says "every bulk deed is undoable and logged". Three of the four are: archive and trash resolve
 * through the door `/api/restore` already reverses, and expire writes `commitment_expired`, which is
 * in the reversible map. AN UNSUBSCRIBE IS NOT. Once the sender's list software has the request, no
 * button of ours takes it back. Printing "undoable" on that card would be exactly the pretending the
 * honest-subset floor exists to forbid, so the card says what is true instead.
 */
export function composeUndoNote(verb: BulkVerb): string {
  switch (verb) {
    case 'archive': return 'Reversible — each one is logged in Activity, and Undo puts it back on the deck.';
    case 'trash': return 'Trash, never delete — the messages stay recoverable in your mailbox, and Undo in Activity puts the items back.';
    case 'unsubscribe': return 'Unsubscribing is the sender’s to reverse, not ours — every request is logged, but Undo cannot take it back.';
    case 'expire': return 'Reversible — Undo in Activity reopens the commitment.';
  }
}

/**
 * THE BREAKDOWN LINES — "what will happen, to how many", composed from the STORED breakdown.
 * A lane with a zero count gets NO line: a card that says "0 need a click from you" is chrome
 * pretending to be information.
 */
export function breakdownLines(deed: BulkDeed): string[] {
  const b = deed.breakdown;
  const out: string[] = [];
  if (deed.verb === 'unsubscribe') {
    if (b.oneClick) out.push(`${plural(b.oneClick, 'sender')} unsubscribe automatically (one-click)`);
    if (b.mailto) out.push(`${plural(b.mailto, 'sender')} unsubscribe by an email sent as you`);
    if (b.needsClick) out.push(`${plural(b.needsClick, 'sender')} need a click from you — we never open those links for you`);
    if (b.none) out.push(`${plural(b.none, 'message')} offer no unsubscribe at all`);
    if (b.unread) out.push(`${plural(b.unread, 'message')} beyond the first ${MAX_UNSUBSCRIBE_HEADER_READS} were not checked`);
    return out;
  }
  if (deed.verb === 'expire') {
    if (b.pastDue) out.push(`${plural(b.pastDue, 'commitment')} past due — each one is judged before it closes`);
    const held = b.total - (b.pastDue ?? 0);
    if (held > 0) out.push(`${plural(held, 'commitment')} not past due — those are left alone`);
    return out;
  }
  const word = deed.verb === 'trash' ? 'moved to trash in your mailbox' : 'archived in your mailbox';
  if (b.withMailbox) out.push(`${plural(b.withMailbox, 'message')} ${word}`);
  if (b.noMailbox) {
    out.push(deed.verb === 'trash'
      ? `${plural(b.noMailbox, 'message')} have no mailbox we can reach — those are left alone`
      : `${plural(b.noMailbox, 'message')} have no mailbox we can reach — those are cleared here only`);
  }
  return out;
}

/** The honest sentence under the done state. Counted from the real outcomes, never from the
 *  preview's hopes — and it offers Undo only for the verbs that actually have one. */
export function tallyLine(verb: BulkVerb, outcomes: DeedOutcome[]): string {
  const n = (s: DeedOutcomeStatus) => outcomes.filter((o) => o.status === s).length;
  const done = n('done'), partial = n('partial'), skipped = n('skipped'), failed = n('failed');
  const word = verb === 'archive' ? 'archived' : verb === 'trash' ? 'moved to trash'
    : verb === 'unsubscribe' ? 'unsubscribed' : 'closed';
  const parts = [`${done} ${word}`];
  if (partial) parts.push(`${partial} done here but not in your mailbox`);
  if (skipped) parts.push(`${skipped} left for you`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

export function doneReceipt(deed: BulkDeed): string | null {
  if (!deed.committedAt || !deed.tally) return null;
  const undoable = deed.verb !== 'unsubscribe' && deed.tally.done > 0;
  return undoable ? `${deed.tally.line} · undo in Activity` : deed.tally.line;
}
