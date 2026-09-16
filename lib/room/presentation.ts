// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRESENTATION LAW (Aug 7, owner: "that kind of grounding/reasoning also needs to exist —
// there shouldn't be redundancy"). The REASONING half already lives in the one responder (it
// composes over the one grounding and the live board, so it cannot recommend what's already
// done). This module is the COMPOSITION half: ONE deterministic derivation of "who shows which
// action surface" that every pane consumes — the rail's merged action card, the stream's
// artifact cards, and the truth pane's embedded affordances all agree BY CONSTRUCTION, never by
// per-pane suppression patches added as duplicates are found.
//
// The law: a deed presents EXACTLY ONCE. The MOVE's target artifact renders as the ONE action
// card in the rail; that artifact never re-renders in the stream; the truth pane shows its own
// affordances ONLY for items the rail's card does not cover.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type PresentableArtifact = { key: string; anchorKey?: string };
export type PresentableMove = { label: string; ref: string | null } | null | undefined;

/** The item id a move ref points at (`inbox:<id>` / `commit:<id>` → `<id>`). */
export function moveTargetId(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return ref.split(':')[1] ?? null;
}

/** The artifact the MOVE covers — the one that becomes the rail's action card. */
export function mergedArtifactKey(move: PresentableMove, artifacts: PresentableArtifact[] | null | undefined): string | null {
  const target = moveTargetId(move?.ref ?? null);
  if (!target) return null;
  return (artifacts ?? []).find((a) => (a.anchorKey ?? '').includes(target) || a.key.includes(target))?.key ?? null;
}

/** Which stage the covered artifact's deed opens (the card's key names its verb). */
export function stageOfArtifactKey(key: string): 'reply' | 'forward' | 'invite' {
  return key.includes('forward') ? 'forward' : key.includes('invite') ? 'invite' : 'reply';
}

/** Does the rail's action card cover this item? (The truth pane's embedded affordances yield.) */
export function railCoversItem(moveRef: string | null | undefined, itemId: string): boolean {
  const target = moveTargetId(moveRef ?? null);
  return !!target && target === itemId;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHICH BOARD ROW ARRIVES AS THE EMAIL CARD (owner walk, Sep 14 — the "Send RIB…" row).
//
// The first version of this rule lived inline in the project room and tested the row's `prepared`
// TOKEN for the string 'draft'. That token is an ATTRIBUTION, not a deed: `preparedBadge` prefers
// the worker's name, so a coworker-prepared outgoing email reads "Clara" — and the live row (judged
// `send_file`, prepared by Clara, carrying a real 351-character draft) failed the test, mounted no
// card, and sent its CTA through to the stage the owner had just rejected.
//
// So the predicate is the DEED'S SHAPE, and it lives here — pure, exercisable, one implementation:
//   · an OUTGOING EMAIL is prepared on this row (`preparedKind === 'email_draft'`, served from the
//     source data itself, so reply and send_file are the same deed to the card that renders it),
//   · the row is INBOX-BACKED (its deep-dive href is an inbox item — a commitment is a different
//     object with a different door),
//   · and it is not MEETING-SOURCED (a meeting-extracted row has no thread; the verb-scope law —
//     an email card without an email is a lying card).
// ════════════════════════════════════════════════════════════════════════════════════════════════
export type CardCandidateRow = {
  href: string;
  preparedKind?: 'email_draft' | null;
  source?: string | null;
};

export function mountsEmailCard(row: CardCandidateRow): boolean {
  if (row.preparedKind !== 'email_draft') return false;
  if (row.source === 'meeting') return false;
  const h = row.href ?? '';
  return !(h.includes('kind=commitment') || h.includes('kind=followup') || h.includes('kind=meeting'));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROW'S ID FOR A DOOR (owner walk round 2, Sep 14 — the hollow card).
//
// A board row carries the SPINE id (`inbox:<uuid>` · `commit:<uuid>` — the work-item key every
// judgment and deck set is keyed by) while every per-item route takes the RAW row id. The room's
// email card was handed the spine id and asked `/api/inbox/inbox:<uuid>/draft` for its draft, its
// thread and its directions: three not-founds, and a card that rendered an honest empty shell over
// data that never arrived. The same mistake sits under every row deed that addresses a route.
//
// ONE READING: prefer the served `rawId`; strip the known spine prefix otherwise (an envelope
// cached before the field existed must still address the right row).
// ════════════════════════════════════════════════════════════════════════════════════════════════
const SPINE_PREFIX = /^(?:inbox|commit|deliv|event|outbound):/;

export function boardRowItemId(row: { id: string; rawId?: string | null }): string {
  if (row.rawId) return row.rawId;
  return (row.id ?? '').replace(SPINE_PREFIX, '');
}
