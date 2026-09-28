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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PREP ANCHOR KEY (stabilization W2.1 — A COMPONENT IS A TURN). The prepare pass narrates on
// `prep:${w.id}` where w.id is the WORK-SPINE id (`inbox:<uuid>` / `commit:<uuid>`,
// lib/work-items/model.ts). Every card reader anchored on `prep:<rawId>` — the two never matched,
// so all 236 live prep narrations folded as orphans and every card appended at the stream's end.
// ONE producer for the reader side; the writer's shape is the law (the persisted turns already
// carry it). A spine id passes through unchanged; a raw id gets its kind prefix.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function prepAnchorKey(kind: 'inbox' | 'commitment' | 'followup' | 'email' | 'awareness', id: string): string {
  if (SPINE_PREFIX.test(id)) return `prep:${id}`;
  const spine = kind === 'commitment' || kind === 'followup' ? 'commit' : 'inbox';
  return `prep:${spine}:${id}`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W19.C · THE KIND RIDES TO EVERY DOOR (owner walk, Sep 28 — "Could not load the thread").
//
// A move ref carries its object's KIND (`inbox:` · `commit:` · `meeting:`), and `moveTargetId`
// deliberately strips it (every per-item route takes the raw id). The stage door then re-invented
// the kind as "email" for EVERY id — so a nudge prepared on a counterparty-owed COMMITMENT opened as
// a mail thread that does not exist. The class: an id handed to a door without its kind. The fix is
// ONE producer of a door address from what the host already holds — the ref itself, or the board
// row whose served `href` was built by the object's own reader — and "email" only when neither
// knows better (the converse core's forward/invite stages, inbox-only by construction).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A spine ref → its per-item door, the kind carried (`commit:` → `?kind=commitment`). Null for a ref
 *  with no item door (a deliverable, an event). THE ONE PRODUCER — hosts never hand-roll it. */
export function refDoorHref(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const at = ref.indexOf(':');
  if (at < 0) return null;
  const k = ref.slice(0, at);
  const i = ref.slice(at + 1);
  if (!i) return null;
  return k === 'inbox' ? `/item/${i}?kind=email`
    : k === 'commit' || k === 'commitment' ? `/item/${i}?kind=commitment`
    : k === 'meeting' ? `/item/${i}?kind=meeting`
    : null;
}

/** The kind an `/item/<id>?kind=…` address names (absent → email, the route's own default). */
export function doorKindOf(href: string | null | undefined): 'email' | 'commitment' | 'followup' | 'meeting' | null {
  const m = String(href ?? '').match(/^\/item\/[^/?]+(?:\?kind=(email|commitment|followup|meeting|awareness))?/);
  if (!m) return null;
  return m[1] === 'commitment' || m[1] === 'followup' || m[1] === 'meeting' ? m[1] : 'email';
}

/**
 * THE STAGE DOOR's address for a raw item id (pure). Reads, in order: the host's own board row for
 * that id (its `href` was served by the object's reader, kind and all), then the move ref that names
 * it; only an id neither knows lands on the mail door. A commitment NEVER opens as an email.
 */
export function stageDoorHref(
  itemId: string,
  rows: Array<{ id: string; rawId?: string | null; href?: string | null }>,
  moveRef?: string | null,
): string {
  const row = rows.find((r) => boardRowItemId(r) === itemId);
  if (row?.href && doorKindOf(row.href)) return row.href;
  if (moveRef && moveTargetId(moveRef) === itemId) {
    const h = refDoorHref(moveRef);
    if (h) return h;
  }
  return `/item/${itemId}?kind=email`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W19.C · A PREPARED CARD SAYS WHOSE MOVE IT IS (the same walk). A nudge Clara drafted for work the
// COUNTERPARTY owes rendered as `Prepared — "<the task's own title>"` — the bare commitment text
// ("Send presentation and agent documentation…") read as the user's own to-do, beside a CTA about
// something else. The board already knows the direction: a row in the WAITING lane is owed TO the
// user, so anything prepared on it is a chase. Read-time, from the rows as served — a stale card
// heals on its next paint, no backfill.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export type BoardLane = 'todo' | 'doing' | 'waiting';
export const NUDGE_MOVE_LABEL = 'Review nudge';

/** The counterparty a waiting row is waiting on — the GUARDED `blockedOn` first (never self), the
 *  row's `who` otherwise; the display name only (an address never reaches a label). */
export function waitingOnName(row: { blockedOn?: string | null; who?: string | null }): string | null {
  const raw = String(row.blockedOn ?? row.who ?? '').split('<')[0].replace(/["']/g, '').trim();
  return raw ? raw.split(/\s+/)[0] : null;
}

/** Is this row's prepared work a NUDGE (a chase for what someone else owes)? */
export function isWaitingNudge(lane: BoardLane, row: { prepared?: string | null }): boolean {
  return lane === 'waiting' && !!row.prepared;
}

/** The prepared card's label (pure). `quote` is the row title already clipped by the host's excerpt
 *  rule. A waiting row speaks its direction; every other row keeps the existing grammar. */
export function preparedCardLabel(
  lane: BoardLane, row: { prepared?: string | null; blockedOn?: string | null; who?: string | null }, quote: string,
): string {
  if (isWaitingNudge(lane, row)) {
    const who = waitingOnName(row);
    return `Nudge ready — ${who ? `waiting on ${who}` : 'waiting on a reply'}: "${quote}"`;
  }
  return `${row.prepared === 'draft' ? 'Draft ready' : 'Prepared'} — "${quote}"`;
}

/** The CTA says what it does: a move whose target is a waiting row's prepared nudge reads
 *  "Review nudge", whatever the composition called it (pure; a non-matching move passes through). */
export function moveForLane<M extends { label: string; ref: string | null }>(
  move: M | null | undefined, laneOfRef: (ref: string) => BoardLane | null, preparedOf: (ref: string) => boolean,
): M | null {
  if (!move) return null;
  if (!move.ref) return move;
  const lane = laneOfRef(move.ref);
  return lane === 'waiting' && preparedOf(move.ref) ? { ...move, label: NUDGE_MOVE_LABEL } : move;
}
