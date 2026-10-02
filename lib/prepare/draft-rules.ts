// ════════════════════════════════════════════════════════════════════════════════════════════════
// W43 · THE DRAFTING RULES' VERSION — a LEAF module (no imports) so THE ONE READER (lib/prepare/read.ts,
// client-reachable) can compare against it without dragging the server graph (staging-law.ts's pattern).
//
// Found live (owner walk, Oct 2): unsent machine drafts prepared under OLDER drafting rules kept their old
// words forever — an English greeting on a French body, a chase written the wrong way round, a paste pack
// for an email conversation, a reference code in the signature. DRAFT_LAW_VERSION (the attachment block,
// lib/inbox/attachment-context.ts) is deliberately never bumped for these (a corpus re-draft at the
// conversation tier on the next sweep); this stamp is read ONLY by THE ONE READER, which withdraws an
// unsent, machine-written (never user-edited) draft whose stamp is older — and the on-open re-prepare trip
// (lib/room/open-kicks.ts, one per item per window, logged) re-drafts it under today's rules. The user's
// hand and sent drafts are never judged.
//
// Bump when a DRAFTING RULE changes what a stored draft would say (its channel, its staging, its floors,
// its signature) — never for a fact (a new inbound moves the ground on its own).
//   1 = W43: the channel decision (email, not a paste pack, for an email conversation) · a file only for a
//       file-kind ask · the work-claims floor in the one vet · the signature from recurring own lines only.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const DRAFT_RULES_VERSION = 1;

/** The stamp every draft writer spreads beside the words it authored. */
export const draftRulesStamp = (): { rules_version: number } => ({ rules_version: DRAFT_RULES_VERSION });

/** A stored draft written under older drafting rules (an unstamped one predates every version). Pure. */
export function draftRulesStale(stamp: { rules_version?: unknown } | null | undefined): boolean {
  const v = Number((stamp ?? {}).rules_version);
  return !Number.isFinite(v) || v < DRAFT_RULES_VERSION;
}
