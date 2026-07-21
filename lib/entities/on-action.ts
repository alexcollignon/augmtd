// ════════════════════════════════════════════════════════════════════════════════════════════════
// ACTION EVENTS (Living-Home L2, docs/living-home-plan.md) — the brain HEARS user actions. Before this,
// dismiss/done/send updated only the row's status: the entity whose state said "you owe them X" kept
// saying it until the next email happened to change its ledger. Now every action on a LINKED item:
//   1. re-synthesizes that ONE entity's state (force — the reasoned pass sees the resolution-marked
//      ledger line and can flip whoOwes / next_move / priority),
//   2. busts the Home brief cache (the invariant: any write changing what the Home derives busts it).
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
): Promise<void> {
  try {
    const { data: link } = await supabase.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', item.kind).eq('item_id', item.id).not('entity_id', 'is', null).maybeSingle();
    if (link?.entity_id) {
      await refreshEntityState(supabase, userId, link.entity_id as string, { force: true }).catch(() => {});
    }
    // Bust the brief cache even for unlinked items — the action changed the deck either way.
    await supabase.from('profiles').update({ home_brief: null }).eq('id', userId).then(() => {}, () => {});
  } catch { /* non-fatal */ }
}
