import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/utils/fetch-all';

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

    // NO SILENT CAPS (invariant 10): every active/tracked initiative belongs on the portfolio — an
    // unpaged `.limit(400)` silently drops whole projects off the Projects lens and the Timeline
    // past 400 entities. Paged via `fetchAllRows`, stable `id` order. Goals/rules (Blocker D —
    // project intent lives on the entity) now ride the SAME read instead of a second full listing
    // that duplicated the same cap (one fewer place to drift, one fewer full-table read per load).
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.from('work_entities')
          .select('id, name, tracked, status, state, next_move, priority, last_event_at, goals, rules')
          .eq('user_id', user.id).eq('kind', 'initiative').order('id', { ascending: true }).range(from, to));
    } catch {
      // Pre-migration fallback (20260722_work_entities_goals.sql not yet applied): drop goals/rules
      // from the select rather than fail the whole portfolio read.
      rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.from('work_entities')
          .select('id, name, tracked, status, state, next_move, priority, last_event_at')
          .eq('user_id', user.id).eq('kind', 'initiative').order('id', { ascending: true }).range(from, to));
    }
    const intent = new Map<string, { goals: string[]; rules: string[] }>();
    for (const r of rows) {
      intent.set(r.id as string, {
        goals: Array.isArray(r.goals) ? (r.goals as string[]) : [],
        rules: Array.isArray(r.rules) ? (r.rules as string[]) : [],
      });
    }
    if (!rows.length) return NextResponse.json({ hasMemory: false, entities: [], linkedItemIds: [] });

    // ── Events per ACTIVE entity — batched: all links once, then one date-fetch per source table.
    // NO SILENT CAPS: the old `activeIds.slice(0, 200)` + `.limit(1500)` pair silently dropped BOTH
    // the entities past #200 (zero events, ever) AND any links past 1500 for the ones that made the
    // cut. Paged per-entity-batch (300 ids per `.in()`, PostgREST's own comfortable ceiling) with a
    // stable order, covering every active entity's links in full. ──
    const activeIds = rows.filter((r) => r.status === 'active').map((r) => r.id as string);
    const links: Array<{ entity_id: string; item_kind: string; item_id: string }> = [];
    for (let k = 0; k < activeIds.length; k += 300) {
      const batch = await fetchAllRows<{ entity_id: string; item_kind: string; item_id: string }>((from, to) =>
        supabase.from('entity_links')
          .select('entity_id, item_kind, item_id').eq('user_id', user.id)
          .in('entity_id', activeIds.slice(k, k + 300)).neq('item_kind', 'email_thread')
          .order('entity_id', { ascending: true }).range(from, to));
      links.push(...batch);
    }
    const byKind = new Map<string, Array<{ entityId: string; itemId: string }>>();
    for (const l of links) {
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
    // NO SILENT CAPS: `.slice(0, 400)` used to drop any linked item past the 400th, silently — a
    // heavily-linked entity would lose its OLDEST or NEWEST events (array order is whatever the
    // links query returned) with no signal. Chunked `.in()` batches (300 ids each) cover every
    // linked item id in full; unordered per-chunk reads are fine here since every row is kept.
    const fetchKind = async (kind: string, table: string, select: string, at: (r: Record<string, unknown>) => string | null, label: (r: Record<string, unknown>) => string, onRow?: (entityId: string, r: Record<string, unknown>) => void) => {
      const ls = byKind.get(kind) ?? [];
      if (!ls.length) return;
      const ids = ls.map((l) => l.itemId);
      const rowsForKind: Array<Record<string, unknown>> = [];
      for (let k = 0; k < ids.length; k += 300) {
        const { data } = await supabase.from(table).select(select).in('id', ids.slice(k, k + 300));
        rowsForKind.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
      }
      const byId = new Map(rowsForKind.map((r) => [String(r.id), r]));
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
      // THE HONEST DEFAULT: no synthesized momentum ≠ "Active". An unjudged entity says so —
      // the neutral 'unknown' token — never a healthy green verdict it hasn't earned (July 29).
      const momentum = state.momentum || 'unknown';
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
