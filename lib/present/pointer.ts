// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE POINTER IS ONE SHAPE (W4-C, Sep 22 — docs/component-map.md §6).
//
// A presented object persists as a POINTER, never as rows: `{id, kind, framing, params}` for a
// collection, `{eventId, proposal}` for an event. The rows/verbs are re-derived at the next open
// (`GET /api/collections`, `GET /api/events/[id]/card`), so a reloaded card can never paint a set
// or offer a verb that stopped being true.
//
// That law held on the Home/native lanes and was HAND-TYPED at each of them. Three producers now
// write the same pointer — the native DM route, the AgentOS bridge, and the Home ask door's room
// turn — so the shape lives here, once. A second spelling of a pointer is a second rehydration
// contract, and the readers (home-ask, item-rail) only know one.
//
// PURE and leaf: zero IO, zero React.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { CollectionSpec } from '@/lib/present/collection';
import type { EventProposal, EventSpec } from '@/lib/present/event';

/** What a persisted collection card carries. NEVER the rows. */
export type CollectionTurnPointer = {
  /** The render key the live frame used — stable across the turn's stream and its record. */
  id: string;
  kind: CollectionSpec['kind'];
  /** The code-composed framing sentence (arithmetic over the rows — never the model's prose). */
  framing: string;
  params?: Record<string, string | number | boolean>;
};

/** What a persisted event card carries: the calendar_events id and the turn's ARMED proposal. */
export type EventTurnPointer = { eventId: string; proposal?: EventProposal };

/** PURE. The one reading of a served collection spec into its durable pointer. */
export function collectionPointer(id: string, spec: CollectionSpec): CollectionTurnPointer {
  return {
    id,
    kind: spec.kind,
    framing: spec.framing,
    ...(spec.params ? { params: spec.params } : {}),
  };
}

/** PURE. The one reading of a served event spec into its durable pointer. The spec's own `id` IS
 *  the re-read address (`GET /api/events/<id>/card`) and the address its verbs act through. */
export function eventPointer(spec: EventSpec): EventTurnPointer {
  return {
    eventId: spec.id,
    ...(spec.proposal ? { proposal: spec.proposal } : {}),
  };
}

// ─── THE SAME POINTER, AS A ROOM TURN (W4-C) ─────────────────────────────────────────────────
// A CARD IS A TURN: in a room the pointer rides `room_turns.component`, which the item rail reads
// back on every open. The KEY and the STATE below are the exact shapes `components/home/
// home-ask.tsx` already reads for the Home chat's own stored turns — a second spelling would be a
// second rehydration contract, and the reader only knows one.

export type CollectionTurnComponent = {
  key: 'collection_card'; refId: string;
  state: { kind: CollectionSpec['kind']; framing: string; params?: Record<string, string | number | boolean> };
};
export type EventTurnComponent = {
  key: 'event_card'; refId: string;
  state: { eventId: string; proposal?: EventProposal };
};

/** PURE. The durable component a room writes for a presented collection. */
export function collectionTurnComponent(id: string, spec: CollectionSpec): CollectionTurnComponent {
  const p = collectionPointer(id, spec);
  return { key: 'collection_card', refId: p.id,
    state: { kind: p.kind, framing: p.framing, ...(p.params ? { params: p.params } : {}) } };
}

/** PURE. The durable component a room writes for a presented event. `refId` IS the calendar_events
 *  id; `state.eventId` repeats it so a reader that keys on state alone resolves too. */
export function eventTurnComponent(spec: EventSpec): EventTurnComponent {
  const p = eventPointer(spec);
  return { key: 'event_card', refId: p.eventId,
    state: { eventId: p.eventId, ...(p.proposal ? { proposal: p.proposal } : {}) } };
}
