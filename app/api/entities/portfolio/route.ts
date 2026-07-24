import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 20;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — THE PORTFOLIO read layer (shared by the Projects lens AND the entity Timeline). Returns
// the user's living work straight from the entity registry: every active entity with its reasoned
// state/next-move/priority, its recent dated EVENTS (for the timeline axis), CLOSURE candidates (the
// system proposing pruning — concluded-looking work the user can mark done in one tap), and the linked
// item-id set (so the Timeline's "Other" lane = dated atoms the memory hasn't placed). `hasMemory:false`
// → clients fall back to the label-era views (self-gating, per the staged cutover).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type PortfolioEntity = {
  id: string; name: string; tracked: boolean; status: string;
  momentum: string; summary: string | null; stage: string | null;
  whoOwes: { you: string[]; them: string[] };
  nextMove: { title: string; entityRef: string | null } | null;
  weight: number; nextDue: string | null; // B6 — earliest open due date (fact; badge derives client-side)
  lastEventAt: string | null; quietDays: number | null;
  itemCount: number;
  closureCandidate: boolean;
  events: Array<{ at: string; kind: string; label: string; id: string }>;
  goals: string[]; rules: string[];
  prominent: boolean; category: string | null; // reasoned-alive OR user-pinned (the portfolio leads with these)
  /** PROJECTHOOD (projecthood-plan P1) — the judged scope; null until the entity's first v4 synthesis.
   *  Consumers: tracked always renders as project (the pin outranks the judgment). */
  scope: 'project' | 'errand' | 'background' | null;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ents } = await supabase.from('work_entities')
      .select('id, name, tracked, status, state, next_move, priority, last_event_at')
      .eq('user_id', user.id).eq('kind', 'initiative').limit(400);
    const rows = (ents ?? []) as Array<Record<string, unknown>>;
    // Goals/rules (Blocker D — project intent lives on the entity). Separate defensive query so the
    // portfolio keeps working before 20260722_work_entities_goals.sql is applied.
    const intent = new Map<string, { goals: string[]; rules: string[] }>();
    try {
      const { data: gi } = await supabase.from('work_entities').select('id, goals, rules').eq('user_id', user.id).eq('kind', 'initiative').limit(400);
      for (const r of (gi ?? []) as Array<{ id: string; goals: unknown; rules: unknown }>) {
        intent.set(r.id, { goals: Array.isArray(r.goals) ? (r.goals as string[]) : [], rules: Array.isArray(r.rules) ? (r.rules as string[]) : [] });
      }
    } catch { /* pre-migration */ }
    if (!rows.length) return NextResponse.json({ hasMemory: false, entities: [], linkedItemIds: [] });

    // ── Events per ACTIVE entity — batched: all links once, then one date-fetch per source table. ──
    const activeIds = rows.filter((r) => r.status === 'active').map((r) => r.id as string);
    const { data: links } = await supabase.from('entity_links')
      .select('entity_id, item_kind, item_id').eq('user_id', user.id)
      .in('entity_id', activeIds.slice(0, 200)).neq('item_kind', 'email_thread').limit(1500);
    const byKind = new Map<string, Array<{ entityId: string; itemId: string }>>();
    for (const l of (links ?? []) as Array<{ entity_id: string; item_kind: string; item_id: string }>) {
      (byKind.get(l.item_kind) ?? byKind.set(l.item_kind, []).get(l.item_kind)!).push({ entityId: l.entity_id, itemId: l.item_id });
    }
    const events = new Map<string, Array<{ at: string; kind: string; label: string; id: string }>>();
    const counts = new Map<string, number>();
    const push = (entityId: string, at: string | null, kind: string, label: string, itemId: string) => {
      counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
      if (!at) return;
      (events.get(entityId) ?? events.set(entityId, []).get(entityId)!).push({ at, kind, label: label.slice(0, 80), id: itemId });
    };
    // B6 — the earliest OPEN due date per entity: a FACT that powers the portfolio's urgency badge.
    const nextDue = new Map<string, string>();
    const fetchKind = async (kind: string, table: string, select: string, at: (r: Record<string, unknown>) => string | null, label: (r: Record<string, unknown>) => string, onRow?: (entityId: string, r: Record<string, unknown>) => void) => {
      const ls = byKind.get(kind) ?? [];
      if (!ls.length) return;
      const { data } = await supabase.from(table).select(select).in('id', ls.map((l) => l.itemId).slice(0, 400));
      const byId = new Map(((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => [String(r.id), r]));
      for (const l of ls) { const r = byId.get(l.itemId); if (r) { push(l.entityId, at(r), kind, label(r), l.itemId); onRow?.(l.entityId, r); } }
    };
    await Promise.all([
      fetchKind('inbox_item', 'inbox_items', 'id, work_title, source_data, created_at',
        (r) => ((r.source_data as Record<string, unknown>)?.received_at as string) ?? (r.created_at as string) ?? null,
        (r) => String(r.work_title || '')),
      fetchKind('meeting', 'meeting_transcripts', 'id, title, start_time', (r) => (r.start_time as string) ?? null, (r) => String(r.title || 'Meeting')),
      fetchKind('commitment', 'commitments', 'id, description, due_date, created_at, status', (r) => (r.due_date as string) ?? (r.created_at as string) ?? null, (r) => String(r.description || ''),
        (entityId, r) => { // B6: min open due date per entity
          const st = String(r.status || '');
          if ((st === 'open' || st === 'pending' || st === 'in_progress') && r.due_date) {
            const due = String(r.due_date);
            if (!nextDue.has(entityId) || due < nextDue.get(entityId)!) nextDue.set(entityId, due);
          }
        }),
      fetchKind('calendar_event', 'calendar_events', 'id, title, start_time', (r) => (r.start_time as string) ?? null, (r) => String(r.title || 'Meeting')),
    ]);

    const nowMs = Date.now();
    const entities: PortfolioEntity[] = rows.map((r) => {
      const state = (r.state ?? {}) as { summary?: string; momentum?: string; category?: string; scope?: string; stage?: string | null; whoOwes?: { you?: string[]; them?: string[] } };
      const nm = (r.next_move ?? null) as { title?: string; entityRef?: string | null } | null;
      const lastEventAt = (r.last_event_at as string) ?? null;
      const quietDays = lastEventAt ? Math.max(0, Math.floor((nowMs - new Date(lastEventAt).getTime()) / 86400000)) : null;
      const momentum = state.momentum || 'active';
      const owes = { you: state.whoOwes?.you ?? [], them: state.whoOwes?.them ?? [] };
      const id = r.id as string;
      // Closure candidate: the memory sees a concluded shape — quiet + stalled/gone_quiet + no open loops.
      const closureCandidate = r.status === 'active'
        && (momentum === 'gone_quiet' || momentum === 'stalled')
        && owes.you.length === 0 && owes.them.length === 0
        && (quietDays ?? 0) >= 14;
      const evs = (events.get(id) ?? []).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
      const weight = Number((r.priority as { weight?: number } | null)?.weight ?? 0);
      // PROMINENCE = the REASONED priority alone (Phase 3 F6, the doctrine): the fold is a
      // presentation cutoff over the judged weight — plumbing. The old momentum/quiet-days clauses
      // re-derived judgment the synthesis already makes; deleted.
      const prominent = weight >= 40;
      return {
        id, name: r.name as string, tracked: !!r.tracked, prominent, status: r.status as string,
        momentum, category: state.category ?? null,
        scope: (['project', 'errand', 'background'].includes(state.scope as string) ? state.scope : null) as PortfolioEntity['scope'],
        summary: state.summary ?? null, stage: state.stage ?? null, whoOwes: { you: owes.you, them: owes.them },
        nextMove: nm?.title ? { title: nm.title, entityRef: nm.entityRef ?? null } : null,
        weight,
        nextDue: nextDue.get(id) ?? null, // B6 — the earliest open due date (a fact; the badge derives client-side)
        lastEventAt, quietDays, itemCount: counts.get(id) ?? 0, closureCandidate, events: evs,
        goals: intent.get(id)?.goals ?? [], rules: intent.get(id)?.rules ?? [],
      };
    });

    const linkedItemIds = ((links ?? []) as Array<{ item_kind: string; item_id: string }>)
      .filter((l) => l.item_kind === 'inbox_item' || l.item_kind === 'commitment').map((l) => l.item_id);

    return NextResponse.json({ hasMemory: true, entities, linkedItemIds });
  } catch (e) {
    console.error('[entities/portfolio] error:', e);
    return NextResponse.json({ hasMemory: false, entities: [], linkedItemIds: [] });
  }
}
