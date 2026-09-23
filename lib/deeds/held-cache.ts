// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HELD-QUIET LEDGER'S LAST-GOOD — ONE payload shape, ONE writer (docs/attention-plan.md A3).
//
// The ledger's derivation (`deriveHeld`) is a whole-pool walk: ~9s on a real account, worse on a dev
// box. The route already served a stored last-good and converged behind it. What was missing is
// that the HOME already pays for that same derivation on every brief — `countHeld` runs `deriveHeld`
// to compute the door's two numbers and then threw the facts away. So the first visit to the ledger
// after a Home visit derived it all over again, from cold, while the reader watched.
//
// THIS MODULE IS THE SEAM: the payload builder and the cache writer live here, and BOTH callers use
// them — the ledger's own route (which must store what it just derived) and the brief's after()
// (which primes the row from facts it already has in hand, at the cost of one upsert). Neither
// spells the kind, the shape or the staleness itself, so the two can never drift into serving
// different accounts of the same thing.
//
// WHAT IS NOT HERE, deliberately: the DAY. A stored payload is served with the READER'S OWN clock at
// read time (the route re-stamps `today`), because the triage deck composes its ← LATER whens from
// it and a cached day is how a deck offers "tomorrow" for yesterday.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { buildHeldLedger, ATTENTION_BUDGET, HELD_MEMBERS_PER_CLASS } from '@/lib/home/attention';
import type { HeldDerivation } from '@/lib/deeds/held-members';

/** The free-row store (`item_plans`) and its key — the zero-migration idiom the timeline cache set. */
export const HELD_CACHE_KIND = 'held_cache';
/** Older than this and the route converges behind the serve (it still serves the last-good first). */
export const HELD_CACHE_MS = 3 * 60_000;
/** A payload from another DAY is not a last-good, it is last week's account. */
export const HELD_CACHE_MAX_MS = 24 * 60 * 60_000;

type DBClient = {
  from: (t: string) => {
    upsert: (v: unknown, o?: unknown) => Promise<{ error: unknown }>;
  } & Record<string, unknown>;
};

/** THE ONE PAYLOAD SHAPE the lens reads — built from facts already derived, never from a new read. */
export function buildHeldPayload(
  derived: HeldDerivation, todayISO: string,
  opts: { perClass?: number; offset?: number; filedThisMonth?: number } = {},
) {
  const perClass = opts.perClass ?? HELD_MEMBERS_PER_CLASS;
  const offset = opts.offset ?? 0;
  const ledger = buildHeldLedger(derived.facts, todayISO, { membersPerClass: perClass, offset, user: derived.userForms ?? null });
  return {
    ...ledger,
    budget: ATTENTION_BUDGET,
    today: todayISO,
    servedCount: derived.servedCount,
    filedThisMonth: opts.filedThisMonth ?? 0,
    poolRead: derived.poolRead,
    poolSaturated: derived.poolSaturated,
    offset,
    membersPerClass: perClass,
  };
}

/** THE ONE WRITER. Best-effort by construction: a cache that fails to store is a slower next visit,
 *  never a failed one — so this never throws into its caller's path. */
export async function storeHeldCache(client: DBClient, userId: string, payload: unknown): Promise<void> {
  try {
    await client.from('item_plans').upsert({
      user_id: userId, kind: HELD_CACHE_KIND, entity_id: 'home',
      tasks: payload as never, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' });
  } catch (e) { console.error('[held-cache] write failed:', e); }
}
