// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LIVING STATUS BRIEF (workbench B1b) — the deal's "Current status" card: What it is · Priority
// now · Key dates · People · Deliverables · Watch-outs.
//
// ZERO new AI, by design: every line is either ALREADY JUDGED (state summary, next move, evaluator
// objections — the synthesis/evaluator did the reasoning) or ALREADY A FACT (due dates, meeting
// dates, pool rows, registry-canonical names). This module only ASSEMBLES — plumbing. One source:
// the room's Overview lead AND the share-status-update compose read the same assembly.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type StatusBrief = {
  whatItIs: string | null;
  priorityNow: string | null;
  keyDates: Array<{ date: string; label: string; href: string | null }>;
  people: string[];
  deliverables: Array<{ title: string; by: string | null; at: string | null; ref: string | null }>;
  watchOuts: string[];
};

export function assembleStatusBrief(args: {
  state: { summary?: string; blocking?: string | null } | null;
  nextMove: { title?: string } | null;
  rows: Array<{ title: string; who: string | null; when: string | null; href: string }>;
  meetings: Array<{ id: string; title: string; date: string | null }>;
  deliverables: Array<{ id: string; title: string | null; by: string | null; at: string | null }>;
  reviews: string[]; // evaluator objections riding stored artifacts (flag/revise verdicts)
  /** Registry canonicalizer — returns the canonical display name, or null to omit (self/automated). */
  resolveName?: (who: string) => string | null;
  todayStr: string;
}): StatusBrief {
  const { state, nextMove, rows, meetings, deliverables, reviews, resolveName, todayStr } = args;

  // Key dates — dated obligations + meetings, chronological; the recent past stays for context.
  const floor = new Date(Date.parse(`${todayStr}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const dates: Array<{ date: string; label: string; href: string | null }> = [
    ...rows.filter((r) => r.when && r.when >= floor).map((r) => ({ date: r.when!, label: r.title.slice(0, 70), href: r.href || null })),
    ...meetings.filter((m) => m.date && m.date >= floor).map((m) => ({ date: m.date!, label: `Meeting · ${m.title.slice(0, 60)}`, href: `/item/${m.id}?kind=meeting` })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);

  // People — the deal's counterparties through the registry (canonical, self excluded).
  const people: string[] = [];
  for (const r of rows) {
    if (!r.who) continue;
    const name = resolveName ? resolveName(r.who) : r.who.split('<')[0].trim();
    if (name && !people.includes(name)) people.push(name);
    if (people.length >= 6) break;
  }

  const watchOuts = [
    ...(state?.blocking ? [String(state.blocking)] : []),
    ...reviews.filter(Boolean),
  ].slice(0, 4);

  return {
    whatItIs: state?.summary?.trim() || null,
    priorityNow: nextMove?.title?.trim() || null,
    keyDates: dates,
    people,
    deliverables: deliverables
      .filter((d) => d.title)
      .map((d) => ({ title: String(d.title).slice(0, 70), by: d.by, at: d.at?.slice(0, 10) ?? null, ref: d.id }))
      .slice(0, 6),
    watchOuts,
  };
}
