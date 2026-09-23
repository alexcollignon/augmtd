// ════════════════════════════════════════════════════════════════════════════════════════════════
// SOFT brief-cache bust (P0 perf). The old idiom — `home_brief: null` — destroyed the whole blob:
// last-good content, the aux side-cache (clusters/outbound/reconcile stamp), bundleNames, and the
// briefing — so the next load ran the FULL cold path + re-fired every AI pass. The soft bust clears
// ONLY the sig: the next load is "stale" (recomputes membership + kicks the single-flight enrich) but
// still serves last-good content instantly and keeps every sibling cache.
// Most writes don't need ANY bust — the sig derives from live counts + freshest timestamps, so status
// changes invalidate naturally. Use this only for writes the sig can't see (entity renames/moves).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeHomeBrief } from '@/lib/home/brief-store';

// W0.5 TIME BUDGET: routed through THE ONE MERGE (brief-store.ts) — this used to read-modify-write
// the whole blob itself, racing every other home_brief writer's own read-modify-write.
export async function softBustBrief(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    // Bust semantics preserved exactly: nothing cached → nothing to bust (no shell object created).
    const { data } = await supabase.from('profiles').select('home_brief').eq('id', userId).single();
    const hb = ((data?.home_brief as Record<string, unknown>) ?? null);
    if (!hb) return;
    await mergeHomeBrief(supabase, userId, { sig: null });
  } catch { /* non-fatal */ }
}
