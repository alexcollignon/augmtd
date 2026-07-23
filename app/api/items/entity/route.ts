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
  // THE ONE membership write (lib/entities/membership.ts) — shared with the move_item_to_project
  // capability so a chat command and this route can never behave differently. Reconcile/log/signal
  // tails run inline within the request's after().
  const { setItemMembership } = await import('@/lib/entities/membership');
  const r = await setItemMembership(supabase, user.id, { kind: body.kind as 'meeting' | 'inbox_item' | 'commitment', id: body.id, entityId: body.entityId ?? null }, { inline: false });
  if (!r.ok) return NextResponse.json({ error: r.error ?? 'failed' }, { status: r.error === 'entity not found' ? 404 : 500 });
  if (r.runTails) after(r.runTails); // reconcile both sides + activity log + learning signal, backgrounded
  return NextResponse.json({ ok: true, cascaded: r.cascaded });
}
