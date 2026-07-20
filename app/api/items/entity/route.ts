import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — an item's ENTITY membership (the meetings-page control, generalizable to any item).
//   GET  ?kind=meeting|inbox_item|commitment&id=…  → { entityId, entityName, momentum } | nulls
//   PATCH { kind, id, entityId | null }            → attach (via='user', locked) / detach
// A detach writes a LOCKED NULL link ("the user said none") — recognition's idempotency check finds it
// and never re-links; an attach is equally final. The human's decision outranks the machine, permanently
// (the generalized project_locked). Busts the Home brief cache (membership feeds deck weights).
// ════════════════════════════════════════════════════════════════════════════════════════════════

const KINDS = ['meeting', 'inbox_item', 'commitment'] as const;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || '';
  const id = url.searchParams.get('id') || '';
  const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!KINDS.includes(kind as never) || (!id && !ids.length)) return NextResponse.json({ error: 'kind and id(s) required' }, { status: 400 });
  if (ids.length) {
    // Batch form — { links: { itemId: { entityId, entityName } } } (the meetings sidebar's membership map).
    const { data: links } = await supabase.from('entity_links').select('item_id, entity_id')
      .eq('user_id', user.id).eq('item_kind', kind).in('item_id', ids.slice(0, 300)).not('entity_id', 'is', null);
    const entIds = [...new Set((links ?? []).map((l) => l.entity_id as string))];
    const names = new Map<string, string>();
    if (entIds.length) {
      const { data: ents } = await supabase.from('work_entities').select('id, name').eq('user_id', user.id).in('id', entIds);
      for (const e of (ents ?? []) as Array<{ id: string; name: string }>) names.set(e.id, e.name);
    }
    const out: Record<string, { entityId: string; entityName: string | null }> = {};
    for (const l of (links ?? []) as Array<{ item_id: string; entity_id: string }>) out[l.item_id] = { entityId: l.entity_id, entityName: names.get(l.entity_id) ?? null };
    return NextResponse.json({ links: out });
  }
  const { data: link } = await supabase.from('entity_links').select('entity_id')
    .eq('user_id', user.id).eq('item_kind', kind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle();
  // A meeting's action-item count (for the move-confirmation — "N action items will move with it").
  let commitmentCount = 0;
  if (kind === 'meeting') {
    const { count } = await supabase.from('commitments').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('source', 'meeting').eq('source_id', id);
    commitmentCount = count ?? 0;
  }
  if (!link?.entity_id) return NextResponse.json({ entityId: null, entityName: null, momentum: null, commitmentCount });
  const { data: ent } = await supabase.from('work_entities').select('name, state').eq('id', link.entity_id).eq('user_id', user.id).maybeSingle();
  return NextResponse.json({
    entityId: link.entity_id,
    entityName: (ent as { name?: string } | null)?.name ?? null,
    momentum: ((ent as { state?: { momentum?: string } } | null)?.state?.momentum) ?? null,
    commitmentCount,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json()) as { kind?: string; id?: string; entityId?: string | null };
  if (!KINDS.includes((body.kind ?? '') as never) || !body.id) return NextResponse.json({ error: 'kind and id required' }, { status: 400 });
  let destName: string | null = null;
  if (body.entityId) {
    const { data: ent } = await supabase.from('work_entities').select('id, name').eq('id', body.entityId).eq('user_id', user.id).maybeSingle();
    if (!ent) return NextResponse.json({ error: 'entity not found' }, { status: 404 });
    destName = (ent.name as string) ?? null;
  }
  // Capture the SOURCE entity (before the upsert) — it also needs re-reasoning after losing this item.
  const { data: prevLink } = await supabase.from('entity_links').select('entity_id')
    .eq('user_id', user.id).eq('item_kind', body.kind).eq('item_id', body.id).maybeSingle();
  const srcEntity = (prevLink?.entity_id as string) ?? null;

  await supabase.from('entity_links').upsert(
    { user_id: user.id, entity_id: body.entityId ?? null, item_kind: body.kind, item_id: body.id, via: 'user', locked: true, reason: body.entityId ? 'attached by the user' : 'detached by the user' },
    { onConflict: 'user_id,item_kind,item_id' },
  );
  // PROVENANCE CASCADE — a meeting's action items (commitments) are fragments of it; moving the meeting
  // moves them too (links AND the legacy initiative label so old reads stay consistent), so a manual move
  // can't split a meeting from its own work (the integrity invariant).
  let cascaded = 0;
  if (body.kind === 'meeting') {
    const { data: commits } = await supabase.from('commitments').select('id').eq('user_id', user.id).eq('source', 'meeting').eq('source_id', body.id);
    const cids = (commits ?? []).map((c) => (c as { id: string }).id);
    for (const cid of cids) {
      await supabase.from('entity_links').upsert(
        { user_id: user.id, entity_id: body.entityId ?? null, item_kind: 'commitment', item_id: cid, via: 'user', locked: true, reason: 'moved with its meeting' },
        { onConflict: 'user_id,item_kind,item_id' },
      );
      cascaded++;
    }
    if (cids.length && destName !== undefined) await supabase.from('commitments').update({ initiative: destName }).in('id', cids).eq('user_id', user.id).then(() => {}, () => {});
  }
  supabase.from('profiles').update({ home_brief: null }).eq('id', user.id).then(() => {}, () => {});

  // RECONCILE — both the source AND destination changed: re-reason both brains, recompute their people
  // fingerprints + grounded category, archive an emptied source. Plus audit + a learning signal (a manual
  // move is a correction of recognition). Background, non-fatal — the move already returned committed.
  after(async () => {
    try {
      const { reconcileEntities } = await import('@/lib/entities/reconcile');
      await reconcileEntities(supabase, user.id, [srcEntity, body.entityId ?? null]);
    } catch { /* non-fatal */ }
    try {
      const { logActivity } = await import('@/lib/activity/log');
      await logActivity(supabase, user.id, { type: 'membership_move', title: destName ? `Moved to ${destName}` : 'Removed from project', entityType: body.kind === 'meeting' ? 'meeting' : body.kind, entityId: body.id!, metadata: { from: srcEntity, to: body.entityId ?? null } });
    } catch { /* non-fatal */ }
    supabase.from('learning_signals').insert({ user_id: user.id, inbox_item_id: null, signal_type: 'action_taken', signal_data: { action: 'membership_move', kind: body.kind, to: body.entityId ?? null } }).then(() => {}, () => {});
  });

  return NextResponse.json({ ok: true, cascaded });
}
