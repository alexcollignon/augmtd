// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROJECTS FOLLOW THE MAIL — the coalesced entity-state refresh (stabilization W9.3).
//
// Found (read-only audit, Sep 23): an entity's state (lib/entities/state.ts `refreshEntityState`) was
// re-synthesized only on a user action or by the 2-hourly draft-sweep catch-all — NEVER when
// recognition linked a new email / meeting / calendar event to it. A deal whose counterparty just
// wrote kept describing yesterday's position for up to two hours, on every surface that reads it.
//
// THE LAW: when recognition links a NEW member to an entity, ONE sig-gated refresh of that entity is
// SCHEDULED — coalesced per entity per window (a burst of five emails on one deal costs one synthesis),
// exactly-once-ish through an `item_plans` marker (kind `entity_refresh`, key = the entity id), and
// budgeted (a stated per-call run cap + a start deadline). Whatever a call does not run is marked DIRTY
// on its marker, and every later call DRAINS due dirty markers first — the trailing edge of the debounce
// rides the next sync tail (≤15 min), never a timer and never a bare `void`. Nothing here is AI but the
// refresh itself, which stays sig-gated: an unchanged ledger costs one read.
//
// THE CLAIM (invariant 9 idiom): a marker is taken by INSERT (the unique (user, kind, key) index
// settles the race) or by a compare-and-set UPDATE on the `at` the caller read — two concurrent syncs
// can never both synthesize the same entity inside one window.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlans, insertPlan, updatePlan, upsertPlan } from '@/lib/store/item-plans';

/** One refresh per entity per window — a burst of member links coalesces into one synthesis. */
export const ENTITY_REFRESH_COALESCE_MS = 5 * 60_000;
/** Default per-call run cap (the rest is marked dirty and drained by the next call). */
export const ENTITY_REFRESH_MAX_PER_CALL = 2;
/** Default start deadline — no refresh STARTS after this much of the call has elapsed. */
export const ENTITY_REFRESH_BUDGET_MS = 15_000;
/** A released / never-run marker — due at once on the next drain. */
export const ENTITY_REFRESH_EPOCH = '1970-01-01T00:00:00.000Z';

export type RefreshMarker = { at?: string | null; dirty?: boolean | null };

export type RefreshPlan = {
  /** Claim + refresh now (≤ maxRun), fresh members first, then due dirty markers. */
  run: string[];
  /** Refreshed inside the window already — marked dirty; the window's end drains it. */
  coalesce: string[];
  /** Over the run cap — marked dirty; drained by the next call (REPORTED, never silent). */
  overflow: string[];
};

const atMs = (m: RefreshMarker | undefined): number => {
  const t = m?.at ? Date.parse(m.at) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** PURE — who runs now, who coalesces into the window, who overflows the cap. Deterministic. */
export function planEntityRefresh(args: {
  fresh: string[];
  markers: Record<string, RefreshMarker | undefined>;
  nowMs: number;
  coalesceMs?: number;
  maxRun?: number;
}): RefreshPlan {
  const window = args.coalesceMs ?? ENTITY_REFRESH_COALESCE_MS;
  const maxRun = Math.max(0, args.maxRun ?? ENTITY_REFRESH_MAX_PER_CALL);
  const fresh = [...new Set(args.fresh.filter(Boolean))];
  // THE DRAIN: a dirty marker whose window has closed is due — the trailing edge of the debounce.
  const due = Object.entries(args.markers)
    .filter(([id, m]) => !!m?.dirty && !fresh.includes(id) && args.nowMs - atMs(m) >= window)
    .sort(([, a], [, b]) => atMs(a) - atMs(b))
    .map(([id]) => id);
  const plan: RefreshPlan = { run: [], coalesce: [], overflow: [] };
  for (const id of [...fresh, ...due]) {
    const m = args.markers[id];
    if (m && args.nowMs - atMs(m) < window) { plan.coalesce.push(id); continue; }
    if (plan.run.length < maxRun) plan.run.push(id);
    else plan.overflow.push(id);
  }
  return plan;
}

export type RefreshReport = { ran: number; coalesced: number; leftBehind: number };

/**
 * SCHEDULE the refresh of the entities that just gained members (and drain due dirty markers).
 * Awaited by the recognition hooks inside their own request budget. Never throws.
 *   `maxRun: 0` = mark only (a tight-budget caller, e.g. the calendar sync): the next sync tail drains.
 */
export async function scheduleEntityRefresh(
  supabase: SupabaseClient, userId: string, freshEntityIds: string[],
  opts: { maxRun?: number; budgetMs?: number; nowMs?: number } = {},
): Promise<RefreshReport> {
  const report: RefreshReport = { ran: 0, coalesced: 0, leftBehind: 0 };
  try {
    const started = Date.now();
    const nowMs = opts.nowMs ?? started;
    const budget = opts.budgetMs ?? ENTITY_REFRESH_BUDGET_MS;
    const rows = await readPlans(supabase, userId, 'entity_refresh');
    const markers: Record<string, RefreshMarker | undefined> = {};
    for (const r of rows) markers[r.key] = (r.tasks ?? {}) as RefreshMarker;
    const plan = planEntityRefresh({ fresh: freshEntityIds, markers, nowMs, maxRun: opts.maxRun });

    const markDirty = async (id: string, keepAt: boolean) => {
      const m = markers[id];
      if (m?.dirty && keepAt) return; // already owed — nothing to write
      const tasks = { at: keepAt && m?.at ? m.at : ENTITY_REFRESH_EPOCH, dirty: true };
      if (m) await updatePlan(supabase, userId, 'entity_refresh', id, tasks);
      else await upsertPlan(supabase, userId, 'entity_refresh', id, tasks);
    };
    for (const id of plan.coalesce) { await markDirty(id, true); report.coalesced++; }
    for (const id of plan.overflow) { await markDirty(id, true); report.leftBehind++; }

    if (plan.run.length) {
      const { refreshEntityState } = await import('@/lib/entities/state');
      for (const id of plan.run) {
        // THE BUDGET: nothing STARTS past the deadline — the entity is released (due at once next call).
        if (Date.now() - started > budget) { await markDirty(id, false); report.leftBehind++; continue; }
        const nowIso = new Date().toISOString();
        const m = markers[id];
        // THE CLAIM — insert when no marker exists; else compare-and-set on the `at` we read.
        const claimed = m
          ? (await updatePlan(supabase, userId, 'entity_refresh', id, { at: nowIso, dirty: false }, {
            where: (q) => (m.at ? q.eq('tasks->>at', m.at) : q.is('tasks->>at', null)),
          })).updated > 0
          : (await insertPlan(supabase, userId, 'entity_refresh', id, { at: nowIso, dirty: false })).inserted;
        if (!claimed) { report.coalesced++; continue; } // another sync holds this window — it refreshes
        await refreshEntityState(supabase, userId, id).catch(() => {}); // sig-gated: unchanged ledger = no AI
        report.ran++;
      }
    }
    if (report.leftBehind) {
      console.log(`[entity-refresh] ${userId.slice(0, 8)}: ran ${report.ran}, ${report.leftBehind} left for the next sync tail (marked dirty), ${report.coalesced} coalesced`);
    }
  } catch { /* non-fatal — the 2-hourly catch-all still refreshes every entity */ }
  return report;
}
