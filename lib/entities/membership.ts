// ════════════════════════════════════════════════════════════════════════════════════════════════
// ITEM ↔ ENTITY MEMBERSHIP — the ONE write path for a human membership decision (projecthood-plan
// P4). Extracted from the /api/items/entity PATCH so the route AND the registry capability
// (move_item_to_project, reachable from every chat surface) share it: locked link (human outranks the
// machine, permanently), the meeting→commitments provenance cascade, both-sides reconcile, activity
// log + learning signal, brief-cache bust. Fire-and-forget tails are awaited HERE when `inline` is
// set (executors run outside a request's after()).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type MembershipKind = 'meeting' | 'inbox_item' | 'commitment';

export async function setItemMembership(
  supabase: SupabaseClient, userId: string,
  args: { kind: MembershipKind; id: string; entityId: string | null },
  opts: { inline?: boolean } = {},
): Promise<{ ok: boolean; cascaded: number; destName: string | null; srcEntity: string | null; error?: string; runTails?: () => Promise<void> }> {
  let destName: string | null = null;
  if (args.entityId) {
    const { data: ent } = await supabase.from('work_entities').select('id, name').eq('id', args.entityId).eq('user_id', userId).maybeSingle();
    if (!ent) return { ok: false, cascaded: 0, destName: null, srcEntity: null, error: 'entity not found' };
    destName = (ent.name as string) ?? null;
  }
  // Capture the SOURCE entity (before the upsert) — it also needs re-reasoning after losing this item.
  const { data: prevLink } = await supabase.from('entity_links').select('entity_id')
    .eq('user_id', userId).eq('item_kind', args.kind).eq('item_id', args.id).maybeSingle();
  const srcEntity = (prevLink?.entity_id as string) ?? null;

  await supabase.from('entity_links').upsert(
    { user_id: userId, entity_id: args.entityId ?? null, item_kind: args.kind, item_id: args.id, via: 'user', locked: true, reason: args.entityId ? 'attached by the user' : 'detached by the user' },
    { onConflict: 'user_id,item_kind,item_id' },
  );
  // PROVENANCE CASCADE — a meeting's action items (commitments) are fragments of it; moving the meeting
  // moves them too (links AND the legacy initiative label so old reads stay consistent), so a manual move
  // can't split a meeting from its own work (the integrity invariant).
  let cascaded = 0;
  if (args.kind === 'meeting') {
    const { data: commits } = await supabase.from('commitments').select('id').eq('user_id', userId).eq('source', 'meeting').eq('source_id', args.id);
    const cids = (commits ?? []).map((c) => (c as { id: string }).id);
    for (const cid of cids) {
      await supabase.from('entity_links').upsert(
        { user_id: userId, entity_id: args.entityId ?? null, item_kind: 'commitment', item_id: cid, via: 'user', locked: true, reason: 'moved with its meeting' },
        { onConflict: 'user_id,item_kind,item_id' },
      );
      cascaded++;
    }
    if (cids.length) await supabase.from('commitments').update({ initiative: destName }).in('id', cids).eq('user_id', userId).then(() => {}, () => {});
  }
  import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, userId)).catch(() => {});

  // ── CORRECTION CASCADE (promise fix): the CONVERSATION follows the membership. Engine turns
  // about THIS item (prep/delegate/verdict narrations, keyed by dedupe) re-home from the old room
  // to the item's new one — a wrongly-grouped item's story never keeps haunting the wrong deal.
  // User-authored turns stay where they were said (they carry no item provenance). Non-fatal.
  try {
    const { looseRoomKey } = await import('@/lib/room/turns');
    const turnItemKind = args.kind === 'inbox_item' ? 'inbox' as const : args.kind === 'commitment' ? 'commitment' as const : 'meeting' as const;
    const newRoomKey = args.entityId ?? looseRoomKey(turnItemKind, args.id);
    const keys = [`prep:inbox:${args.id}`, `prep:commit:${args.id}`, `verdict-resolve:inbox:${args.id}`, `verdict-resolve:commitment:${args.id}`];
    await supabase.from('room_turns').update({ room_key: newRoomKey }).eq('user_id', userId).in('dedupe_key', keys).then(() => {}, () => {});
    await supabase.from('room_turns').update({ room_key: newRoomKey }).eq('user_id', userId).like('dedupe_key', `delegate:${args.id}:%`).then(() => {}, () => {});
  } catch { /* non-fatal */ }

  const tails = async () => {
    try {
      const { reconcileEntities } = await import('@/lib/entities/reconcile');
      await reconcileEntities(supabase, userId, [srcEntity, args.entityId ?? null]);
    } catch { /* non-fatal */ }
    try {
      const { logActivity } = await import('@/lib/activity/log');
      // entityType 'membership' + composite id → the Activity log's Undo can route this to the
      // membership restore case (S6); metadata.from is what undo restores to.
      await logActivity(supabase, userId, { type: 'membership_move', title: destName ? `Moved to ${destName}` : 'Removed from project', entityType: 'membership', entityId: `${args.kind}:${args.id}`, metadata: { from: srcEntity, to: args.entityId ?? null, kind: args.kind } });
    } catch { /* non-fatal */ }
    await supabase.from('learning_signals').insert({ user_id: userId, inbox_item_id: null, signal_type: 'action_taken', signal_data: { action: 'membership_move', kind: args.kind, to: args.entityId ?? null } }).then(() => {}, () => {});
  };
  if (opts.inline) { await tails(); return { ok: true, cascaded, destName, srcEntity }; }
  // Route context: the caller schedules the tails via next/server after() (runTails) — background,
  // non-fatal, but guaranteed a live function to run in.
  return { ok: true, cascaded, destName, srcEntity, runTails: tails };
}
