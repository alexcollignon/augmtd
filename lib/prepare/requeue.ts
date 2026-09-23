// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PREPARATION RE-QUEUE (stabilization W3.3 REACH — proof-of-life's missing half).
//
// Proof-of-life (lib/work/proof-of-life.ts, law Q7) makes a long-silent item re-earn its seat: the
// judge re-affirms it ("still owed") or files it. A RE-AFFIRMED item was then left exactly where it
// was — on the desk, alive, and usually in the pass's deliberately-excluded quiet tail, so NOTHING
// was ever prepared for it. The lane proved the work was live and then walked away from it.
//
// THE CHEAPEST HONEST MECHANISM is a queue marker, not a call: REACH NEVER DRAFTS (the judgment
// sweep hosts proof-of-life and must never reach preparation — smoke-reach R5), so the lane only
// WRITES a marker here and the preparation pass READS it as its own lane under its own budget,
// records a prep_outcome (lane 'proof_of_life') for every item it reaches, and clears the marker.
// An item the pass's budget did not reach keeps its marker — counted in leftBehind, never dropped.
//
// Zero AI, zero migration (item_plans, kind 'prep_requeue', keyed by the judgment key).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlans, upsertPlan, deletePlans } from '@/lib/store/item-plans';

export const PREP_REQUEUE_KIND = 'prep_requeue';

/** Who queued it — the lane name the prep_outcome row will carry. */
export type RequeueSource = 'proof_of_life';

export type RequeueMarker = { at: string; by: RequeueSource; verdict?: string | null };

/** Queue one item (judgment key `inbox:<id>` | `commitment:<id>`) for the next preparation pass.
 *  Idempotent: re-queuing refreshes the marker, never duplicates it. Non-fatal by construction. */
export async function requeueForPreparation(
  client: SupabaseClient, userId: string, key: string, marker: Omit<RequeueMarker, 'at'>,
): Promise<boolean> {
  if (!/^(inbox|commitment):./.test(key)) return false;
  try {
    const { error } = await upsertPlan(client, userId, 'prep_requeue', key, { ...marker, at: new Date().toISOString() });
    return !error;
  } catch { return false; }
}

/** The queue, paged (NO SILENT CAPS), oldest marker first. */
export async function readPrepRequeue(client: SupabaseClient, userId: string): Promise<Map<string, RequeueMarker>> {
  const out = new Map<string, RequeueMarker>();
  try {
    const rows = await readPlans(client, userId, 'prep_requeue', { order: { by: 'updated_at', ascending: true } });
    for (const r of rows) if (r.tasks?.at) out.set(r.key, r.tasks as RequeueMarker);
  } catch { /* an unreadable queue means no re-queue lane this run — never a failed pass */ }
  return out;
}

/** Clear a served marker (the pass reached the item — its outcome is in prep_outcome). */
export async function clearPrepRequeue(client: SupabaseClient, userId: string, key: string): Promise<void> {
  try {
    await deletePlans(client, userId, 'prep_requeue', key);
  } catch { /* a stale marker is re-served next pass and its item's fresh-work guard makes that cheap */ }
}
