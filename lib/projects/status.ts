// Project STATUS — the human "current state + what's next" line for a project, one layer up from the raw
// health rollup (lib/projects/health.ts). Health answers "is it OK?" (on_track/needs_attention/stalled/
// clear); STATUS answers "what's happening and what's my next move?" in words a person reads at a glance:
// Active · Waiting · On hold · Needs attention · Clear, plus the single next action. Deterministic — derived
// from the project's WorkItems + health, no AI. Agnostic: no per-project naming, pure state machine.

import type { WorkItem } from '@/lib/work-items/model';
import type { ProjectHealth } from './health';

export type ProjectStatusTone = 'emerald' | 'blue' | 'amber' | 'rose' | 'neutral';
export type ProjectStatus = {
  label: string;                                   // Active / Waiting / On hold / Needs attention / Clear
  tone: ProjectStatusTone;
  detail: string;                                  // a one-line human sentence
  nextAction: { title: string; href: string } | null; // the single next move (soonest-dated open task)
};

const STALE_DAYS = 14;

export function computeProjectStatus(
  health: ProjectHealth | undefined,
  items: WorkItem[],
  todayStr: string,
): ProjectStatus {
  const todo = items.filter((w) => w.state === 'todo');
  const waiting = items.filter((w) => w.state === 'waiting');
  const open = todo.length + waiting.length;
  const overdue = health?.overdue ?? items.filter((w) => (w.state === 'todo' || w.state === 'waiting') && w.when.bucket === 'overdue').length;
  const staleDays = health?.lastActivityDays ?? null;

  // Next move = the soonest-dated open task (todo first, then waiting); undated falls back to most recent.
  const pool = todo.length ? todo : waiting;
  const nextItem = [...pool].sort((a, b) => {
    const ax = a.when.explicit, bx = b.when.explicit;
    if (ax && bx) return ax.localeCompare(bx);
    if (ax) return -1;
    if (bx) return 1;
    return b.at.localeCompare(a.at);
  })[0] ?? null;
  const nextAction = nextItem ? { title: nextItem.title, href: nextItem.href } : null;

  let label = 'Active', tone: ProjectStatusTone = 'emerald', detail = '';
  if (open === 0) {
    label = 'Clear'; tone = 'neutral'; detail = 'Nothing pending — all handled.';
  } else if (overdue > 0) {
    label = 'Needs attention'; tone = 'rose'; detail = `${overdue} item${overdue > 1 ? 's' : ''} overdue.`;
  } else if (staleDays != null && staleDays > STALE_DAYS) {
    label = 'On hold'; tone = 'amber'; detail = `Quiet for ${staleDays} days — may need a nudge.`;
  } else if (todo.length === 0 && waiting.length > 0) {
    label = 'Waiting'; tone = 'blue'; detail = `Ball in their court — waiting on ${waiting.length}.`;
  } else {
    label = 'Active'; tone = 'emerald'; detail = `${todo.length} to do${waiting.length ? ` · ${waiting.length} waiting` : ''}.`;
  }
  return { label, tone, detail, nextAction };
}

/**
 * The status LABEL from the health rollup alone (no items) — for the portfolio glance, where cards carry
 * `health` but not the full WorkItem list. Same state machine as computeProjectStatus, minus the next-move.
 */
export function statusFromHealth(health: ProjectHealth | undefined): { label: string; tone: ProjectStatusTone } {
  if (!health || health.open === 0) return { label: 'Clear', tone: 'neutral' };
  if (health.overdue > 0) return { label: 'Needs attention', tone: 'rose' };
  if (health.lastActivityDays != null && health.lastActivityDays > STALE_DAYS) return { label: 'On hold', tone: 'amber' };
  if (health.waiting > 0 && health.open === health.waiting) return { label: 'Waiting', tone: 'blue' };
  return { label: 'Active', tone: 'emerald' };
}

export const STATUS_TONE: Record<ProjectStatusTone, { dot: string; text: string; bg: string; border: string }> = {
  emerald: { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  blue:    { dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-100' },
  amber:   { dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-100' },
  rose:    { dot: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-100' },
  neutral: { dot: 'bg-neutral-300', text: 'text-neutral-500', bg: 'bg-neutral-50', border: 'border-neutral-200' },
};
