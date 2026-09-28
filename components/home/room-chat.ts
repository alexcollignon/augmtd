// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROOM'S CONVERSATION IS A REAL CHAT (stabilization W19.B, Sep 28) — the pure reading of a room
// turn, shared by the rail's FOLD and its RENDER (components/home/item-rail.tsx).
//
// THE INCIDENT (owner walk, Sep 28): a project room showed the reader's question with nothing under
// it — the answer had never been written — and, when an answer did stand, it was drawn in the
// narrator's grey event-line grammar or folded into History while its question stayed. Three causes,
// one class each:
//   · TWO PREDICATES FOR ONE CONCEPT — the fold's "is this a card?" list and the render's had drifted
//     (the fold forgot collection / event / change), so a card answer expired as narration. There is
//     ONE predicate now (`hasTurnComponent`), and fold and render both read `isNarrationTurn`.
//   · AN ANSWER HAD NO IDENTITY — "system, no author" meant narrator. The structural boundary the
//     room's own session law already draws (lib/room/turns.ts `archiveRoomChat`: a system turn is
//     part of the EXCHANGE exactly when it carries no durable handle — no dedupe key, no component,
//     no author) is the answer's identity: an unhandled system turn is the seat SPEAKING, and it
//     renders as the seat's bubble through the ONE answer renderer (components/home/ask-answer.tsx),
//     exactly as the Home chat renders it. Engine narration is always keyed to its work — that, and
//     only that, is the muted event line.
//   · THE OPENER WAS PERSISTED AS A TURN — it is chrome, not conversation. It is no longer written,
//     and rows written before W19 are dropped at read (`isPersistedOpener`, a read-time floor — no
//     data write).
//
// Pure, zero-IO, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The structural fields a room turn is read by (the rail's `Turn`, live or rehydrated). */
export type RoomChatTurnShape = {
  role: 'user' | 'system';
  text?: string;
  author?: { name?: string | null } | null;
  /** The durable dedupe key (rehydrated) … */
  dkey?: string;
  /** … or the live keyed-turn handle (pushDealTurn / the founding proposal). */
  key?: string;
  checklist?: unknown[];
  actions?: unknown[];
  standingSpec?: unknown;
  workflowDraft?: unknown;
  approval?: unknown;
  collection?: unknown;
  event?: unknown;
  change?: unknown;
  /** W20.B · the chat's cards (lib/present/turn-card `ChatCards` — invite · email draft · bulk deed ·
   *  collection · event · change), one field for every kind the ONE table knows. */
  cards?: Record<string, unknown[] | undefined>;
};

const hasCards = (c: RoomChatTurnShape['cards']): boolean => !!c && Object.values(c).some((v) => Array.isArray(v) && v.length > 0);

/** THE ONE "is this a card turn" predicate — a turn carrying a live affordance. Fold and render both
 *  read it; a second hand-kept list is how the two drifted. */
export function hasTurnComponent(t: RoomChatTurnShape): boolean {
  return !!(t.checklist?.length || t.actions?.length || t.standingSpec || t.workflowDraft || t.approval
    || t.collection || t.event || t.change || hasCards(t.cards) || t.key === 'founding-proposal' || t.dkey === 'founding-proposal');
}

/** The seat's own answer: a system turn with no durable handle (no key, no component, no author) —
 *  the exchange side of the room, by the same boundary the session archive draws. */
export function isAnswerTurn(t: RoomChatTurnShape): boolean {
  return t.role === 'system' && !t.author?.name && !t.dkey && !t.key && !hasTurnComponent(t);
}

/** Engine narration — the ONLY turns drawn as the muted event line, and the only ones the brief's
 *  watermark may expire: system, no author, no component, and keyed to its work. Answers and the
 *  reader's own words are never narration. */
export function isNarrationTurn(t: RoomChatTurnShape): boolean {
  return t.role === 'system' && !t.author?.name && !hasTurnComponent(t) && !isAnswerTurn(t);
}

// ── THE OPENER IS CHROME ─────────────────────────────────────────────────────────────────────────
/** The invitation the opener ends on — ONE producer: the opener composes with it and the read floor
 *  recognises it, so the two can never disagree about what an opener is. */
export const OPENER_INVITE = 'What do you want to pick up?';
export const openerInvite = (name?: string | null, hasRecord?: boolean): string => hasRecord
  ? (name ? `Picking ${name} back up — what do you want to look at?` : 'Picking this back up — what do you want to look at?')
  : (name ? `Fresh start on ${name}. ${OPENER_INVITE}` : `Fresh start. ${OPENER_INVITE}`);

/** A pre-W19 persisted opener row: system, no handle, and speaking only the opener's own words. */
export function isPersistedOpener(row: { role: string; text?: string | null; key?: string | null; author?: unknown; component?: unknown }): boolean {
  if (row.role !== 'system' || row.key || row.author || row.component) return false;
  const text = String(row.text ?? '').trim();
  return text.endsWith(OPENER_INVITE)
    || /^Picking (?:.+ )?back up — what do you want to look at\?$/.test(text);
}

// ── NO ORPHAN QUESTION ───────────────────────────────────────────────────────────────────────────
/** The dangling question: the exchange ends on the reader's words and nothing is in flight. The
 *  surface renders one quiet "No answer was saved — Ask again" line under it; it never silently ends
 *  on the reader's words. */
export function orphanQuestion<T extends { role: string }>(turns: readonly T[], busy: boolean): T | null {
  if (busy || !turns.length) return null;
  const last = turns[turns.length - 1];
  return last.role === 'user' ? last : null;
}

export const ORPHAN_LINE = 'No answer was saved';
export const ORPHAN_RETRY = 'Ask again';
