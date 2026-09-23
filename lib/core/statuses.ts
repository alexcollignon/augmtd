// lib/core/statuses.ts — the canonical "what counts as an open commitment" constant.
//
// WIRED (W2.2 ONE USER GROUNDING): the spine (`lib/work-items/model.ts` — fetch AND in-memory test),
// the brief's per-person map (`lib/home/brief-context.ts`) and the user grounding (through the spine)
// read this set. The ask lane's private `['open','pending']` died with its private world block.
// THE SEMANTIC: an open commitment is one the user still owes — 'open', the legacy 'pending', and
// the human-set 'in_progress' (a hand on the work is not the work done). 'suggested' (unadopted
// machine drafts) and 'done'/'dismissed' are never open.
// ⚠️ Still narrower than this set: `lib/room/grounding.ts` (`.eq('status','open')`, W2.1's fence —
// re-point when that file is next open). The gate `scripts/smoke-user-grounding.ts` fails on any NEW
// local open-status list.
export const OPEN_COMMITMENT_STATUSES: readonly string[] = ['open', 'pending', 'in_progress'];

/** Membership test using the canonical set — for a future callsite to adopt without re-typing the array. */
export function isOpenCommitmentStatus(status: string | null | undefined): boolean {
  return OPEN_COMMITMENT_STATUSES.includes(String(status || 'pending'));
}
