// Pure + dependency-free — SAFE to import from client components. (lib/work-items/model.ts is NOT: it
// pulls the server-only spine graph — googleapis/microsoft via the reconcile chain — so importing a
// runtime value from it into a client bundle breaks the build with `Can't resolve 'fs'/'net'`.)
//
// Where a work item sits on a Gantt/date axis — the SINGLE shared rule used by BOTH the per-project Gantt
// and the portfolio Gantt (and the /api/projects/gantt route), so they can never disagree. A resolved
// item lands at WHEN IT HAPPENED (its resolution/activity date, never a future due date it once carried);
// an open dated item lands at its due date; an open undated item lands at "now" (current, not historical).

type GanttItemShape = { state: string; when: { explicit: string | null }; at: string };

export function ganttDateOf(w: GanttItemShape, todayStr: string): string {
  if (w.state === 'done' || w.state === 'dismissed') return (w.at || w.when.explicit || todayStr).slice(0, 10);
  if (w.when.explicit) return w.when.explicit;
  const at = (w.at || todayStr).slice(0, 10);
  return at > todayStr ? at : todayStr;
}

// The EVENT a timeline should show for an item — the user's mental model: "when was it DONE, and are there
// DEADLINES?". Not a duration. Resolves each item to ONE meaningful point + its type:
//   • done  → the date it was completed (a past event)
//   • due   → its real deadline (a future/overdue event) — only when the item actually states one
//   • undated → no done-date and no deadline → NOT plotted (projecthood-plan P3: an undated item can
//     never claim a date; the arrival-dot fallback painted walls of same-day dots that read as fake
//     schedule). Consumers fold undated items into their group as a count.
// `arrival` rides along so a due item can draw a faint runway (arrival → deadline).
export type GanttMarker = 'done' | 'due' | 'undated';
export function ganttMarkerOf(
  w: GanttItemShape & { startAt?: string },
  todayStr: string,
): { marker: GanttMarker; date: string; arrival: string; overdue: boolean } {
  const arrival = (w.startAt || w.at || todayStr).slice(0, 10);
  if (w.state === 'done' || w.state === 'dismissed') return { marker: 'done', date: (w.at || todayStr).slice(0, 10), arrival, overdue: false };
  if (w.when.explicit) return { marker: 'due', date: w.when.explicit, arrival, overdue: w.when.explicit < todayStr };
  return { marker: 'undated', date: arrival, arrival, overdue: false };
}
