// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GRADUATION LANE (docs/attention-plan.md PART III, law Q3).
//
// "An item in a class whose consequence is 'nothing changes if these wait' files itself after 10
// quiet days — resolved through the existing undoable door, activity-logged, counted in receipts.
// The standing number trends to zero."
//
// WHY THIS EXISTS: suppression alone only ever grows. The ledger's handled band on the reference
// account reads in the thousands, and a number that can only climb is not a receipt — it is a
// monument to everything the agent will still be holding next year. Retirement is the other half.
//
// FIVE FLOORS, every one structural:
//
//   1 · THE SELECTION IS PURE AND ZERO-AI. `selectGraduates` (lib/home/attention.ts) decides, from
//       the SAME classification the ledger renders — the band, the class, the deadline, the clock.
//       This module only performs what that function returned. Nothing here judges anything.
//
//   2 · THE EXISTING UNDOABLE DOOR. Every graduation goes through `executeResolveInboxItem` — the
//       same door the deck's Dismiss and the bulk deed use — so it stamps `resolved_at`, settles the
//       item's asks, reconciles the mailbox label, and writes the `dismissed` activity row that
//       `/api/restore` already knows how to reverse. There is NO raw status write in this file.
//
//   3 · IT CARRIES ITS OWN NAME. `resolution_reason: 'graduated'` rides the item and the activity
//       row's metadata, which is what makes the receipts line ("filed 312 this month") a COUNT OF
//       REAL EVENTS rather than an estimate, and what lets a reader see why something left.
//
//   4 · A GRADUATE COMES BACK ON A NEW WORD. The door leaves the item `dismissed`, and
//       `reactivateResolvedThreadOnReply` reopens exactly `completed|dismissed` items on a genuinely
//       newer inbound. Filing is therefore never final: the sender's next message undoes it for
//       them. (Gate AQ4 holds this seam.)
//
//   5 · A BUDGET, OLDEST FIRST. A cap per user per run, spent on the oldest rows, under the sweep's
//       own wall clock. A drain that cannot finish in one run finishes across runs; it never
//       stampedes, and `leftBehind` is counted rather than hidden.
//
// DRY BY DEFAULT: `apply` must be passed explicitly. A read of what WOULD file costs nothing and
// writes nothing, which is how this lane is inspected on a real account.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectGraduates, GRADUATION_DAYS, type Graduate, type HeldClassId } from '@/lib/home/attention';
import { deriveHeld } from '@/lib/deeds/held-members';

/** The resolution reason every graduated row carries — the receipts read THIS string. */
export const GRADUATION_REASON = 'graduated';

/** How many rows one user may retire in one sweep run. A budget, not a migration. */
export const GRADUATION_CAP = 200;

export type GraduationResult = {
  /** How many rows qualified in the whole held set (before the cap). */
  eligible: number;
  /** How many this run actually filed (0 on a dry read). */
  filed: number;
  /** Qualified rows the cap left for the next run — counted, never silent. */
  leftBehind: number;
  /** Per-class breakdown of the qualifying set (the dry read's whole point). */
  byClass: Partial<Record<HeldClassId, number>>;
  /** The oldest qualifying row's quiet age, in days. */
  oldestQuietDays: number;
  /** Failures, honest: a door that refused is never counted as filed. */
  failed: number;
  dryRun: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const tally = (rows: Graduate[]): Partial<Record<HeldClassId, number>> => {
  const out: Partial<Record<HeldClassId, number>> = {};
  for (const g of rows) out[g.cls] = (out[g.cls] ?? 0) + 1;
  return out;
};

/**
 * Run the lane for ONE user. Read-only unless `apply: true`.
 *
 * Hosted by the judgment sweep (its cron already runs every two hours and already walks the same
 * accounts) — but it shares nothing with the judge: this is deterministic filing, not reasoning.
 */
export async function runGraduationLane(
  admin: SupabaseClient, userId: string,
  opts: { apply?: boolean; cap?: number; days?: number; selfEmail?: string | null; deadlineMs?: number } = {},
): Promise<GraduationResult> {
  const cap = opts.cap ?? GRADUATION_CAP;
  const days = opts.days ?? GRADUATION_DAYS;
  const todayISO = new Date().toISOString().slice(0, 10);

  const derived = await deriveHeld(admin, userId, opts.selfEmail ?? null);
  const all = selectGraduates(derived.facts, todayISO, { days });
  const take = all.slice(0, Math.max(0, cap));

  const out: GraduationResult = {
    eligible: all.length,
    filed: 0,
    leftBehind: Math.max(0, all.length - take.length),
    byClass: tally(all),
    oldestQuietDays: all.length ? all[0].quietDays : 0,
    failed: 0,
    dryRun: !opts.apply,
  };
  if (!opts.apply || !take.length) return out;

  const { executeResolveInboxItem } = await import('@/lib/tools/item-actions');
  for (const g of take) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      out.leftBehind = all.length - out.filed - out.failed;
      break;
    }
    try {
      // THE ONE DOOR. `dismiss` (not `complete`): nothing was done about this item — it was filed
      // because nothing needed doing, which is precisely what dismiss records.
      const res = await executeResolveInboxItem({ client: admin as any, userId }, {
        itemId: g.itemId, resolution: 'dismiss', resolutionReason: GRADUATION_REASON,
      });
      if (res.ok) out.filed++; else out.failed++;
    } catch { out.failed++; }
  }
  return out;
}

/**
 * THE RECEIPT (Q3's last clause): how many rows filed themselves this calendar month, counted from
 * the activity log's own rows — never estimated, never derived from the ledger's current shape.
 */
export async function countGraduatedThisMonth(
  client: any, userId: string, now: Date = new Date(),
): Promise<number> {
  try {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const { count } = await client.from('activity_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('type', 'dismissed')
      .eq('metadata->>resolution_reason', GRADUATION_REASON)
      .gte('created_at', monthStart);
    return typeof count === 'number' ? count : 0;
  } catch { return 0; } // a receipt we cannot count is never a receipt we invent
}
