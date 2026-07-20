import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems, partitionByTime } from '@/lib/work-items/model';
import { ganttMarkerOf } from '@/lib/work-items/gantt-date';

const MOM_DOT: Record<string, string> = { needs_you: 'bg-rose-500', gone_quiet: 'bg-amber-500', stalled: 'bg-amber-500', waiting: 'bg-blue-400', active: 'bg-emerald-500' };

export const maxDuration = 20;

// GET /api/home/timeline — the unified work-item spine for the Home timeline view. Returns the flat
// WorkItem[] (the client groups into bucket lanes) + the history/upcoming split + today's date. Read-only
// over the live tables (cheap); no cache for v1 — the timeline is a "zoom out", not a hot path.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const todayStr = new Date().toISOString().slice(0, 10);
    const items = await buildWorkItems(supabase, user.id, { todayStr, includeCalendar: true, includeOutbound: true });
    const { history, upcoming } = partitionByTime(items);

    // Project name/color map so items can show a subtle "part of <initiative>" tag (loose items get none).

    // ── ONE BRAIN: the timeline READS each item's initiative VERDICT (lib/brains/verdict.ts) — an item whose
    // deal is SLIPPING (gone-quiet/stalled with something open on you) is flagged, so a quietly-aging deal is
    // marked here the SAME way it's judged on the deck/projects/deep-dive. Resolved server-side per item (no
    // client normalization drift). Non-fatal; empty pre-migration. ──
    const slippingIds: string[] = [];
    // ONE BRAIN: each item's ENTITY tag ("part of <body of work>") + slipping flag, both from the same
    // membership links — replaces the dead project map. `entityTags` is keyed by the WORK-ITEM id.
    const entityTags: Record<string, { name: string }> = {};
    try {
      const nowMs = Date.now();
      const { data: wents } = await supabase.from('work_entities')
        .select('id, name, state, last_event_at').eq('user_id', user.id).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null).limit(400);
      const slipById = new Map<string, boolean>();
      const nameById = new Map<string, string>();
      for (const e of (wents ?? []) as Array<{ id: string; name: string; state: { momentum?: string; whoOwes?: { you?: string[] } } | null; last_event_at: string | null }>) {
        const st = e.state ?? {};
        const quiet = e.last_event_at ? (nowMs - new Date(e.last_event_at).getTime()) / 86400000 : 0;
        slipById.set(e.id, (st.momentum === 'gone_quiet' || st.momentum === 'stalled') && ((st.whoOwes?.you?.length ?? 0) > 0 || quiet >= 14));
        nameById.set(e.id, e.name);
      }
      // entity_links.item_id is the RAW row id; a work item's `entityId` is that raw id (its `id` is
      // prefixed, e.g. "inbox:<id>"). Map link → entity by raw id, then key the outputs by the WORK-ITEM id.
      const rawToItem = new Map<string, string>(); // raw id → work-item id (only inbox/commitment)
      for (const w of items) { if (w.entityId && (w.id.startsWith('inbox:') || w.id.startsWith('commit:'))) rawToItem.set(w.entityId, w.id); }
      const rawIds = [...rawToItem.keys()];
      if (rawIds.length) {
        const { data: ilinks } = await supabase.from('entity_links').select('item_id, entity_id')
          .eq('user_id', user.id).in('item_kind', ['inbox_item', 'commitment']).in('item_id', rawIds.slice(0, 500)).not('entity_id', 'is', null);
        for (const l of (ilinks ?? []) as Array<{ item_id: string; entity_id: string }>) {
          const wid = rawToItem.get(l.item_id);
          if (!wid) continue;
          if (slipById.get(l.entity_id)) slippingIds.push(wid);
          const nm = nameById.get(l.entity_id);
          if (nm) entityTags[wid] = { name: nm };
        }
      }
    } catch { /* non-fatal */ }

    // ── GANTT groups — the timeline as a PROJECT-clustered event chart (the Projects-page Gantt, on the
    // Home Timeline). Each active entity with dated members is a swimlane; its members are dated events. ──
    let ganttGroups: Array<{ id: string; name: string; statusDot: string; items: Array<{ title: string; who: string | null; state: string; marker: string; date: string; arrival: string; overdue: boolean; href: string | null }> }> = [];
    try {
      const { data: wents } = await supabase.from('work_entities')
        .select('id, name, state').eq('user_id', user.id).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null).limit(400);
      const entMeta = new Map((wents ?? []).map((e) => [e.id as string, { name: e.name as string, dot: MOM_DOT[((e.state ?? {}) as { momentum?: string }).momentum ?? 'active'] ?? MOM_DOT.active }]));
      // raw id → entity (only for inbox/commitment work items).
      const rawToEntity = new Map<string, string>();
      const { data: gl } = await supabase.from('entity_links').select('item_id, entity_id')
        .eq('user_id', user.id).in('item_kind', ['inbox_item', 'commitment']).not('entity_id', 'is', null).limit(2000);
      for (const l of (gl ?? []) as Array<{ item_id: string; entity_id: string }>) rawToEntity.set(l.item_id, l.entity_id);
      const byEntity = new Map<string, Array<Record<string, unknown>>>();
      for (const w of items) {
        if (w.state === 'dismissed') continue;
        if (!(w.id.startsWith('inbox:') || w.id.startsWith('commit:'))) continue;
        const eid = rawToEntity.get(w.entityId);
        if (!eid || !entMeta.has(eid)) continue;
        const mk = ganttMarkerOf(w, todayStr);
        (byEntity.get(eid) ?? byEntity.set(eid, [] as Array<Record<string, unknown>>).get(eid)!).push({ title: w.title, who: w.who, state: w.state, marker: mk.marker, date: mk.date, arrival: mk.arrival, overdue: mk.overdue, href: null });
      }
      ganttGroups = [...byEntity.entries()].map(([eid, its]) => ({ id: eid, name: entMeta.get(eid)!.name, statusDot: entMeta.get(eid)!.dot, items: its as never[] }))
        .sort((a, b) => (b.items as unknown[]).length - (a.items as unknown[]).length);
    } catch { /* non-fatal — the flat station view still renders */ }

    return NextResponse.json({ todayStr, items, slippingIds, entityTags, ganttGroups, counts: { total: items.length, history: history.length, upcoming: upcoming.length } });
  } catch (e) {
    console.error('[home/timeline] error:', e);
    return NextResponse.json({ error: 'Could not build the timeline.' }, { status: 500 });
  }
}
