// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREAD DOOR, READ ONCE — the ONE client-side reader of `GET /api/inbox/<id>/thread`
// (docs/threads-plan.md "THE OPENING CONTRACT", clause 1: THE ONE OBJECT CARD).
//
// The triage deck already solved "show the thing itself": read the EXISTING thread door lazily,
// clip the tail by THE ONE CLIPPER, cache it for the session, prefetch one card ahead. The opening
// contract needs exactly the same read at three more seats (a decision's object, a room's opening,
// an ask) — so the loader moved OUT of the deck component and into this module, and the deck
// imports it. A second copy of a cache is a second answer to one question: the deck would warm one
// map while a room warmed another, and the same item would be read twice on the same page.
//
// WHAT LIVES HERE: the fetch, the per-item cache and the shared in-flight promise. WHAT DOES NOT:
// the clipping (lib/triage/words.ts `threadTail` — pure, so a CLI gate can import it) and the
// rendering (components/thread/source-object-card.tsx — the kit stays presentational).
//
// A FAILURE IS SILENCE, NEVER AN ERROR CARD: a door that does not answer leaves the surface with
// whatever it was already served, which is the deck's own in-flight rule.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { threadTail, type TriageMessage } from '@/lib/triage/words';

/** One file the thread carries, in THE ONE VIEWER's own address shape (the door serves it). */
export type ThreadDoorFile = {
  name: string;
  mime?: string | null;
  size?: number | null;
  ref?: { kind: 'attachment'; path: string } | null;
};

/** What this module keeps of the door's payload — the facts an object card renders. */
export type ThreadDoorData = {
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  /** The tail, already clipped by THE ONE CLIPPER with its honest excerpt marker. */
  tail: TriageMessage[];
  files: ThreadDoorFile[];
};

const EMPTY: ThreadDoorData = { subject: null, fromName: null, fromAddress: null, receivedAt: null, tail: [], files: [] };

const _cache = new Map<string, ThreadDoorData>();
const _flight = new Map<string, Promise<ThreadDoorData>>();

/** What the door serves, narrowed to the fields any consumer here reads. */
type DoorPayload = {
  subject?: string | null; fromName?: string | null; fromAddress?: string | null; receivedAt?: string | null;
  messages?: unknown; attachments?: unknown;
};

function readPayload(d: DoorPayload | null): ThreadDoorData {
  if (!d) return EMPTY;
  const files = Array.isArray(d.attachments) ? (d.attachments as ThreadDoorFile[]).filter((f) => !!f?.name) : [];
  return {
    subject: d.subject ?? null,
    fromName: d.fromName ?? null,
    fromAddress: d.fromAddress ?? null,
    receivedAt: d.receivedAt ?? null,
    tail: threadTail(d.messages as Parameters<typeof threadTail>[0]),
    files,
  };
}

/** THE ONE READ. Cached per item for the session; a second caller joins the first's flight. */
export function loadThreadDoor(itemId: string): Promise<ThreadDoorData> {
  const had = _cache.get(itemId);
  if (had) return Promise.resolve(had);
  const flying = _flight.get(itemId);
  if (flying) return flying;
  const p = fetch(`/api/inbox/${itemId}/thread`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => readPayload(d as DoorPayload | null))
    .catch(() => EMPTY)
    .then((data) => { _cache.set(itemId, data); _flight.delete(itemId); return data; });
  _flight.set(itemId, p);
  return p;
}

/** The tail alone — the deck's own read, unchanged in behaviour and now one implementation. */
export function loadThreadTail(itemId: string): Promise<TriageMessage[]> {
  return loadThreadDoor(itemId).then((d) => d.tail);
}

/** What a surface already holds, for a first paint that never waits (null = never read here). */
export const peekThreadDoor = (itemId: string): ThreadDoorData | null => _cache.get(itemId) ?? null;

/** Warm the next thing the reader is about to meet. Fire-and-forget by construction. */
export function prefetchThreadDoor(itemId: string): void {
  void loadThreadDoor(itemId);
}
