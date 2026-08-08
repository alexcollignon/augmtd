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
