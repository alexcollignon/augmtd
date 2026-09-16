'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROOM WARM — ONE implementation, every door that points at a project room
// ════════════════════════════════════════════════════════════════════════════════════════════════
// (instant-load doctrine, owner Aug 7 — "should be instant"; owner walk Sep 7 — "clicking across
// projects takes so long"): hovering a project row prefetches the room's two payloads into the
// SAME LS keys the room hydrates from — a first open paints from cache like every later one.
//
// POLITE by design (the Aug 7 contention lesson — a hover sweep across rows fired N heavy requests
// that queued the whole DB): 160ms hover intent before anything fires, and warms run ONE at a time
// through a serial queue.
//
// WHY IT LIVES HERE and not in the room component: the sidebar's project rows warm too, and the
// sidebar mounts in the app layout — importing the whole EntityRoom to reach two functions would
// drag the room's chunk onto every page. `components/entities/entity-room` re-exports these, so
// there is still exactly ONE warm, at one address.

// THE WARM MUST FILL THE ENVELOPE THE MOUNT READS. These are the room's own two LS keys, read by
// the mount effect under `ROOM_CACHE_MAX_AGE_MS`; a warm that heated anything else would be a warm
// the click never sees. The freshness floor is imported, never re-stated — one number, one law.
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ROOM_CACHE_MAX_AGE_MS } from '@/lib/room/no-mutation';

// ── THE SHAPE RIDES THE KEY (owner-walk find, Sep 14) ─────────────────────────────────────────
// The room paints from its cache and — by the no-mutation law — does NOT swap the landing payload
// in underneath the reader; the fresh one is the NEXT open's first paint. That is right for
// CONTENT and wrong for SHAPE: when the served row grows a field the render now decides on
// (`preparedKind`, which says whether a prepared row arrives as its card), a warm room's first
// open paints a payload that structurally cannot answer the question — so the very first click
// after a deploy behaved differently from every click after it. A stale-shape open is not a
// freshness problem to tune; it is a key problem. BUMP THIS whenever a room payload's SHAPE
// changes: every old envelope becomes unreadable by construction, and there is no transitional
// window in which a surface reasons over a payload that predates its own law.
const ROOM_CACHE_SHAPE = 'v2';
export const roomDetailKey = (entityId: string) => `aug-entity-detail-${ROOM_CACHE_SHAPE}-${entityId}`;
export const roomRailKey = (entityId: string) => `aug-entity-rail-${ROOM_CACHE_SHAPE}-${entityId}`;
/** The room's CONVERSATION envelope. Keyed by the ROOM key (the entity id for a deal room,
 *  `<kind>:<id>` for a loose one — lib/room/turns.ts `looseRoomKey`), because the rail keys its
 *  turns that way and THE WARM MUST FILL THE ENVELOPE THE MOUNT READS. One producer, imported by
 *  both sides: a warm writing a key the mount never looks at is the fake-warm class. */
export const roomTurnsKey = (roomKey: string) => `aug-room-turns-${roomKey}`;

// A WARM EXPIRES WITH WHAT IT WARMED (found by reading, Sep 8): `roomWarmed` was a permanent set —
// a room hovered once at 09:00 was never warmed again, so by 09:20 its envelope had aged past the
// freshness floor and the click paid the FULL cold cost while the warm believed its job was done.
// The warm now re-fires once the cached payload is past half its life: still one warm per room per
// window (never a hover storm), but the envelope the click reads is always paintable.
const WARM_TTL_MS = ROOM_CACHE_MAX_AGE_MS / 2;

const roomWarmed = new Map<string, number>();

/** Does this room already hold a payload fresh enough to PAINT and young enough not to re-warm? */
function warmIsFresh(entityId: string): boolean {
  const at = roomWarmed.get(entityId);
  if (at !== undefined && Date.now() - at < WARM_TTL_MS) return true;
  // Someone else may have filled the envelope (the room's own mount/refresh writes the same keys) —
  // honour that, so navigating back to a just-visited room re-fetches nothing.
  const cached = loadLS<unknown>(roomDetailKey(entityId), { maxAgeMs: WARM_TTL_MS });
  const cachedRail = loadLS<unknown>(roomRailKey(entityId), { maxAgeMs: WARM_TTL_MS });
  return !!cached && !!cachedRail;
}

const warmQueue: string[] = [];
let warmRunning = false;
const warmTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function drainWarmQueue(): Promise<void> {
  if (warmRunning) return;
  warmRunning = true;
  try {
    while (warmQueue.length) {
      const entityId = warmQueue.shift()!;
      await Promise.all([
        fetch(`/api/entities/${entityId}/detail`).then((r) => r.json())
          .then((d) => { if (d?.entity) saveLS(roomDetailKey(entityId), d); }).catch(() => {}),
        fetch(`/api/entities/${entityId}/room`).then((r) => r.json())
          .then((d) => { if (d?.entity) saveLS(roomRailKey(entityId), d); }).catch(() => {}),
        // THE CONVERSATION WARMS TOO (Sep 8): the rail used to fetch its turns only AFTER mount,
        // strictly after /room returned — a waterfall whose second leg the reader watched as an
        // empty column under a painted brief. The warm fills the SAME envelope the mount hydrates
        // from (roomTurnsKey), so a hovered room opens with its conversation already on screen.
        //
        // `peek=1` IS LOAD-BEARING: the turns door STAMPS the room's read marker when it serves,
        // and a hover is not a visit — without peek, warming a room the reader never opened would
        // silently eat their "since you were here" line. The peek serves the same turns and
        // stamps nothing.
        //
        // The envelope carries TURNS ONLY, never `readAt`: the delta line has exactly ONE source,
        // the live response's atomic pair (the frozen-marker law) — a cached marker could never
        // race it, because it is never stored.
        fetch(`/api/room/turns?key=${encodeURIComponent(entityId)}&peek=1`).then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (Array.isArray(d?.turns)) saveLS(roomTurnsKey(entityId), { turns: d.turns }); }).catch(() => {}),
      ]);
      // Stamp AFTER the payloads landed — a warm that failed must be retryable on the next hover,
      // never recorded as done (the deliver-cursor lesson: never advance past uncommitted work).
      roomWarmed.set(entityId, Date.now());
    }
  } finally { warmRunning = false; }
}

export function warmEntityRoom(entityId: string): void {
  if (warmIsFresh(entityId) || warmTimers.has(entityId) || warmQueue.includes(entityId)) return;
  warmTimers.set(entityId, setTimeout(() => {
    warmTimers.delete(entityId);
    if (warmIsFresh(entityId) || warmQueue.includes(entityId)) return;
    warmQueue.push(entityId);
    void drainWarmQueue();
  }, 160));
}

export function cancelWarmEntityRoom(entityId: string): void {
  const t = warmTimers.get(entityId);
  if (t) { clearTimeout(t); warmTimers.delete(entityId); }
}
