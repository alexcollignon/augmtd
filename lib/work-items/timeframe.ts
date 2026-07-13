// Timeframe inference for the unified work-item spine. A work item lands in ONE temporal bucket. The
// point of AUGMTD's timeline (vs a generic Gantt) is that it works even when NO date was ever set — so
// most items are placed by REASONED signal (kind + state + age + meeting proximity), never a fake date.
//
// HONESTY RULES (locked):
//   • An undated item can NEVER be "overdue" — you can't miss a deadline that was never stated.
//   • An AUTOMATED notice can never be "overdue" either — a no-reply billing/promo/expiry date is not a
//     personal commitment you let slip; a past one is a stale notice, not a failure. It drops to the quiet
//     background instead of shouting red. (Future automated dates keep their normal bucket — a real
//     "billing changes next week" is useful to see coming.)
//   • We never fabricate a precise date; an inferred item stays a labeled bucket, not a fake day.
// Phase 1 is fully DETERMINISTIC (cheap, predictable, no AI). A later slice may refine undated buckets
// with a cached classification-tier reasoning pass — the shape here already supports it (swap inferBucket).

export type TimeBucket = 'overdue' | 'today' | 'this_week' | 'soon' | 'later' | 'someday';

// Display order + labels for the timeline lanes (past/done is handled separately by state, not a bucket).
export const BUCKET_ORDER: TimeBucket[] = ['overdue', 'today', 'this_week', 'soon', 'later', 'someday'];
export const BUCKET_LABELS: Record<TimeBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  this_week: 'This week',
  soon: 'Soon',
  later: 'Later',
  someday: 'Someday',
};

const DAY = 86_400_000;

/** Whole-day difference (b - a) in local-ish days from two YYYY-MM-DD or ISO strings. */
function dayDiff(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO.slice(0, 10));
  const b = Date.parse(toISO.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY);
}

export type BucketInput = {
  /** An EXPLICIT date the source actually stated (due_date, a meeting's date). null when none. */
  explicit: string | null;
  /** 'waiting' items (ball in the other court) drift later; obligations pull sooner. */
  waiting: boolean;
  /** Age of the item in days (from created/last-activity), used only for UNDATED inference. */
  ageDays: number;
  /** todayStr = YYYY-MM-DD, passed in so the caller controls "now" (testable, no ambient Date in hot paths). */
  todayStr: string;
  /** An automated/no-reply notice (billing/promo/expiry). A PAST date on one is a stale notice, never "overdue". */
  automated?: boolean;
};

/**
 * The single bucket resolver. Explicit date → precise bucket (incl. the only legitimate "overdue").
 * Undated → a reasoned soft bucket from waiting/age (never "overdue", never a fabricated date).
 */
export function inferBucket({ explicit, waiting, ageDays, todayStr, automated }: BucketInput): TimeBucket {
  if (explicit) {
    const d = dayDiff(todayStr, explicit);
    // A past date on an automated notice is a stale notice, not a missed personal obligation → background it.
    if (d < 0) return automated ? 'someday' : 'overdue';
    if (d === 0) return 'today';
    if (d <= 7) return 'this_week';
    if (d <= 30) return 'later';
    return 'someday';
  }
  // Undated. The other party owes → it can sit further out; you owe / a reply is due → pull it in by freshness.
  if (waiting) return ageDays <= 14 ? 'later' : 'someday';
  if (ageDays <= 2) return 'soon';
  if (ageDays <= 14) return 'this_week';
  return 'someday';
}
