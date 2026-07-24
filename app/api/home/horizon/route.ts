import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// GET /api/home/horizon — the COMING-UP lane (workbench B3b): the next 14 days of calendar,
// deterministic assembly. "To prep" = events LINKED to a deal (the entity link IS the signal it's
// work-relevant); "this week" = everything. Zero AI; the room is one tap away via the deal.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const floor = now.toISOString();
    const ceil = new Date(now.getTime() + 14 * 86_400_000).toISOString();
    const { data: evs } = await supabase.from('calendar_events')
      .select('id, title, start_time, attendees')
      .eq('user_id', user.id).gte('start_time', floor).lte('start_time', ceil)
      .order('start_time', { ascending: true }).limit(60);
    const rows = ((evs ?? []) as Array<Record<string, unknown>>).map((e) => ({
      id: e.id as string, title: String(e.title || 'Meeting'), start: String(e.start_time),
      attendees: Array.isArray(e.attendees) ? (e.attendees as unknown[]).length : 0,
    }));

    // Deal links — which upcoming meetings belong to a body of work.
    const entityByEvent = new Map<string, { id: string; name: string }>();
    if (rows.length) {
      const { data: links } = await supabase.from('entity_links').select('item_id, entity_id')
        .eq('user_id', user.id).eq('item_kind', 'calendar_event').in('item_id', rows.map((r) => r.id)).not('entity_id', 'is', null);
      const entIds = [...new Set((links ?? []).map((l) => l.entity_id as string))];
      if (entIds.length) {
        const { data: ents } = await supabase.from('work_entities').select('id, name').in('id', entIds);
        const nameById = new Map(((ents ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]));
        for (const l of (links ?? []) as Array<{ item_id: string; entity_id: string }>) {
          const name = nameById.get(l.entity_id);
          if (name) entityByEvent.set(l.item_id, { id: l.entity_id, name });
        }
      }
    }

    const weekCeil = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const withEntity = rows.map((r) => ({ ...r, entity: entityByEvent.get(r.id) ?? null }));
    return NextResponse.json({
      thisWeek: withEntity.filter((r) => r.start <= weekCeil).slice(0, 8),
      toPrep: withEntity.filter((r) => r.entity).slice(0, 6), // deal-linked = worth preparing
    });
  } catch (e) {
    console.error('[home/horizon]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
