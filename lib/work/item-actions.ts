// ════════════════════════════════════════════════════════════════════════════════════════════════
// W15.2 · EVERY ITEM CAN BE CLOSED, AND SAYS WHERE IT STANDS (owner walk, Sep 24).
//
// The walk: with nothing prepared, the item page offered no action except the ⋯ menu — Done and
// Dismiss hid behind three dots on every kind. Now every item room's header carries ONE persistent
// action group (right side, beside Details): Done · Dismiss.
//
//   · EACH DEED GOES THROUGH THE ITEM KIND'S EXISTING RESOLUTION DOOR — logged, undoable from Activity,
//     its asks/narration settled by the door (W14.2's awaited settle). This table is that mapping, the
//     ONE home: a new item kind is a row here, never a new close path.
//   · ONE CTA ROW: a prepared primary (Send, Review invite, a decision) stays THE primary — Done and
//     Dismiss render SECONDARY; no other control on the page repeats either deed (the ⋯ menu keeps the
//     less common verbs: reply, forward, no longer relevant…).
//   · THE EMPHASIS FOLLOWS THE MACHINE: when the state is `looks_done` (the platform's evidence says
//     the work is probably finished) or `settled` on an item still open (the judge's served state says
//     nothing is owed), Done is the emphasised deed — the one click that closes what is already true.
//
// CLIENT-SAFE BY CONSTRUCTION (zero imports) — the room (a client component) and the gate read it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The two deeds, worded once. */
export const ITEM_DEED_WORDS = { done: 'Done', dismiss: 'Dismiss' } as const;
export type ItemDeed = keyof typeof ITEM_DEED_WORDS;

/** The item kinds a room door opens, and which resolution family each belongs to. An inbox item
 *  (a mail reply, a meeting-extracted action, an invite, any future inbox source) resolves through
 *  the inbox doors; a commitment or a follow-up (a waiting-on commitment) through the commitment door. */
export type ItemRoomKind = 'email' | 'commitment' | 'followup';
export const RESOLUTION_FAMILY: Record<ItemRoomKind, 'inbox' | 'commitment'> = {
  email: 'inbox',
  commitment: 'commitment',
  followup: 'commitment',
};

/** THE DOORS — the existing, logged, undoable resolution routes, per family. */
export function resolveRequestOf(kind: ItemRoomKind, id: string, deed: ItemDeed, opts: { note?: string } = {}): { url: string; init: RequestInit } {
  const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (RESOLUTION_FAMILY[kind] === 'inbox') {
    return deed === 'done'
      // "Already handled" — the complete door with its resolution reason (Activity can undo it).
      ? { url: `/api/inbox/${id}/complete`, init: { method: 'POST', ...json({ resolution_reason: 'already_handled' }) } }
      : { url: `/api/inbox/${id}/dismiss`, init: { method: 'POST', ...(opts.note ? json({ reason: opts.note }) : {}) } };
  }
  return { url: `/api/commitments/${id}`, init: { method: 'PATCH', ...json({ status: deed === 'done' ? 'done' : 'dismissed' }) } };
}

/** Which deed wears the emphasis. `looks_done`, or `settled` on an item the room still shows open →
 *  Done leads. Otherwise neither: a prepared primary (if any) is the page's one primary, and with
 *  nothing prepared the pair is simply there, quiet. Pure. */
export function resolveEmphasisOf(machineState: string | null | undefined): 'done' | 'none' {
  return machineState === 'looks_done' || machineState === 'settled' ? 'done' : 'none';
}

/** The verbs the ⋯ menu may NOT carry (ONE CTA ROW — the header group owns these deeds). */
export const HEADER_OWNED_VERB_KEYS: readonly string[] = ['done', 'dismiss'];
