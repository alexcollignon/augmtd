// Read the user's muted initiatives — the persistent, revive-able "not relevant" set (see
// supabase/migrations/20260713_muted_initiatives.sql). Returns a Map<initiative_key, muted_at ISO string>.
// The spine (getActiveInitiatives) suppresses an initiative ONLY while nothing newer than muted_at has
// landed on it, so a fresh touchpoint auto-revives it. Best-effort: degrades to an empty map if the table
// isn't applied yet (pre-migration) or on any error — muting is additive, never breaks the Home.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function readMutedMap(supabase: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('muted_initiatives')
      .select('initiative_key, muted_at')
      .eq('user_id', userId);
    if (error) return map; // table missing / RLS — degrade to "nothing muted"
    for (const r of (data ?? []) as Array<{ initiative_key: string; muted_at: string }>) {
      if (r.initiative_key) map.set(r.initiative_key, String(r.muted_at));
    }
  } catch { /* non-fatal */ }
  return map;
}
