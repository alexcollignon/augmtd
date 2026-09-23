// ════════════════════════════════════════════════════════════════════════════════════════════════
// ACTION EVENTS (Living-Home L2, docs/living-home-plan.md) — the brain HEARS user actions. Before this,
// dismiss/done/send updated only the row's status: the entity whose state said "you owe them X" kept
// saying it until the next email happened to change its ledger. Now every action on a LINKED item:
//   1. re-synthesizes that ONE entity's state (force — the reasoned pass sees the resolution-marked
//      ledger line and can flip whoOwes / next_move / priority).
// NOTE (P0 perf): this deliberately does NOT null the home_brief cache anymore. The brief's `sig` is
// computed from live counts + freshest timestamps every request, so an action that changes the deck
// changes the sig NATURALLY — nulling the blob only destroyed the last-good content (forcing a cold
// path + a full AI tail on EVERY dismiss/done, the "cache never warm" bug behind the 100s loads).
//
// THE DEED MOVES THE BRIEF (owner walk, Sep 8 — the stale room). The action seam gained step 2:
//   2. RECOMPOSE THE ROOM'S OPENING. The pinned brief is the room's one voice about where the work
//      stands; a deed done through a card left it standing as a lie ("you haven't sent the link
//      yet") because the only recompose seam was `after()` on the NEXT room-door GET. The brain
//      hears the action HERE, so the room's opening is re-authored HERE — every caller of this
//      function (send-reply, the invite/forward commit door, commitment done/dismiss, restore, the
//      chat item verbs) inherits it, and no door has to remember to bust a cache.
// Fire-and-forget from the action endpoints' after() — non-fatal, no user-visible latency. Unlinked
// items (or refusals) are a cheap no-op.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshEntityState } from './state';

export type ActionItemKind = 'inbox_item' | 'commitment';

export async function noteItemAction(
  supabase: SupabaseClient,
  userId: string,
  item: { kind: ActionItemKind; id: string },
  /** THE DEED SPEAKS (the no-mutation law's own escape: "or arrives as an APPENDED message"). A
   *  send passes the one line the room should carry — a muted event line, no author, keyed so a
   *  client that already narrated the same deed collapses onto it instead of doubling. */
  opts?: { said?: string | null },
): Promise<void> {
  try {
    const { data: link } = await supabase.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', item.kind).eq('item_id', item.id).not('entity_id', 'is', null).maybeSingle();
    const entityId = (link?.entity_id as string) ?? null;
    if (entityId) {
      await refreshEntityState(supabase, userId, entityId, { force: true }).catch(() => {});
    }
    // ONE OBJECT, ONE DOOR (W7.2 — lib/room/door.ts): the item's deed is recorded in the ITEM's
    // own room, whatever it is linked to (the entity id used to win here, so a deed on a member
    // narrated into a machine container's room and the item's own door never heard it).
    const { looseRoomKey } = await import('@/lib/room/turns');
    const roomKey = looseRoomKey(item.kind === 'commitment' ? 'commitment' : 'inbox', item.id);
    if (opts?.said?.trim()) {
      const { writeRoomTurn } = await import('@/lib/room/turns');
      await writeRoomTurn(supabase, userId, roomKey, {
        role: 'system', text: opts.said.trim().slice(0, 200),
        // No author: THE ONE-NARRATOR LAW — a deed record is the chief of staff's voice, which
        // renders as the muted event line, never a coworker bubble.
        dedupeKey: `sent:${item.id}`,
      }).catch(() => {});
    }
    // THE BRIEF IS RE-AUTHORED ON THE DEED, not one open later. The ITEM door's brief has no single
    // anchor here, so its stored sig is voided and its own door recomposes on the next open —
    // last-good text is never destroyed. A TRACKED project's own door composes for real (it has
    // the whole grounding); an untracked container's door is the machine's, rarely opened, and
    // never paid for on every deed of its ~1,400 members.
    const brief = await import('@/lib/room/brief');
    await brief.invalidateRoomBriefSig(supabase, userId, roomKey).catch(() => {});
    if (entityId) {
      const { data: ent } = await supabase.from('work_entities').select('tracked').eq('id', entityId).eq('user_id', userId).maybeSingle();
      if (ent?.tracked === true) await brief.ensureRoomBrief(supabase, userId, entityId).catch(() => {});
    }
  } catch { /* non-fatal */ }
}
