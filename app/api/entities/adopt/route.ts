import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// THE FOUNDING ADOPTION (creation-time recognition — the "first sync", confirmed in the room).
// POST { targetId, sourceId } — the recognized near-name entity FOLDS INTO the user's new project
// via THE ONE absorb mechanic (shared with reflection + the merge click path). Atomic with the
// proposal turn: the taken option is removed from the durable `founding-proposal` component (the
// turn deletes when the last option is taken) and the result is narrated.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { targetId, sourceId } = (await request.json()) as { targetId?: string; sourceId?: string };
    if (!targetId || !sourceId || targetId === sourceId) {
      return NextResponse.json({ error: 'targetId and sourceId required' }, { status: 400 });
    }
    const { data: target } = await supabase.from('work_entities').select('id, name').eq('id', targetId).eq('user_id', user.id).maybeSingle();
    const { data: source } = await supabase.from('work_entities').select('id, name').eq('id', sourceId).eq('user_id', user.id).maybeSingle();
    if (!target || !source) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const { absorbEntity } = await import('@/lib/entities/reflect');
    const r = await absorbEntity(supabase, user.id, targetId, sourceId);
    if (!r.ok) return NextResponse.json({ error: 'merge failed' }, { status: 500 });

    // LABEL-ERA MEMBERS (the iScore class): entities from before the link backfills hold their
    // members as `initiative` strings on items, not links. The user just CONFIRMED this adoption —
    // link those members to the target (only items with NO existing link; never steal from
    // another entity). via 'user' (the confirm), unlocked (reconcile may still refine per-item).
    try {
      const { data: li } = await supabase.from('inbox_items').select('id')
        .eq('user_id', user.id).eq('status', 'pending')
        .filter('source_data->understanding->>initiative', 'ilike', source.name as string).limit(60);
      const { data: lc } = await supabase.from('commitments').select('id')
        .eq('user_id', user.id).eq('status', 'open').ilike('initiative', source.name as string).limit(60);
      const cands: Array<{ kind: string; id: string }> = [
        ...((li ?? []) as Array<{ id: string }>).map((x) => ({ kind: 'inbox_item', id: x.id })),
        ...((lc ?? []) as Array<{ id: string }>).map((x) => ({ kind: 'commitment', id: x.id })),
      ];
      for (const c of cands) {
        const { data: existing } = await supabase.from('entity_links').select('entity_id')
          .eq('user_id', user.id).eq('item_kind', c.kind).eq('item_id', c.id).maybeSingle();
        if (existing && existing.entity_id && existing.entity_id !== targetId) continue; // belongs elsewhere
        await supabase.from('entity_links').upsert(
          { user_id: user.id, entity_id: targetId, item_kind: c.kind, item_id: c.id, via: 'user', locked: false, reason: `adopted with ${source.name}` },
          { onConflict: 'user_id,item_kind,item_id' },
        ).then(() => {}, () => {});
      }
    } catch { /* label-era linking is best-effort — the entity merge already landed */ }

    // Count what came along (for the honest result narration).
    const { data: lks } = await supabase.from('entity_links').select('item_id')
      .eq('user_id', user.id).eq('entity_id', targetId).limit(200);
    const count = (lks ?? []).length;

    // Update the durable proposal turn: remove the taken option; delete when none remain.
    try {
      const { data: turn } = await supabase.from('room_turns').select('id, component')
        .eq('user_id', user.id).eq('room_key', targetId).eq('dedupe_key', 'founding-proposal').maybeSingle();
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
    await writeRoomTurn(supabase, user.id, targetId, {
      role: 'system',
      text: `Brought "${source.name}" into ${target.name} — everything it held is here now (${count ?? '—'} items total).`,
      dedupeKey: `adopted:${sourceId}`,
    });

    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(supabase, user.id, {
      type: 'membership_move', title: `Brought ${source.name} into ${target.name}`,
      entityType: 'work_entity', entityId: targetId, metadata: { adopted: sourceId },
    }).catch(() => {});
    after(async () => {
      try { const { refreshEntityState } = await import('@/lib/entities/state'); await refreshEntityState(supabase, user.id, targetId, { force: true }); } catch { /* non-fatal */ }
      try { const { softBustBrief } = await import('@/lib/home/bust-brief'); await softBustBrief(supabase, user.id); } catch { /* non-fatal */ }
    });
    return NextResponse.json({ ok: true, keptName: target.name, total: count ?? 0 });
  } catch (e) {
    console.error('[entities/adopt]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
