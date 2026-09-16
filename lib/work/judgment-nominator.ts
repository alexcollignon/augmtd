// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NOMINATOR (proactive-reach LAW 1 — THE REACH LAW, docs/proactive-reach-plan.md).
//
// "Every actionable item is guaranteed a judgment revisit cadence. Reach is scheduled, not
// incidental." The nominator is the ONE place that answers WHICH item gets its turn — pure,
// deterministic, ZERO AI (no supabase, no model, no clock of its own: the caller supplies the
// user's own today). The judge still decides what an item MEANS; the nominator only decides the
// order in which the judge reaches things.
//
// THE ORDER (the measured failure it exists to fix: on the reference account 437 actionable items,
// 313 never judged, anchor-passed items unvisited for 5+ days while the deck kept speaking their
// stale verdicts):
//   1. ANCHOR-PASSED FIRST — the item's own CODE-VERIFIABLE anchor (the understanding's extracted
//      deadline, a commitment's due_date, a meeting with its counterparty that has since started)
//      lies in the past on the USER'S clock. These are the only items whose standing verdict can
//      now be FALSE ABOUT TIME (the standing sentence) — they lead, and inside the tier the ones
//      whose judgment predates the anchor lead again (a verdict formed before the date passed is
//      exactly the lie).
//   2. LEAST-RECENTLY-JUDGED — never judged counts as oldest (an unjudged row may exist; an
//      unjudged row leading the deck may not).
//   3. ACTIVITY RECENCY — the freshest thread breaks the tie.
//
// AGNOSTIC BY CONSTRUCTION: every fact is derived from the caller's own rows (dates, timestamps).
// No token, sender, language, provider or account is named anywhere in this module.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One candidate for judgment — projected from the work-item spine by the caller. */
export type NominatorItem = {
  /** The judgment cache key: `inbox:<id>` | `commitment:<id>` (item_plans.entity_id). */
  key: string;
  /** The item's own stated, code-verified anchor date (YYYY-MM-DD) — deadline / due date. */
  anchor: string | null;
  /** Reference activity timestamp (ISO) — the spine's `at`. */
  activityAt: string | null;
  /** Optional: a meeting involving this item's counterparty that has already STARTED (ISO). The
   *  caller resolves it deterministically (one batched calendar read); null when unknown. */
  meetingPassedAt?: string | null;
  /** LAW 4 · ONE CONVERSATION, ONE OBLIGATION: when the SAME human conversation was settled on
   *  another thread, that item is handed to the judge as a nomination (ISO). It is not a verdict —
   *  the judge still decides — but it is the strongest reason to visit an item TODAY, so it leads
   *  the queue. Self-clearing: a nomination only outranks while the judgment on record predates it
   *  (once judged with the fact in hand, the item falls back into the ordinary tiers). */
  nominatedAt?: string | null;
  /** Free label for reporting only — never used in the ordering. */
  title?: string;
};

/** What the judgment cache knows about a key: when it was last written (ISO), or null = never. */
export type JudgmentAge = { key: string; judgedAt: string | null };

export type AnchorStatus = {
  passed: boolean;
  /** The anchor that passed (YYYY-MM-DD) — null when nothing passed. */
  anchor: string | null;
  /** How many whole days ago it passed, on the user's calendar. 0 = never/today. */
  daysPast: number;
  /** Where the anchor came from — reporting + the judge's fact line. */
  source: 'stated_date' | 'meeting_started' | null;
};

const DAY_MS = 86_400_000;

/** Whole days between two YYYY-MM-DD days (b - a), calendar arithmetic only. */
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`), tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / DAY_MS);
}

const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** THE ANCHOR TEST (pure): does this item carry a code-verifiable date that has already passed on
 *  the user's own calendar? The stated date wins over the meeting signal (it is the item's own
 *  word); a meeting only counts when it started AFTER the item's own activity — a standing weekly
 *  call with a frequent counterparty is not this item's anchor. */
export function anchorStatusOf(item: NominatorItem, todayStr: string): AnchorStatus {
  if (isDay(item.anchor) && item.anchor < todayStr) {
    return { passed: true, anchor: item.anchor, daysPast: daysBetween(item.anchor, todayStr), source: 'stated_date' };
  }
  const m = item.meetingPassedAt ? String(item.meetingPassedAt).slice(0, 10) : null;
  if (isDay(m) && m < todayStr && (!item.activityAt || String(item.activityAt).slice(0, 10) <= m)) {
    return { passed: true, anchor: m, daysPast: daysBetween(m, todayStr), source: 'meeting_started' };
  }
  return { passed: false, anchor: isDay(item.anchor) ? item.anchor : null, daysPast: 0, source: null };
}

export type Nomination = {
  item: NominatorItem;
  rank: number;                 // 1-based
  /** A sibling conversation settled elsewhere and the judgment on record predates that news. */
  siblingNominated: boolean;
  anchorPassed: boolean;
  anchorDaysPast: number;
  anchorSource: AnchorStatus['source'];
  /** The judgment on record predates the anchor (or there is none) — the lie-risk case. */
  unseenSinceAnchor: boolean;
  lastJudgedAt: string | null;
  /** Whole days since the last judgment; null = never judged (ranked as the oldest possible). */
  judgedAgeDays: number | null;
  /** One honest line: why this item is where it is. */
  reason: string;
};

function ageDays(judgedAt: string | null, todayStr: string): number | null {
  if (!judgedAt) return null;
  const d = String(judgedAt).slice(0, 10);
  return isDay(d) ? Math.max(0, daysBetween(d, todayStr)) : null;
}

/** Least-recently-judged comparator value — never judged sorts as infinitely old. */
const staleness = (n: Nomination) => (n.judgedAgeDays === null ? Number.POSITIVE_INFINITY : n.judgedAgeDays);

function decorate(items: NominatorItem[], judgments: JudgmentAge[], todayStr: string): Nomination[] {
  const judged = new Map<string, string | null>();
  for (const j of judgments) if (!judged.has(j.key)) judged.set(j.key, j.judgedAt ?? null);
  return items.map((item) => {
    const st = anchorStatusOf(item, todayStr);
    const lastJudgedAt = judged.get(item.key) ?? null;
    const jAge = ageDays(lastJudgedAt, todayStr);
    // A verdict formed BEFORE the anchor passed has never seen the date go by — the standing claim
    // can be false about time. Same-day counts as unseen: the judgment may predate the hour.
    const unseenSinceAnchor = st.passed && (!lastJudgedAt || String(lastJudgedAt).slice(0, 10) <= String(st.anchor));
    // LAW 4's seam, self-clearing: the nomination outranks only while the judgment predates it.
    const siblingNominated = !!item.nominatedAt && (!lastJudgedAt || String(lastJudgedAt) < String(item.nominatedAt));
    const reason = [
      siblingNominated ? 'the same conversation was settled elsewhere (nominated)' : null,
      st.passed
        ? `anchor ${st.anchor} passed ${st.daysPast}d ago (${st.source === 'meeting_started' ? 'meeting started' : 'stated date'})`
        : null,
      lastJudgedAt ? `judged ${jAge}d ago` : 'never judged',
      st.passed && unseenSinceAnchor ? 'judgment predates the anchor' : null,
      item.activityAt ? `activity ${String(item.activityAt).slice(0, 10)}` : null,
    ].filter(Boolean).join(' · ');
    return {
      item, rank: 0, siblingNominated, anchorPassed: st.passed, anchorDaysPast: st.daysPast, anchorSource: st.source,
      unseenSinceAnchor, lastJudgedAt, judgedAgeDays: jAge, reason,
    };
  });
}

function rank(list: Nomination[], cmp: (a: Nomination, b: Nomination) => number): Nomination[] {
  const out = [...list].sort((a, b) => cmp(a, b) || a.item.key.localeCompare(b.item.key));
  out.forEach((n, i) => { n.rank = i + 1; });
  return out;
}

/** Activity recency, newest first (a missing timestamp sorts last). */
const byActivityDesc = (a: Nomination, b: Nomination) =>
  String(b.item.activityAt ?? '').localeCompare(String(a.item.activityAt ?? ''));

/**
 * THE REACH ORDER — which item the judge visits next. Pure, zero-AI, total and stable.
 * (0) SIBLING-NOMINATED FIRST (LAW 4, additive: the same conversation was settled somewhere else
 * and this item's standing verdict has not seen that news — the one case where an item is known to
 * be speaking about a closed matter), (1) anchor-passed (judgment-predates-the-anchor first inside
 * the tier, then the oldest anchor), (2) least-recently-judged (never judged = oldest),
 * (3) activity recency. With no nomination the order is byte-identical to what it always was.
 */
export function nominateForJudgment(
  items: NominatorItem[], judgments: JudgmentAge[], opts: { todayStr: string },
): Nomination[] {
  return rank(decorate(items, judgments, opts.todayStr), (a, b) =>
    (Number(b.siblingNominated) - Number(a.siblingNominated))
    || (Number(b.anchorPassed) - Number(a.anchorPassed))
    || (a.anchorPassed ? Number(b.unseenSinceAnchor) - Number(a.unseenSinceAnchor) : 0)
    || (a.anchorPassed ? b.anchorDaysPast - a.anchorDaysPast : 0)
    || (staleness(b) - staleness(a))
    || byActivityDesc(a, b));
}

/**
 * THE PREPARATION ORDER — the same ONE module, the pass's dimension. Reach leads (an item whose
 * anchor has passed must be judged before anything is prepared FOR it — preparing a reply to a
 * meeting that already happened is the exact cost the arc exists to end), then the pass's own W2
 * discipline: never-attempted first, then the brain's reasoned entity weight.
 *
 * There is deliberately no second ordering anywhere: the pass calls this, the sweep calls
 * nominateForJudgment, and both share the one anchor/staleness derivation above.
 */
export function orderForPreparation(
  items: NominatorItem[], judgments: JudgmentAge[],
  opts: { todayStr: string; attempted: (key: string) => boolean; weightOf: (key: string) => number },
): Nomination[] {
  return rank(decorate(items, judgments, opts.todayStr), (a, b) =>
    (Number(b.anchorPassed) - Number(a.anchorPassed))
    || (Number(opts.attempted(a.item.key)) - Number(opts.attempted(b.item.key)))
    || (opts.weightOf(b.item.key) - opts.weightOf(a.item.key))
    || (staleness(b) - staleness(a)));
}

/**
 * THE ANCHOR FACT the judge reads (facts, never a law): a code-computed line stating that the
 * item's own stated date has passed and by how much. The judge still decides what that means —
 * an ended meeting is moot, an unpaid invoice is not (its July law stands). Empty string when
 * nothing passed, so the prompt simply has no line.
 */
export function anchorPassedFact(anchor: string | null, todayStr: string): string {
  if (!isDay(anchor) || anchor >= todayStr) return '';
  const d = daysBetween(anchor, todayStr);
  return `THE ITEM'S OWN STATED DATE (${anchor}) PASSED ${d} day${d === 1 ? '' : 's'} ago on the user's calendar (computed in code, not inferred). ` +
    `That is a fact about the calendar, not a verdict: decide whether the thing this asks about is now moot (work="none", resolution="expired") ` +
    `or still genuinely owed late (an unpaid invoice, an unanswered substantive ask) — judge it, never assume either.\n`;
}
