// ════════════════════════════════════════════════════════════════════════════════════════════════
// W15.2 · NO EMPTY "READY" (owner walk, Sep 24 — an item narrated "already settled" still showed a
// reply card with an EMPTY body labelled "reply ready" and an active Send).
//
// A draft card's commit row is a CLAIM: "reply ready" / "ready to send" and an enabled Send say words
// are staged and addressed. With no words there is nothing to send — the card shows the honest empty
// state instead (W12.3's held-back line when the door withheld the words, else the plain empty line),
// the editor stays open for the user's own words, and Send appears the moment words exist.
//
// ONE PREDICATE for every text card (the item reply, the commitment's compose lane, a coworker's
// email, a standalone reply) — and THE ONE READER applies the same rule to prepared artifacts
// (lib/prepare/read.ts `emptyWords`: a text artifact with no words is never live), so the machine,
// the deck chip and the card agree. CLIENT-SAFE (zero imports).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type DraftReadiness = 'sent' | 'needs_recipient' | 'withheld' | 'empty' | 'ready';

/** The visible words of a body (HTML or plain) — what "is it empty?" may ask. Pure. */
export function visibleWords(body: string | null | undefined): string {
  return String(body ?? '')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s​ ]+/g, ' ')
    .trim();
}

/** THE CARD'S STATE — recipients, then words. Only `ready` may say "ready" or carry Send. Pure. */
export function draftReadinessOf(f: { recipients: readonly string[]; body: string | null | undefined; withheld?: string | null; sent?: boolean }): DraftReadiness {
  if (f.sent) return 'sent';
  if (!f.recipients.length) return 'needs_recipient';
  if (!visibleWords(f.body)) return f.withheld && f.withheld.trim() ? 'withheld' : 'empty';
  return 'ready';
}

/** The words a commit row may use to claim readiness — and ONLY in the `ready` state. */
export const READY_CLAIMS: readonly string[] = ['reply ready', 'ready to send'];
export const mayClaimReady = (r: DraftReadiness): boolean => r === 'ready';

/** The honest line an empty (not withheld) card prints above its open editor. */
export const EMPTY_DRAFT_NOTE = 'Nothing is drafted here yet — write it in your own words, or ask in the thread and it will be drafted.';
