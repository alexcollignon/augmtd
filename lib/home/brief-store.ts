// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE MERGE (W0.5 TIME BUDGETS) — every writer of `profiles.home_brief` goes through here.
//
// THE RACE: home_brief is a single jsonb blob holding many independent sub-keys (aux, tldr,
// mustRespond, bundleNames, briefing, sig, …), each patched by its OWN after() callback. Every prior
// writer did read-whole-blob → spread → write-whole-blob — so two concurrent patches to DIFFERENT
// sub-keys (the ordinary case: the brief-synthesis after() and the bundle-naming after() both fire off
// the same request) can each read the SAME pre-patch snapshot and the second write silently drops the
// first patch (a lost update). This is exactly the class the stabilization plan calls out.
//
// THE FIX: merge_home_brief (supabase/migrations/20260922b_merge_home_brief.sql) does the merge
// ATOMICALLY in Postgres via jsonb `||`, so two concurrent merges into disjoint keys both land. Until
// that migration is applied (manual, per this repo's convention), `mergeHomeBrief` falls back to the
// old read-modify-write — races are still possible in that window, but every caller keeps working with
// zero code changes once the migration lands (call it once, ship it once).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

let rpcMissingWarned = false;

/** Atomically merge `patch` into `profiles.home_brief` for `userId` — top-level keys only (jsonb `||`
 *  semantics: a key in `patch` REPLACES the same key in the stored blob; sibling keys are untouched).
 *  Setting a key to `null` (e.g. `{ sig: null }`) is the established bust idiom, not a deletion. */
export async function mergeHomeBrief(client: DBClient, userId: string, patch: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await client.rpc('merge_home_brief', { p_user: userId, p_patch: patch });
    if (!error) return;
    if (!rpcMissingWarned) {
      rpcMissingWarned = true;
      // Logged once per process — the owner applies 20260922b manually (CLAUDE.md convention); until
      // then every merge takes the race-prone fallback below, same as before this file existed.
      console.warn('[brief-store] merge_home_brief RPC unavailable — falling back to read-modify-write. Apply supabase/migrations/20260922b_merge_home_brief.sql.', error?.message ?? error);
    }
  } catch (e) {
    if (!rpcMissingWarned) {
      rpcMissingWarned = true;
      console.warn('[brief-store] merge_home_brief RPC call threw — falling back to read-modify-write.', e);
    }
  }
  // FALLBACK — the pre-existing pattern, preserved so every call site keeps functioning before the
  // migration is applied. Best-effort: a brief-cache write failing must never surface to the user.
  try {
    const { data } = await client.from('profiles').select('home_brief').eq('id', userId).single();
    const hb = ((data?.home_brief as Record<string, unknown>) ?? {});
    await client.from('profiles').update({ home_brief: { ...hb, ...patch } }).eq('id', userId);
  } catch { /* non-fatal — brief-cache writes are always best-effort */ }
}
