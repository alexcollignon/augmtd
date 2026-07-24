// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DAILY REPORT partition (Living-Home L1, docs/living-home-plan.md) — pure lane-splitting of the ONE
// ledger (buildWorkItems) into the report's tenses:
//   • doneToday       — what moved (resolved today: your items + team deliverables) → "Done today"
//   • needsYou        — open tasks in priority order → the `Task — {entity} — priority — due — blocked on`
//   • openQuestions   — waiting on a NAMED person (structural: counterparty + age) → "Open questions"
//   • triage          — fresh bodies of work (entity founded ~7d) not yet dated/engaged → "New & unsorted"
//   • meetingsToday   — today's calendar context (never actions)
// Lanes are DISJOINT (a dated fresh item is urgency-first → needsYou, not triage). Pure: no queries, no
// AI — grounded-or-absent by construction; the L3 renderer + composer narrate over exactly these lanes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { WorkItem } from './model';

export type DailyReport = {
  doneToday: WorkItem[];       // your resolutions today (state done, resolved today) + team deliverables
  needsYou: WorkItem[];        // open, yours, priority-desc (excl. events/deliverables/questions/triage)
  openQuestions: WorkItem[];   // waiting + a NAMED counterparty (blockedOn) — oldest first (staleness)
  triage: WorkItem[];          // fresh-entity, undated, open — "new, needs a look"
  stale: WorkItem[];           // the QUIET TAIL — long-overdue / long-untouched open items ("say less
                               // than you know"): folded behind a count, never leading the list
  meetingsToday: WorkItem[];   // calendar context for today (kind 'event')
  counts: { done: number; open: number; questions: number; triage: number; stale: number; automatedOpen: number };
};

// Staleness policy: overdue by MORE than this many days, or untouched for longer, folds into the quiet
// tail — an item that's been ignored for a month must not lead today's report at P100.
const STALE_OVERDUE_DAYS = 30;
const STALE_UNTOUCHED_DAYS = 45;

export function partitionDailyReport(items: WorkItem[], todayStr: string): DailyReport {
  const doneToday: WorkItem[] = [];
  const needsYou: WorkItem[] = [];
  const openQuestions: WorkItem[] = [];
  const triage: WorkItem[] = [];
  const stale: WorkItem[] = [];
  const meetingsToday: WorkItem[] = [];
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const isStale = (w: WorkItem): boolean => {
    if (w.when.explicit && w.when.explicit < todayStr) {
      return (todayMs - Date.parse(w.when.explicit)) / 86_400_000 > STALE_OVERDUE_DAYS;
    }
    const ref = Date.parse(w.at || w.startAt);
    return !Number.isNaN(ref) && (todayMs - ref) / 86_400_000 > STALE_UNTOUCHED_DAYS;
  };

  for (const w of items) {
    if (w.kind === 'event') {
      if (w.startAt === todayStr) meetingsToday.push(w);
      continue; // calendar is context, never a task lane
    }
    if (w.state === 'done') {
      // Resolved TODAY (w.at carries resolved_at for completed items) — team deliverables ride along.
      if (String(w.at).slice(0, 10) === todayStr) doneToday.push(w);
      continue;
    }
    if (w.state === 'dismissed') continue;
    // Open — route to ONE lane (disjoint). Stale folds FIRST (a month-ignored item never leads today).
    if (isStale(w)) { stale.push(w); continue; }
    if (w.state === 'waiting' && w.blockedOn) { openQuestions.push(w); continue; }
    if (w.triage && !w.when.explicit) { triage.push(w); continue; } // fresh + undated → a look, not a deadline
    needsYou.push(w);
  }

  needsYou.sort((a, b) => b.priority - a.priority || a.at.localeCompare(b.at));
  openQuestions.sort((a, b) => a.startAt.localeCompare(b.startAt)); // oldest wait first — staleness leads
  doneToday.sort((a, b) => b.at.localeCompare(a.at));
  triage.sort((a, b) => b.at.localeCompare(a.at));
  stale.sort((a, b) => b.priority - a.priority);
  meetingsToday.sort((a, b) => a.at.localeCompare(b.at));

  return {
    doneToday, needsYou, openQuestions, triage, stale, meetingsToday,
    counts: {
      done: doneToday.length, open: needsYou.length, questions: openQuestions.length,
      triage: triage.length, stale: stale.length, automatedOpen: needsYou.filter((w) => w.automated).length,
    },
  };
}

/** Task-title cleanliness: strip reply/forward prefixes (any depth, any locale variant we see) so the
 *  report reads as TASKS, not mail subjects. Presentation-only — the row keeps its raw title. */
export function cleanTitle(title: string): string {
  return title.replace(/^\s*((re|fwd?|fw|aw|enc|sv|vs)\s*:\s*)+/i, '').trim() || title.trim();
}

/** The ONE line grammar — `Title — {entity} — due — blocked on X` — as plain text (the smoke's preview +
 *  the chat/report's textual projection; the L3 renderer is the same grammar with live chips). */
export function reportLine(w: WorkItem, todayStr: string): string {
  const parts = [cleanTitle(w.title).slice(0, 80)];
  if (w.entity) parts.push(w.entity.name);
  if (w.when.explicit) parts.push(w.when.explicit < todayStr ? `overdue (was ${w.when.explicit})` : w.when.explicit === todayStr ? 'due today' : `due ${w.when.explicit}`);
  if (w.blockedOn) parts.push(`blocked on ${w.blockedOn}`);
  return parts.join(' — ');
}
