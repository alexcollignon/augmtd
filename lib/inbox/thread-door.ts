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
import { decodeEntities } from '@/lib/core/text';
import { isEventSpec } from '@/lib/present/event';
import type { InviteObject } from '@/lib/present/invite-object';

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
  /** INVITES ARE EVENTS (W7.4): the meeting this item IS, when it is an invitation — served by the
   *  door (lib/present/invite-object.ts), validated here. Null = ordinary mail. */
  invite: InviteObject | null;
};

const EMPTY: ThreadDoorData = { subject: null, fromName: null, fromAddress: null, receivedAt: null, tail: [], files: [], invite: null };

/** A served invite object survives only whole: a spec must pass the event guard, a card must carry
 *  a title. Anything else reads as "not an invite" — the mail renders, never a broken card. */
export function readInviteObject(v: unknown): InviteObject | null {
  const o = v as InviteObject | null;
  if (!o || typeof o !== 'object') return null;
  const spec = o.spec && isEventSpec(o.spec) ? o.spec : null;
  const card = o.card && typeof o.card.title === 'string' && o.card.title ? o.card : null;
  if (!spec && !card) return null;
  return { cancelled: o.cancelled === true, spec, card };
}

/** What the door serves, narrowed to the fields any consumer here reads. */
type DoorPayload = {
  subject?: string | null; fromName?: string | null; fromAddress?: string | null; receivedAt?: string | null;
  messages?: unknown; attachments?: unknown; invite?: unknown;
};

function readPayload(d: DoorPayload | null): ThreadDoorData {
  if (!d) return EMPTY;
  const files = Array.isArray(d.attachments) ? (d.attachments as ThreadDoorFile[]).filter((f) => !!f?.name) : [];
  return {
    // Plain text for every card that reads it (W5b) — the tail is decoded inside threadTail.
    subject: d.subject ? decodeEntities(d.subject) : null,
    fromName: d.fromName ? decodeEntities(d.fromName) : null,
    fromAddress: d.fromAddress ?? null,
    receivedAt: d.receivedAt ?? null,
    tail: threadTail(d.messages as Parameters<typeof threadTail>[0]),
    files,
    invite: readInviteObject(d.invite),
  };
}

// ── ONE READ, TWO SHAPES (W3.7 ROOM SPEED) ─────────────────────────────────────────────────────
// The deep-dive's email room needs the door's WHOLE payload (every message, the relevance, the
// attachments) while the object card needs the narrowed facts — and each used to fetch it for
// itself: the same `/api/inbox/<id>/thread` twice on every open. Now there is ONE raw read per item
// (cached + in-flight shared), and the narrowed door data is DERIVED from it. Whoever asks first
// pays; everyone else joins.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ThreadRawPayload = Record<string, any>;
type RawEntry = { d: ThreadRawPayload | null; at: number };
const _raw = new Map<string, RawEntry>();
const _rawFlight = new Map<string, Promise<ThreadRawPayload | null>>();
const _cache = new Map<string, ThreadDoorData>();

function fetchRaw(itemId: string): Promise<ThreadRawPayload | null> {
  const flying = _rawFlight.get(itemId);
  if (flying) return flying;
  const p = fetch(`/api/inbox/${itemId}/thread`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d: ThreadRawPayload | null) => {
      _raw.set(itemId, { d, at: Date.now() });
      _cache.set(itemId, readPayload(d as DoorPayload | null));
      _rawFlight.delete(itemId);
      return d;
    });
  _rawFlight.set(itemId, p);
  return p;
}

/** THE WHOLE PAYLOAD, read once. `maxAgeMs` is the caller's freshness demand: an ACTION surface (the
 *  deep-dive, which replies to this thread) asks for a read no older than the open; a read already
 *  in flight always satisfies it (it started at most a moment ago). Null = the door did not answer. */
export function loadThreadRaw(itemId: string, opts: { maxAgeMs?: number } = {}): Promise<ThreadRawPayload | null> {
  const flying = _rawFlight.get(itemId);
  if (flying) return flying;
  const had = _raw.get(itemId);
  if (had && had.d && (opts.maxAgeMs === undefined || Date.now() - had.at < opts.maxAgeMs)) return Promise.resolve(had.d);
  return fetchRaw(itemId);
}

/** THE ONE READ. Cached per item for the session; a second caller joins the first's flight. */
export function loadThreadDoor(itemId: string): Promise<ThreadDoorData> {
  const had = _cache.get(itemId);
  if (had) return Promise.resolve(had);
  return loadThreadRaw(itemId).then(() => _cache.get(itemId) ?? EMPTY);
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
