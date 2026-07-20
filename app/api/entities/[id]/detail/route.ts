import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';
import { ganttMarkerOf } from '@/lib/work-items/gantt-date';

export const maxDuration = 20;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — a single entity's DETAIL (the project deep-dive over the registry). Returns the entity's
// reasoned state/next-move/goals/rules PLUS its member WORK ITEMS (via entity_links, through the shared
// spine so the board + Gantt agree with the Timeline). Shaped for a calm card dashboard:
//   overview → state + next move + who-owes + a work stat strip + goals/rules
//   work     → the member items as a board (to-do / waiting / done)
//   timeline → the member items as dated Gantt events
// ════════════════════════════════════════════════════════════════════════════════════════════════

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const { data: ent } = await supabase.from('work_entities')
      .select('id, name, tracked, status, state, next_move, priority, last_event_at, goals, rules')
      .eq('id', id).eq('user_id', user.id).eq('kind', 'initiative').maybeSingle();
    if (!ent) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Member item ids (inbox + commitments) — the work; meetings surface separately as context.
    const { data: links } = await supabase.from('entity_links').select('item_kind, item_id')
      .eq('user_id', user.id).eq('entity_id', id).not('entity_id', 'is', null);
    const memberIds = new Set((links ?? []).filter((l) => l.item_kind === 'inbox_item' || l.item_kind === 'commitment').map((l) => l.item_id as string));
    const meetingIds = (links ?? []).filter((l) => l.item_kind === 'meeting').map((l) => l.item_id as string);

    const todayStr = new Date().toISOString().slice(0, 10);
    // The shared spine, filtered to this entity's members (so the board/Gantt match the Timeline exactly).
    const allItems = await buildWorkItems(supabase, user.id, { todayStr, includeCalendar: false, includeOutbound: false, skipReconcile: true }).catch(() => []);
    const items = allItems.filter((w) => memberIds.has(w.entityId));

    const board = {
      todo: items.filter((w) => w.state === 'todo').map(slim),
      waiting: items.filter((w) => w.state === 'waiting').map(slim),
      done: items.filter((w) => w.state === 'done').map(slim),
    };
    const gantt = items.filter((w) => w.state !== 'dismissed').map((w) => {
      const mk = ganttMarkerOf(w, todayStr);
      return { title: w.title, who: w.who, state: w.state, marker: mk.marker, date: mk.date, arrival: mk.arrival, overdue: mk.overdue, href: w.href && w.href !== '/' ? w.href : null };
    });

    let meetings: Array<{ id: string; title: string; date: string | null }> = [];
    if (meetingIds.length) {
      const { data: mt } = await supabase.from('meeting_transcripts').select('id, title, start_time, created_at').in('id', meetingIds).eq('user_id', user.id);
      meetings = ((mt ?? []) as Array<Record<string, unknown>>).map((m) => ({ id: m.id as string, title: (m.title as string) || 'Meeting', date: ((m.start_time as string) || (m.created_at as string) || null)?.slice(0, 10) ?? null }));
    }

    const st = (ent.state ?? {}) as { summary?: string; momentum?: string; stage?: string | null; whoOwes?: { you?: string[]; them?: string[] } };
    const nm = (ent.next_move ?? null) as { title?: string; entityRef?: string | null } | null;
    return NextResponse.json({
      entity: {
        id: ent.id, name: ent.name, tracked: !!ent.tracked, status: ent.status,
        momentum: st.momentum || 'active', summary: st.summary ?? null, stage: st.stage ?? null,
        whoOwes: { you: st.whoOwes?.you ?? [], them: st.whoOwes?.them ?? [] },
        nextMove: nm?.title ? { title: nm.title, entityRef: nm.entityRef ?? null } : null,
        weight: Number((ent.priority as { weight?: number } | null)?.weight ?? 0),
        goals: Array.isArray(ent.goals) ? ent.goals : [], rules: Array.isArray(ent.rules) ? ent.rules : [],
      },
      counts: { todo: board.todo.length, waiting: board.waiting.length, done: board.done.length, total: items.length },
      board, gantt, meetings,
    });
  } catch (e) {
    console.error('[entities/detail] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

function slim(w: { id: string; title: string; who: string | null; href: string; when: { explicit: string | null } }) {
  return { id: w.id, title: w.title, who: w.who, href: w.href, when: w.when.explicit };
}
