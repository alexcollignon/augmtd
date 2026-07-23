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
  } catch { /* non-fatal */ }
}
