// Initiative Brain (S3) — the durable + LIVE store. Persists the synthesized state + next move per initiative
// so the Home "what's happening" surface (S4) reads instantly, and refreshes it as things happen. The event
// ledger stays derived-on-read (brain.ts); only the synthesized bits are stored here.
//
// LIVE mechanism: every ingestion point that tags an atom to an initiative (email sync, meeting insight,
// commitment extract) calls `refreshInitiativeStates(userId, keys)` in the background — recompute ONLY the
// initiatives that actually moved. A `sig` (event count + freshest timestamp) skips the AI call when nothing
// changed, so a read-triggered refresh is cheap.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assembleInitiativeLedger, synthesizeBrain, fetchBrainCorpus, type LedgerAssembly, type InitiativeState, type NextMove, type BrainCorpus } from '@/lib/initiatives/brain';

export type StoredInitiativeState = {
  initiative_key: string; label: string; project_id: string | null;
  state: unknown; next_move: unknown; people: unknown; quiet_days: number | null;
  sig: string | null; last_activity_at: string | null; updated_at: string;
};

// Refresh ONE initiative's stored state. Skips the (expensive) synthesis when the atom sig is unchanged,
// unless `force`. Non-fatal — the surface falls back to the last stored row.
export async function refreshInitiativeState(supabase: SupabaseClient, userId: string, key: string, opts: { force?: boolean; corpus?: BrainCorpus } = {}): Promise<void> {
  try {
    // CHEAP first: assemble the ledger (no AI) → sig. Skip the AI synthesis when nothing moved. A shared
    // corpus (from a batch) avoids the per-initiative bulk fetch.
    const a = await assembleInitiativeLedger(supabase, userId, key, opts.corpus);
    if (!a) return;
    if (!opts.force) {
      const { data: existing } = await supabase.from('initiative_state').select('sig').eq('user_id', userId).eq('initiative_key', key).maybeSingle();
      if (existing?.sig && existing.sig === a.sig) return; // unchanged → no AI call, no write
    }
    const { state, nextMove } = await synthesizeBrain(supabase, userId, a); // the AI cost, only when changed
    await upsert(supabase, userId, a, state, nextMove);
  } catch { /* non-fatal */ }
}

// Refresh a SET of initiatives (the ones that moved in a sync batch). Deduped, bounded concurrency.
export async function refreshInitiativeStates(supabase: SupabaseClient, userId: string, keys: string[], opts: { force?: boolean } = {}): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return;
  // Fetch the shared corpus ONCE for the whole batch — the per-initiative assemble then works from memory.
  const corpus = await fetchBrainCorpus(supabase, userId).catch(() => undefined);
  const CH = 4;
  for (let i = 0; i < unique.length; i += CH) {
    await Promise.all(unique.slice(i, i + CH).map((k) => refreshInitiativeState(supabase, userId, k, { ...opts, corpus })));
  }
}

async function upsert(supabase: SupabaseClient, userId: string, a: LedgerAssembly, state: InitiativeState | null, nextMove: NextMove | null): Promise<void> {
  const lastAt = a.ledger.find((e) => e.at)?.at ?? null;
  await supabase.from('initiative_state').upsert({
    user_id: userId,
    initiative_key: a.key,
    label: a.label,
    state, next_move: nextMove,
    people: a.people,
    quiet_days: a.quietDays,
    sig: a.sig,
    last_activity_at: lastAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,initiative_key' });
}

// Read the stored states for the Home surface (S4). Ordered by attention (needs-you first) then recency.
export async function getInitiativeStates(supabase: SupabaseClient, userId: string): Promise<StoredInitiativeState[]> {
  const { data } = await supabase.from('initiative_state')
    .select('initiative_key, label, project_id, state, next_move, people, quiet_days, sig, last_activity_at, updated_at')
    .eq('user_id', userId)
    .order('last_activity_at', { ascending: false })
    .limit(100);
  return (data ?? []) as StoredInitiativeState[];
}
