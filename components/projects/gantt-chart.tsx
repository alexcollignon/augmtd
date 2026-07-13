'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

// ── GanttChart — the shared timeline used by BOTH the portfolio (all projects) and a single project's
// detail. It answers the questions a timeline should: "what was DONE and when", and "what's DUE and when".
// Each task is a dated EVENT, not a duration: done → a check at its completion date, due → a diamond at its
// real deadline (a faint runway shows the arrival→deadline lead time; overdue turns rose), and everything
// else → a neutral dot at when it arrived. Left task-tree · week columns · today line · the date on every
// row. No dependency arrows / assignees / progress — that data doesn't exist here.

export type GanttItem = { title: string; who: string | null; state: string; marker: 'done' | 'due' | 'open'; date: string; arrival: string; overdue: boolean; href?: string | null };
export type GanttGroup = { id: string; name: string; statusDot?: string; items: GanttItem[] };

// STATUS (what state the work is in) — distinct from the EVENT marker (when it happened / is due). The
// left-tree dot uses this so a row shows both: its status AND its dated event.
const STATUS: Record<string, { dot: string; text: string; label: string }> = {
  todo:        { dot: 'bg-indigo-500',  text: 'text-indigo-600',  label: 'To do' },
  waiting:     { dot: 'bg-amber-400',   text: 'text-amber-600',   label: 'Pending' },
  in_progress: { dot: 'bg-indigo-400',  text: 'text-indigo-600',  label: 'In progress' },
  done:        { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Done' },
};
const statusOf = (s: string) => STATUS[s] ?? STATUS.todo;

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const minS = (a: string, b: string) => (a < b ? a : b);
const maxS = (a: string, b: string) => (a > b ? a : b);

const DAY_W = 15;    // px per day
const LABEL_W = 300; // left task-tree width (roomy enough for a readable title + who)
const ROW_H = 30;    // px per row


function cleanWho(who: string | null): string | null {
  if (!who) return null;
  let s = who.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').trim();
  if (/^[^\s@]+@[^\s@]+$/.test(s)) s = s.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return s || null;
}
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function GanttChart({ groups, today, onOpenGroup, emptyLine }: {
  groups: GanttGroup[]; today: string; onOpenGroup?: (id: string) => void; emptyLine?: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Guard against a stale/partial cache shape: only keep valid YYYY-MM-DD strings (a missing date would
  // propagate NaN into a `left`/`width` style and crash the render).
  const isDate = (d: unknown): d is string => typeof d === 'string' && Number.isFinite(ms(d));
  const allDates = groups.flatMap((g) => g.items.flatMap((i) => [i.arrival, i.date])).filter(isDate);
  if (!allDates.length) {
    return <div className="mt-4 rounded-xl border border-dashed border-neutral-200 px-6 py-12 text-center text-[13px] text-neutral-400">{emptyLine || 'Work will appear here on the timeline as it’s captured.'}</div>;
  }

  // Hug the ACTUAL work: pad a few days on each side of today for context, but don't stretch weeks into an
  // empty future when nothing is scheduled there (that made the timeline read as mostly-blank). Real future
  // due dates still extend the range naturally via the item ends.
  let minD = allDates.reduce(minS, allDates[0]);
  let maxD = allDates.reduce(maxS, allDates[0]);
  minD = minS(minD, addDays(today, -7));
  maxD = maxS(maxD, addDays(today, 10));
  const trackW = (days(minD, maxD) + 1) * DAY_W;
  const clampD = (d: string) => (!isDate(d) ? minD : d < minD ? minD : d > maxD ? maxD : d);
  const xOf = (d: string) => { const n = days(minD, clampD(d)) * DAY_W; return Number.isFinite(n) ? Math.max(0, n) : 0; };

  // Week ticks (every 7 days from the range start) — the reference's week columns.
  const weeks: string[] = [];
  { let c = minD; while (c <= maxD) { weeks.push(c); c = addDays(c, 7); } }
  const todayX = xOf(today);

  // Status roll-up across everything shown — "what's done, to do, pending" at a glance.
  const roll = { todo: 0, waiting: 0, done: 0, overdue: 0 };
  for (const g of groups) for (const it of g.items) {
    if (it.state === 'done') roll.done++;
    else if (it.state === 'waiting' || it.state === 'in_progress') roll.waiting++;
    else roll.todo++;
    if (it.marker === 'due' && it.overdue) roll.overdue++;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200/70">
      <div style={{ minWidth: LABEL_W + trackW }}>
        {/* Status roll-up — what's to do / pending / done (+ overdue), across the whole timeline. */}
        <div className="flex items-center gap-4 px-3 py-2 border-b border-neutral-100 text-[11px] font-medium">
          <span className="inline-flex items-center gap-1.5 text-indigo-600"><span className="w-2 h-2 rounded-full bg-indigo-500" />{roll.todo} to do</span>
          <span className="inline-flex items-center gap-1.5 text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400" />{roll.waiting} pending</span>
          <span className="inline-flex items-center gap-1.5 text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />{roll.done} done</span>
          {roll.overdue > 0 && <span className="inline-flex items-center gap-1.5 text-rose-600"><span className="w-2 h-2 rounded-full bg-rose-500" />{roll.overdue} overdue</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-neutral-400 font-normal"><span className="w-3 h-px bg-indigo-400" />today</span>
        </div>
        {/* Header row — "Task" + week columns */}
        <div className="flex items-stretch border-b border-neutral-200/70 bg-neutral-50/60">
          <div className="sticky left-0 z-30 bg-neutral-50/60 flex items-center px-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-400 border-r border-neutral-200/60" style={{ width: LABEL_W }}>Task</div>
          <div className="relative h-8 flex-shrink-0" style={{ width: trackW }}>
            {weeks.map((w) => <span key={w} className="absolute top-1.5 text-[10px] font-medium text-neutral-400 whitespace-nowrap" style={{ left: xOf(w) + 3 }}>{fmtDate(w)}</span>)}
          </div>
        </div>

        {/* Body */}
        <div className="relative">
          {/* week gridlines + today line */}
          <div className="absolute inset-0 pointer-events-none" style={{ marginLeft: LABEL_W }}>
            {weeks.map((w) => <div key={w} className="absolute top-0 bottom-0 w-px bg-neutral-100" style={{ left: xOf(w) }} />)}
            <div className="absolute top-0 bottom-0 w-px bg-indigo-400/70 z-10" style={{ left: todayX }} />
          </div>

          {groups.map((g) => {
            const open = !collapsed.has(g.id);
            const gStart = g.items.reduce((m, i) => minS(m, minS(i.arrival, i.date)), g.items[0] ? minS(g.items[0].arrival, g.items[0].date) : today);
            const gEnd = g.items.reduce((m, i) => maxS(m, i.date), g.items[0]?.date ?? today);
            return (
              <div key={g.id}>
                {/* Group header row */}
                <div className="relative flex items-center border-b border-neutral-100 bg-white" style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-20 bg-white h-full flex items-center gap-1.5 px-3 border-r border-neutral-200/60" style={{ width: LABEL_W }}>
                    <button onClick={() => toggle(g.id)} className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 transition-colors"><ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} /></button>
                    {g.statusDot && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${g.statusDot}`} />}
                    <button onClick={() => onOpenGroup?.(g.id)} className="min-w-0 flex-1 text-left text-[12.5px] font-semibold text-neutral-800 truncate hover:text-indigo-600 transition-colors" disabled={!onOpenGroup}>{g.name}</button>
                    <span className="flex-shrink-0 text-[10px] font-medium text-neutral-300 tabular-nums">{g.items.length}</span>
                  </div>
                  <div className="relative h-full flex-shrink-0" style={{ width: trackW }}>
                    {g.items.length > 0 && <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-neutral-200/80" style={{ left: xOf(gStart), width: Math.max(2, days(clampD(gStart), clampD(gEnd)) * DAY_W) }} />}
                  </div>
                </div>

                {/* Task rows — a dated EVENT per row (done / due / arrived), with the date shown. */}
                {open && g.items.map((it, idx) => {
                  const who = cleanWho(it.who);
                  const x = xOf(it.date);
                  const status = statusOf(it.state);
                  const dateStr = fmtDate(it.date);
                  // ONE color scheme = STATUS (matches the top roll-up + the left dot). Overdue is the only
                  // event flag that overrides the tone (it's urgent). The DATE tells you when — no separate
                  // "deadline / came in" legend needed.
                  const isOverdue = it.marker === 'due' && it.overdue;
                  const dotColor = isOverdue ? 'bg-rose-500' : status.dot;
                  const dateTone = isOverdue ? 'text-rose-600 font-semibold' : 'text-neutral-400';
                  const tip = `${it.title}${who ? ` · ${who}` : ''} · ${isOverdue ? 'Overdue' : status.label} · ${dateStr}`;
                  return (
                    <div key={idx} className="relative flex items-center border-b border-neutral-50 last:border-b-0 group hover:bg-neutral-50/50 transition-colors" style={{ height: ROW_H }}>
                      <div className="sticky left-0 z-20 bg-white group-hover:bg-[#fafafa] h-full flex items-center gap-2 pl-8 pr-3 border-r border-neutral-200/60" style={{ width: LABEL_W }}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.dot}`} title={status.label} />
                        {it.href ? (
                          <Link href={it.href} className="min-w-0 flex-1 flex items-baseline gap-1.5 group/l">
                            <span className="text-[12px] text-neutral-700 truncate min-w-0 flex-1 group-hover/l:text-indigo-600 transition-colors">{it.title}</span>
                            {who && <span className="text-[10.5px] text-neutral-400 truncate flex-shrink-0 max-w-[116px]">{who}</span>}
                          </Link>
                        ) : (
                          <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
                            <span className="text-[12px] text-neutral-700 truncate min-w-0 flex-1">{it.title}</span>
                            {who && <span className="text-[10.5px] text-neutral-400 truncate flex-shrink-0 max-w-[116px]">{who}</span>}
                          </div>
                        )}
                      </div>
                      <div className="relative h-full flex-shrink-0" style={{ width: trackW }}>
                        {/* the marker — one shape for every row (a status-colored dot at its date); done is
                            simply the emerald one, so it matches the rest instead of a stray check icon. */}
                        <span className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white z-10`} style={{ left: x }} title={tip} />
                        {/* the date label, just past the marker (or before it if it'd overflow the right edge) */}
                        <span className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-medium whitespace-nowrap ${dateTone} ${x > trackW - 64 ? 'text-right' : ''}`} style={x > trackW - 64 ? { right: trackW - x + 8 } : { left: x + 8 }}>{dateStr}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
