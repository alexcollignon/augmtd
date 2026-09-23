// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BRIEF WARM — the room's opening composed BEFORE the click (stabilization W3.7 ROOM SPEED).
//
// Owner: opening an item "ideally would be instantly". W3.5 made the composed brief reach the
// first paint by composing on the room's request path — lawful, but a sig-moved room then made the
// click wait for the model. The fix is WHEN, again: the deck already knows which rooms the reader
// is about to open (the rows it just rendered), so the compose runs THEN, in the background, and
// the click finds the sig standing — ensure* is a no-op and the first paint carries the stored
// composition at once.
//
// THE SAME COMPOSE, NOT A SECOND ONE: this calls the SAME sig-gated ensureRoomBrief /
// ensureLooseRoomBrief the door calls, with the SAME anchor derivation (lib/room/item-anchor), and
// joins any in-flight compose for the room (joinCompose). A warmed room whose sig stood costs its
// grounding reads only; nothing is spent that the open would not have spent.
//
// BOUNDED, by construction:
//   · WARM_MAX_ITEMS rooms per call (the top of what the reader can see — never the whole deck);
//   · items that resolve to the same room (two threads on one deal) warm it once;
//   · a room warmed on this instance within WARM_DEDUPE_MS is skipped (per user) — a Home poll
//     re-rendering the same rows re-warms nothing;
//   · sequential, one room at a time — a warm is background courtesy, never a burst.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { preparedState } from '@/lib/prepare/read';
import { anchorOf, linkKindOf, looseRoomKeyOf, looseTitleOf, ANCHOR_ROW_SELECT } from '@/lib/room/item-anchor';

export const WARM_MAX_ITEMS = 6;
export const WARM_DEDUPE_MS = 3 * 60_000;
export const WARM_KINDS = ['email', 'meeting', 'commitment', 'followup', 'awareness'] as const;
export type WarmItem = { kind: (typeof WARM_KINDS)[number]; id: string };

const _warmedAt = new Map<string, number>();

/** Pure: validate + dedupe + cap a client-supplied list (the route's only trust boundary). */
export function sanitizeWarmItems(raw: unknown): WarmItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WarmItem[] = [];
  for (const r of raw) {
    const kind = (r as { kind?: unknown })?.kind;
    const id = (r as { id?: unknown })?.id;
    if (typeof kind !== 'string' || !(WARM_KINDS as readonly string[]).includes(kind)) continue;
    if (typeof id !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(id)) continue;
    const k = `${linkKindOf(kind)}:${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: kind as WarmItem['kind'], id });
    if (out.length >= WARM_MAX_ITEMS) break;
  }
  return out;
}

/** Was this room warmed on this instance recently? Stamps it when not (the caller is about to). */
function claimWarm(userId: string, roomKey: string, now: number = Date.now()): boolean {
  const k = `${userId}|${roomKey}`;
  const at = _warmedAt.get(k);
  if (at !== undefined && now - at < WARM_DEDUPE_MS) return false;
  _warmedAt.set(k, now);
  if (_warmedAt.size > 2_000) { // bounded memory: drop the oldest half
    const keys = [..._warmedAt.entries()].sort((a, b) => a[1] - b[1]).slice(0, 1_000).map(([key]) => key);
    for (const key of keys) _warmedAt.delete(key);
  }
  return true;
}

/** Warm each item's room opening. Returns what it did, for the log (never silent about skips). */
export async function warmRoomBriefs(
  client: SupabaseClient, userId: string, items: WarmItem[],
): Promise<{ warmed: number; skipped: number; composed: number }> {
  const { ensureLooseRoomBrief, joinCompose } = await import('@/lib/room/brief');
  let warmed = 0; let skipped = 0; let composed = 0;
  const doneRooms = new Set<string>();
  for (const it of items.slice(0, WARM_MAX_ITEMS)) {
    try {
      const linkKind = linkKindOf(it.kind);
      // ONE OBJECT, ONE DOOR (W7.2 — lib/room/door.ts): the item door's brief is ITEM-FIRST under
      // the item's own key whatever it is linked to, so the warm composes exactly that — the link
      // read it used to make (linked → the entity's brief) warmed a page the door no longer serves.
      const roomKey = looseRoomKeyOf(linkKind, it.id);
      if (doneRooms.has(roomKey) || !claimWarm(userId, roomKey)) { skipped++; continue; }
      doneRooms.add(roomKey);
      // The loose anchor, derived EXACTLY as the door derives it — or the sig never matches.
      const table = linkKind === 'inbox_item' ? 'inbox_items' : linkKind === 'commitment' ? 'commitments' : 'meeting_transcripts';
      const [{ data: row }, st] = await Promise.all([
        client.from(table).select(ANCHOR_ROW_SELECT[linkKind]).eq('id', it.id).eq('user_id', userId).maybeSingle(),
        linkKind === 'meeting' ? Promise.resolve(null) : preparedState(client, userId, { kind: linkKind, id: it.id }).catch(() => null),
      ]);
      if (!row) { skipped++; continue; }
      const a = anchorOf(linkKind, row as unknown as Record<string, unknown>, st?.all ?? []);
      const anchorForBrief = { title: looseTitleOf(linkKind, row as unknown as Record<string, unknown>), who: a.who, ask: a.ask, prepared: a.prepared };
      const r = await joinCompose(userId, roomKey, () => ensureLooseRoomBrief(client, userId, roomKey, anchorForBrief));
      warmed++;
      if (r) composed++;
    } catch { skipped++; /* non-fatal — the open composes before its paint as ever */ }
  }
  return { warmed, skipped, composed };
}
