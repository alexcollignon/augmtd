// Project HEALTH — an auto-derived rollup of a project's tasks (NOT a manual status). Health is a
// zoom-OUT summary computed from the same WorkItems the timeline shows; it never hides a task's deadline
// (an overdue task surfaces on the timeline AND flips its project to "needs attention"). A small,
// principled set — the meaningful portfolio signal ("is it on track?"), agnostic to any user's naming.

import type { WorkItem } from '@/lib/work-items/model';

export type ProjectHealthStatus = 'on_track' | 'needs_attention' | 'stalled' | 'clear';

export type ProjectHealth = {
  status: ProjectHealthStatus;
  open: number;       // todo + waiting (still on the plate)
  done: number;       // resolved recently
  overdue: number;    // explicit-dated tasks past due (the strongest "needs attention" signal)
  waiting: number;    // ball in someone else's court
  lastActivityDays: number | null; // days since the most recent movement (staleness)
};

const STALE_DAYS = 14;

export const HEALTH_META: Record<ProjectHealthStatus, { label: string; dot: string; text: string; bg: string }> = {
  on_track:        { label: 'On track',        dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  needs_attention: { label: 'Needs attention', dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50' },
  stalled:         { label: 'Stalled',         dot: 'bg-rose-400',    text: 'text-rose-600',    bg: 'bg-rose-50' },
  clear:           { label: 'All clear',       dot: 'bg-neutral-300', text: 'text-neutral-500', bg: 'bg-neutral-50' },
};

export function computeProjectHealth(items: WorkItem[], todayStr: string): ProjectHealth {
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const open = items.filter((w) => w.state === 'todo' || w.state === 'waiting').length;
  const done = items.filter((w) => w.state === 'done').length;
  const waiting = items.filter((w) => w.state === 'waiting').length;
  const overdue = items.filter((w) => (w.state === 'todo' || w.state === 'waiting') && w.when.bucket === 'overdue').length;

  const latest = items.reduce((mx, w) => (w.at > mx ? w.at : mx), '');
  const lastActivityDays = latest ? Math.max(0, Math.round((todayMs - Date.parse(latest.slice(0, 10))) / 86_400_000)) : null;

  let status: ProjectHealthStatus;
  if (open === 0) status = 'clear';                                   // nothing pending — handled
  else if (overdue > 0) status = 'needs_attention';                    // a real deadline slipped
  else if (lastActivityDays != null && lastActivityDays > STALE_DAYS) status = 'stalled'; // gone quiet
  else status = 'on_track';

  return { status, open, done, overdue, waiting, lastActivityDays };
}
