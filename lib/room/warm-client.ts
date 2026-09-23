'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM ROOM, WARM BEFORE THE CLICK — the client half (stabilization W3.7 ROOM SPEED).
//
// Owner: opening an item "ideally would be instantly". Two warms, one module:
//
//  1. THE BRIEF WARM (`queueBriefWarm`) — every deck row that MOUNTS queues its href; one debounced
//     POST /api/items/warm carries the first WARM_MAX_ITEMS (the rows the reader can see first).
//     The server composes those rooms' openings in the background, so the click finds the sig
//     standing and the view door serves the stored composition inside its paint budget.
//  2. THE VIEW WARM (`prefetchItemView`) — hover/focus intent on a row fetches the room's ONE outcome
//     read (GET /api/items/view) into the SAME cache key the deep-dive paints from (`itemViewKey` —
//     one producer, imported by both sides: a warm writing a key the mount never reads is the
//     fake-warm class). The open JOINS a warm still in flight (`fetchItemView`) — never a second
//     request for the same room.
//
// POLITE by design (the Aug 7 contention lesson): the view warm waits 150ms of hover intent, runs
// ONE at a time, and never re-warms a view whose cache is still inside half its freshness window.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ROOM_CACHE_MAX_AGE_MS } from '@/lib/room/no-mutation';

export type ItemViewKind = 'email' | 'meeting' | 'commitment' | 'followup' | 'awareness';

/** THE ONE CACHE KEY the deep-dive's view hydrates from (item-detail `useItemView`). */
export const itemViewKey = (kind: ItemViewKind, id: string) => `aug-item-view-${kind}-${id}`;

/** An `/item/<id>?kind=…` href → the view the deep-dive will read for it (kind absent → email). */
export function viewTargetOf(href: string | null | undefined): { kind: ItemViewKind; id: string } | null {
  if (!href) return null;
  const m = href.match(/\/item\/([^/?#]+)/);
  if (!m) return null;
  const k = new URLSearchParams(href.split('?')[1] || '').get('kind') || 'email';
  // The deep-dive mounts MeetingDetail / CommitmentDetail / FollowUpDetail for those kinds and
  // EmailDetail for everything else — whose view key is 'email'.
  const kind: ItemViewKind = k === 'meeting' || k === 'commitment' || k === 'followup' ? k : 'email';
  return { kind, id: m[1] };
}

// ── THE ONE VIEW FLIGHT — a hover warm and the open share one request ───────────────────────────
// W8.4 · A HOVER WARM IS ZERO-AI: a warm flight asks the door with `&warm=1` (a pure read — the door
// schedules no compose, no recognition, no re-prepare trip). An OPEN that joins a warm still in
// flight paints from it and posts ONE kick to the budgeted warm door (`kickOpenedItem`), so the open's
// background work still runs exactly once — never on the hover alone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViewPayload = Record<string, any>;
type ViewFlight = { p: Promise<ViewPayload | null>; warm: boolean };
const _viewFlight = new Map<string, ViewFlight>();

/** The open's background work, for an open that joined a hover warm (lib/room/open-kicks.ts). */
export function kickOpenedItem(kind: ItemViewKind, id: string): void {
  try {
    void fetch('/api/items/warm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ kind, id }], open: true }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* non-fatal — the next open schedules it */ }
}

// ── W11.4 THE ITEM OPENS NOW — the open's read starts AT THE CLICK ───────────────────────────────
// The route's loading frame (app/(main)/@modal/(.)item/[id]/loading.tsx → components/home/
// item-open-frame.tsx) paints the room's frame the instant the address changes and STARTS the open's
// reads right there — before the route's server segment and the deep-dive's chunk have arrived. The
// deep-dive mounting a moment later must not ask again: while the frame's flight is in the air it
// JOINS it (as ever); once it has LANDED, the open takes that landing ONCE, inside OPEN_HANDOFF_MS
// (the frame → mount gap), instead of a second request. Consumed on use: a later open reads afresh.
export const OPEN_HANDOFF_MS = 5_000;
type Landed = { at: number; d: ViewPayload };
const _openLanded = new Map<string, Landed>();
const takeLanded = (m: Map<string, Landed>, key: string): ViewPayload | null => {
  const l = m.get(key);
  if (!l) return null;
  m.delete(key);
  return Date.now() - l.at <= OPEN_HANDOFF_MS ? l.d : null;
};

/** GET the room's outcome read; a caller arriving while one is in flight JOINS it. Writes the cache
 *  (the next open's first paint) on every successful landing. `warm` = a hover/intent prefetch. */
export function fetchItemView(kind: ItemViewKind, id: string, opts: { warm?: boolean } = {}): Promise<ViewPayload | null> {
  const key = itemViewKey(kind, id);
  const flying = _viewFlight.get(key);
  if (flying) {
    // The open joined a warm: the warm read no AI, so the open kicks its own work — once.
    if (!opts.warm && flying.warm) { flying.warm = false; kickOpenedItem(kind, id); }
    return flying.p;
  }
  // An OPEN whose frame already landed this open's read takes it (one request per open, W11.4).
  if (!opts.warm) {
    const landed = takeLanded(_openLanded, key);
    if (landed) return Promise.resolve(landed);
  }
  const flight: ViewFlight = { p: Promise.resolve(null), warm: !!opts.warm };
  flight.p = fetch(`/api/items/view?kind=${kind}&id=${id}${opts.warm ? '&warm=1' : ''}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: ViewPayload | null) => {
      if (!d || d.error) return null;
      try { saveLS(key, d); } catch { /* private mode */ }
      // Only an OPEN's landing (a real open, or a warm an open joined) is handed to the mount.
      if (!flight.warm) _openLanded.set(key, { at: Date.now(), d });
      return d;
    })
    .catch(() => null)
    .finally(() => { _viewFlight.delete(key); });
  _viewFlight.set(key, flight);
  return flight.p;
}

/** The open's view read, settled — the deep-dive's AFTER-PAINT enrichments (the judge) wait on it,
 *  bounded, so they never compete with the first paint's one read. Resolves at once with none. */
export function viewSettled(kind: ItemViewKind, id: string, capMs = 2_500): Promise<void> {
  const flying = _viewFlight.get(itemViewKey(kind, id));
  if (!flying) return Promise.resolve();
  return Promise.race([flying.p.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, capMs))]);
}

// THE OPEN'S OBJECT READ (the commitment door's facts) — the same one-flight + one-handoff shape,
// keyed by URL; writes the kind's instant-load cache key on landing (the hover warm's key).
const _objFlight = new Map<string, Promise<ViewPayload | null>>();
const _objLanded = new Map<string, Landed>();
export function fetchOpenObject(url: string, lsKey: string): Promise<ViewPayload | null> {
  const flying = _objFlight.get(url);
  if (flying) return flying;
  const landed = takeLanded(_objLanded, url);
  if (landed) return Promise.resolve(landed);
  const p = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: ViewPayload | null) => {
      if (!d || d.error) return null;
      try { saveLS(lsKey, d); } catch { /* private mode */ }
      _objLanded.set(url, { at: Date.now(), d });
      return d;
    })
    .catch(() => null)
    .finally(() => { _objFlight.delete(url); });
  _objFlight.set(url, p);
  return p;
}

const VIEW_WARM_TTL_MS = ROOM_CACHE_MAX_AGE_MS / 2;
const _viewWarmTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _viewQueue: Array<{ kind: ItemViewKind; id: string }> = [];
let _viewDraining = false;

async function drainViewQueue(): Promise<void> {
  if (_viewDraining) return;
  _viewDraining = true;
  try {
    while (_viewQueue.length) {
      const t = _viewQueue.shift()!;
      if (loadLS(itemViewKey(t.kind, t.id), { maxAgeMs: VIEW_WARM_TTL_MS }) != null) continue;
      await fetchItemView(t.kind, t.id, { warm: true });
    }
  } finally { _viewDraining = false; }
}

/** Hover/focus intent → warm the room's view. `immediate` (mousedown/touch) skips the intent wait:
 *  the click is coming, and the open will join this flight. */
export function prefetchItemView(href: string | null | undefined, opts: { immediate?: boolean } = {}): void {
  const t = viewTargetOf(href);
  if (!t) return;
  const key = itemViewKey(t.kind, t.id);
  if (_viewFlight.has(key) || _viewWarmTimers.has(key)) return;
  if (loadLS(key, { maxAgeMs: VIEW_WARM_TTL_MS }) != null) return; // still fresh — nothing to warm
  if (opts.immediate) { void fetchItemView(t.kind, t.id, { warm: true }); return; }
  _viewWarmTimers.set(key, setTimeout(() => {
    _viewWarmTimers.delete(key);
    if (_viewQueue.some((q) => itemViewKey(q.kind, q.id) === key)) return;
    _viewQueue.push(t);
    void drainViewQueue();
  }, 150));
}

// ── THE BRIEF WARM — rows queue as they mount; one debounced POST carries the first few ─────────
/** Mirrors lib/room/warm-briefs.ts WARM_MAX_ITEMS (the server caps again — this is courtesy). */
export const BRIEF_WARM_BATCH = 6;
/** A room warmed from this tab is not re-queued inside this window (the Home's 90s poll re-renders
 *  the same rows; the server's sig gate would no-op them anyway, but the request itself is waste). */
export const BRIEF_WARM_TTL_MS = 10 * 60_000;
const _briefWarmedAt = new Map<string, number>();
let _briefBatch: Array<{ kind: ItemViewKind; id: string }> = [];
let _briefTimer: ReturnType<typeof setTimeout> | null = null;

function flushBriefWarm(): void {
  _briefTimer = null;
  const batch = _briefBatch.slice(0, BRIEF_WARM_BATCH);
  _briefBatch = [];
  if (!batch.length) return;
  try {
    void fetch('/api/items/warm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: batch }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* non-fatal — the open composes before its paint as ever */ }
}

/** A deck row mounted: queue its room for the background brief warm. Rows mount in deck order, so
 *  the batch holds the TOP of what the reader sees; everything past the batch waits for its hover. */
export function queueBriefWarm(href: string | null | undefined): void {
  const t = viewTargetOf(href);
  if (!t) return;
  const k = `${t.kind}:${t.id}`;
  const now = Date.now();
  const at = _briefWarmedAt.get(k);
  if (at !== undefined && now - at < BRIEF_WARM_TTL_MS) return;
  if (_briefBatch.length >= BRIEF_WARM_BATCH) return; // this render's batch is full
  _briefWarmedAt.set(k, now);
  _briefBatch.push(t);
  if (!_briefTimer) _briefTimer = setTimeout(flushBriefWarm, 400);
}
