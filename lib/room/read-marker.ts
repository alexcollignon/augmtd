// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READ MARKER — the missing fact behind "it worked while you were away and has something for
// you" (owner, Sep 7; docs/threads-plan.md — the sidebar paragraph "badges are honest or absent"
// and the message-grammar row "Ground move / delta → one appended CoS line").
//
// One fact, three consumers, ZERO AI:
//   1. THE MARKER      — when did this room's owner last SEE its conversation. Stamped at the ONE
//                        serving seam (GET /api/room/turns), in after(), so serving never waits.
//   2. THE BADGE       — /api/rooms/recent counts the LIVE turns newer than the marker that the
//                        user did not write. No marker ⇒ NO count (absent, never "all unread" on
//                        day one — a badge with nothing real behind it is a lying door).
//   3. (THE DELTA      — the reopen line this module used to build: RETIRED by the owner on Sep 14.
//                        See the retirement note at the foot of this file. The marker and the badge
//                        are untouched; only the spoken line is gone.)
//
// NO NEW TABLE: the house store is `item_plans` (kind `room_read`, entity_id = the room key — the
// same key grammar lib/room/turns.ts uses, entity id for project rooms / `<kind>:<id>` for loose
// anchors). The row's UNIQUE (user_id, kind, entity_id) makes the stamp a plain upsert.
//
// CLIENT-SAFE BY CONSTRUCTION: the only import is a TYPE (erased at build), so the pure builder
// below can be imported by the rail — a client component — without dragging the server graph.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export const READ_MARKER_KIND = 'room_read';

// ── THE STAMP GRACE (found live, Sep 7 — the second walk) ──────────────────────────────────────
// The stamp is a side effect of a GET, which made the read NON-IDEMPOTENT: dev StrictMode (and
// any remount/prefetch) double-fetches the serving route — request A consumed the pre-stamp
// marker and was DISCARDED by the effect's alive-cleanup, request B arrived post-stamp and saw
// "nothing new". The badge promised news; the open ate it invisibly. The fix: within a short
// window of a stamp, the SERVE still reads the PRE-open marker (`prevAt`), so every fetch of the
// same open sees the same news — the GET becomes idempotent per open. The sidebar's badge pass
// (readRoomMarkers) deliberately keeps reading the RAW stamp, so the badge clears the moment the
// room serves, grace or not.
export const STAMP_GRACE_MS = 60_000;

type MarkerTasks = { at?: string; prevAt?: string | null; stampedAt?: string };

/** The room's last-seen time FOR THE SERVE: within the grace window of a fresh stamp this is the
 *  PRE-open marker (so a double-fetch of the same open sees the same news); after it, the stamp
 *  itself. Null when the room was never opened. */
export async function readRoomMarker(
  client: SupabaseClient, userId: string, roomKey: string,
): Promise<string | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', READ_MARKER_KIND).eq('entity_id', roomKey).maybeSingle();
    const t = (data?.tasks ?? null) as MarkerTasks | null;
    if (!t) return null;
    const stampedAt = typeof t.stampedAt === 'string' ? Date.parse(t.stampedAt) : NaN;
    const withinGrace = Number.isFinite(stampedAt) && Date.now() - stampedAt < STAMP_GRACE_MS;
    if (withinGrace && typeof t.prevAt === 'string' && t.prevAt) return t.prevAt;
    // Within grace with NO previous marker = the room's true first open — still "no marker".
    if (withinGrace && t.prevAt === null) return null;
    return typeof t.at === 'string' && t.at ? t.at : null;
  } catch { return null; }
}

/** The markers for many rooms in ONE read (the sidebar's badge pass). Rooms never opened are
 *  simply ABSENT from the map — the caller must serve no count for them. */
export async function readRoomMarkers(
  client: SupabaseClient, userId: string, roomKeys: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!roomKeys.length) return out;
  try {
    const { data } = await client.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', READ_MARKER_KIND).in('entity_id', roomKeys);
    for (const r of (data ?? []) as Array<{ entity_id: string; tasks: { at?: string } | null }>) {
      const at = r.tasks?.at;
      if (typeof at === 'string' && at) out.set(r.entity_id, at);
    }
  } catch { /* no markers → no badges; silence is the honest fallback */ }
  return out;
}

/** Stamp "the owner has now seen this room". ONE writer (the serving seam), owner-scoped by the
 *  caller's own RLS client. Non-fatal: a missed stamp costs a repeated delta line, never a break.
 *  THE GRACE HALF: the stamp preserves the PRE-open marker in `prevAt` so re-reads of the same
 *  open keep seeing it — and a re-stamp WITHIN the grace keeps the original `prevAt` (a rapid
 *  double-stamp must not launder the pre-open marker away). */
export async function stampRoomMarker(
  client: SupabaseClient, userId: string, roomKey: string, at: string = new Date().toISOString(),
): Promise<void> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', READ_MARKER_KIND).eq('entity_id', roomKey).maybeSingle();
    const cur = (data?.tasks ?? null) as MarkerTasks | null;
    const curStamped = typeof cur?.stampedAt === 'string' ? Date.parse(cur.stampedAt) : NaN;
    const withinGrace = Number.isFinite(curStamped) && Date.now() - curStamped < STAMP_GRACE_MS;
    const prevAt = withinGrace
      ? (cur?.prevAt ?? null)                       // the same open — keep the original pre-open marker
      : (typeof cur?.at === 'string' && cur.at ? cur.at : null); // a new open — the old stamp becomes "prev"
    await client.from('item_plans').upsert({
      user_id: userId, kind: READ_MARKER_KIND, entity_id: roomKey,
      tasks: { at, prevAt, stampedAt: at } satisfies MarkerTasks, updated_at: at,
    }, { onConflict: 'user_id,kind,entity_id' });
  } catch { /* non-fatal */ }
}

// ── THE REOPEN DELTA IS RETIRED (owner walk, Sep 14) ───────────────────────────────────────────
// "Since you were here — <half a sentence, clipped mid-word>" — his read: confusing, and it does
// not need to be here. The line clipped turns the reader was about to read one line below, so a room whose news
// was a narration said the same thing twice; and its half-sentence clip of a foreign-language turn
// was less legible than the turn itself.
//
// THE BUILDER IS DELETED WITH ITS SEAT, not left as a corpse (the T8.16 precedent): what survives
// is the MARKER and the BADGE above — the project still raises its hand in the sidebar, it just
// does not narrate the raise to a reader who is already in the room. Gates: T11.1–T11.11 stand;
// T11.12–T11.19 retired WITH the claim they checked; T11.20 proves the path is gone.
