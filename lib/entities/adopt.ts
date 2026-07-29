// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FOUNDING ADOPTION, as ONE lib mechanic (converse arc — extracted verbatim from the adopt
// route so the proposal's BUTTON and a PROSE answer in the room run through the SAME door; the
// route is now a thin wrapper). Absorb → label-era member linking → count → the durable proposal
// turn sheds the taken option → narration → activity. State refresh + brief bust are the CALLER's
// tail (the route uses after(); converse fires-and-forgets).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type AdoptResult = { ok: boolean; targetName?: string; sourceName?: string; total?: number };

export async function adoptEntity(
  supabase: SupabaseClient, userId: string, targetId: string, sourceId: string,
): Promise<AdoptResult> {
  if (!targetId || !sourceId || targetId === sourceId) return { ok: false };
  const { data: target } = await supabase.from('work_entities').select('id, name').eq('id', targetId).eq('user_id', userId).maybeSingle();
  const { data: source } = await supabase.from('work_entities').select('id, name').eq('id', sourceId).eq('user_id', userId).maybeSingle();
  if (!target || !source) return { ok: false };

  const { absorbEntity } = await import('@/lib/entities/reflect');
  const r = await absorbEntity(supabase, userId, targetId, sourceId);
  if (!r.ok) return { ok: false };

  // LABEL-ERA MEMBERS (the iScore class): entities from before the link backfills hold their
  // members as `initiative` strings on items, not links. The user just CONFIRMED this adoption —
  // link those members to the target (only items with NO existing link; never steal from
  // another entity). via 'user' (the confirm), unlocked (reconcile may still refine per-item).
  try {
    const { data: li } = await supabase.from('inbox_items').select('id')
      .eq('user_id', userId).eq('status', 'pending')
      .filter('source_data->understanding->>initiative', 'ilike', source.name as string).limit(60);
    const { data: lc } = await supabase.from('commitments').select('id')
      .eq('user_id', userId).eq('status', 'open').ilike('initiative', source.name as string).limit(60);
    const cands: Array<{ kind: string; id: string }> = [
      ...((li ?? []) as Array<{ id: string }>).map((x) => ({ kind: 'inbox_item', id: x.id })),
      ...((lc ?? []) as Array<{ id: string }>).map((x) => ({ kind: 'commitment', id: x.id })),
    ];
    for (const c of cands) {
      const { data: existing } = await supabase.from('entity_links').select('entity_id')
        .eq('user_id', userId).eq('item_kind', c.kind).eq('item_id', c.id).maybeSingle();
      if (existing && existing.entity_id && existing.entity_id !== targetId) continue; // belongs elsewhere
      await supabase.from('entity_links').upsert(
        { user_id: userId, entity_id: targetId, item_kind: c.kind, item_id: c.id, via: 'user', locked: false, reason: `adopted with ${source.name}` },
        { onConflict: 'user_id,item_kind,item_id' },
      ).then(() => {}, () => {});
    }
  } catch { /* label-era linking is best-effort — the entity merge already landed */ }

  // Count what came along (for the honest result narration).
  const { data: lks } = await supabase.from('entity_links').select('item_id')
    .eq('user_id', userId).eq('entity_id', targetId).limit(200);
  const count = (lks ?? []).length;

  // Update the durable proposal turn: remove the taken option; delete when none remain.
  try {
    const { data: turn } = await supabase.from('room_turns').select('id, component')
      .eq('user_id', userId).eq('room_key', targetId).eq('dedupe_key', 'founding-proposal').maybeSingle();
    if (turn) {
      const comp = (turn.component ?? {}) as { key?: string; state?: { targetId?: string; options?: Array<{ label: string; sourceId: string }> } };
      const left = (comp.state?.options ?? []).filter((o) => o.sourceId !== sourceId);
      if (left.length) {
        await supabase.from('room_turns').update({ component: { ...comp, state: { ...comp.state, options: left } } }).eq('id', turn.id);
      } else {
        await supabase.from('room_turns').delete().eq('id', turn.id);
      }
    }
  } catch { /* non-fatal */ }
  const { writeRoomTurn } = await import('@/lib/room/turns');
  await writeRoomTurn(supabase, userId, targetId, {
    role: 'system',
    text: `Brought "${source.name}" into ${target.name} — everything it held is here now (${count ?? '—'} items total).`,
    dedupeKey: `adopted:${sourceId}`,
  });

  const { logActivity } = await import('@/lib/activity/log');
  await logActivity(supabase, userId, {
    type: 'membership_move', title: `Brought ${source.name} into ${target.name}`,
    entityType: 'work_entity', entityId: targetId, metadata: { adopted: sourceId },
  }).catch(() => {});

  return { ok: true, targetName: String(target.name), sourceName: String(source.name), total: count ?? 0 };
}
