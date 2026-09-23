// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE OBJECT, ONE DOOR (stabilization W7.2, Sep 23 — docs/laws-registry.md `one-object-one-door`).
//
//   Every door speaks for the object in its title. The item door composes an ITEM-FIRST brief keyed
//   per item whatever its links; its project is ONE connection line, never the voice. A tracked
//   project's own door speaks the project agenda. A MOVE, an object card or a bound card must target
//   an item this door OWNS — the anchor or its own artifacts — or it does not render.
//
// THE LIVE FINDING (owner, production, Sep 23): a commitment's own brief was right at 11:50 ("the
// client needs to confirm a time… I drafted a follow-up nudge below"). At 11:56 recognize-on-open
// linked it to an UNTRACKED machine entity, and from then the same door served the ENTITY's brief
// under the commitment's title — two travel invitations from a sibling thread "pending your RSVP…
// the choice is laid out below" — its MOVE targeted a different item, the rail mounted THAT item's
// raw email as this room's "source", and a bare proposal card rendered for a decision this door
// never mounts. The component note passed the claims floor because it was computed from the ENTITY
// board, not from what this door mounts. 473 of 481 initiative entities are untracked; 1,430
// commitment links and 946 inbox links point at them — the class, not the screenshot.
//
// PURE — no reads, no AI, no server imports (the rail is a client component). Both the server door
// (app/api/items/view) and the rail consume these; the gate (scripts/smoke-one-door.ts) tests them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type ItemDoorKind = 'inbox' | 'commitment' | 'meeting';
export type Door =
  | { kind: 'entity'; id: string }
  | { kind: 'item'; itemKind: ItemDoorKind; id: string };

/** THE ROOM-KEY RULE: the entity door converses under the entity id; an ITEM door converses under
 *  its OWN `<kind>:<id>` key — whatever it is linked to. A link (tracked or not) never re-homes a
 *  conversation: recognition is a fact ABOUT the item, not a new address for it. Matches
 *  lib/room/turns.ts `looseRoomKey` and `roomKeyForItem`. */
export function roomKeyForDoor(door: Door): string {
  return door.kind === 'entity' ? door.id : `${door.itemKind}:${door.id}`;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The object ids a card names — parsed from its key and its anchor key (`prep:commit:<id>`,
 *  `invite:<id>`…). A card whose keys carry no id names nothing. */
export function idsNamedByCard(card: { key: string; anchorKey?: string | null }): string[] {
  const out = new Set<string>();
  for (const s of [card.key, card.anchorKey ?? '']) for (const m of String(s ?? '').match(UUID_RE) ?? []) out.add(m.toLowerCase());
  return [...out];
}

/** THE OWNERSHIP PREDICATE. An ITEM door owns exactly its anchor and the objects its own cards
 *  name; an ENTITY door owns its members (the served siblings + the focused item) and what its
 *  cards name. Anything else — the move target of a brief cached under another key, a sibling's
 *  mail — is not this door's to speak for, and does not render. Null target → not owned. */
export function targetOwnedByDoor(
  door: Door, targetId: string | null | undefined,
  owned: { cardIds?: string[]; memberIds?: string[] } = {},
): boolean {
  if (!targetId) return false;
  const t = String(targetId).toLowerCase();
  const cards = (owned.cardIds ?? []).map((s) => s.toLowerCase());
  if (door.kind === 'item') return t === door.id.toLowerCase() || cards.includes(t);
  return (owned.memberIds ?? []).some((m) => m.toLowerCase() === t) || cards.includes(t);
}

/** THE OBJECT CARD'S ONE ID — the door's OWN source only. An email door's object is itself; a
 *  commitment's is its source email item (served by the door, resolved from the commitment's own
 *  provenance); a meeting-born commitment has no mail object yet (W7.4 will hand the meeting source
 *  to the same mount — this rule only ever CHOOSES the id). The entity door, with nothing focused,
 *  may fall back to its mail MOVE's target: that target is a member the entity owns. An item door
 *  NEVER takes the move target as its source — that is exactly how another item's email mounted
 *  under this room's title. */
export function objectIdForDoor(
  door: Door, facts: { sourceItemId?: string | null; moveRef?: string | null },
): string | null {
  if (door.kind === 'item') {
    if (door.itemKind === 'inbox') return door.id;
    return facts.sourceItemId ?? null;
  }
  if (facts.sourceItemId) return facts.sourceItemId;
  const ref = facts.moveRef ?? '';
  return ref.startsWith('inbox:') ? ref.slice('inbox:'.length) || null : null;
}

/** THE BINDING RULE (the rail's "exactly ONE card of the move's kind ⇒ bind"): a card may stand in
 *  for a validated target only when it NAMES that target, or — on an ITEM door — carries no id at
 *  all (an item door's cards are its own by construction). On the entity door a nameless card is
 *  never bound: two members' cards look alike and code never guesses between objects. */
export function cardMayBindTarget(
  door: Door, card: { key: string; anchorKey?: string | null }, targetId: string,
): boolean {
  const ids = idsNamedByCard(card);
  const t = targetId.toLowerCase();
  if (ids.includes(t)) return true;
  return door.kind === 'item' && ids.length === 0;
}

/** THE CONNECTION LINE — the one place the item door names its project. Tracked → a door to the
 *  project room; untracked → the quiet "connects to … Track" chip the filing control already
 *  renders (never a room to open, never the voice). Pure: the caller renders the shape it returns. */
export function connectionLineFor(
  ent: { id: string; name: string; tracked?: boolean | null } | null | undefined,
): { kind: 'project'; id: string; name: string } | { kind: 'recognized'; id: string; name: string } | null {
  if (!ent?.id || !ent.name) return null;
  return ent.tracked === true ? { kind: 'project', id: ent.id, name: ent.name } : { kind: 'recognized', id: ent.id, name: ent.name };
}
