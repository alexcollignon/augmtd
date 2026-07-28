'use client';

import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { itemStateOf } from '@/lib/work-items/states';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

// ── GanttChart — the ONE shared timeline (Home Timeline lens + the project/deal room). TWO-PANE
// frozen layout: the left task tree is a real fixed pane (never inside the horizontal scroll — the
// old sticky-cells approach silently broke because the collapse wrapper's overflow:hidden disables
// position:sticky for its descendants), the date axis scrolls in its own pane, and the FULL-HEIGHT
// border between them is the drag handle (resizable, persisted). Each row = one dated EVENT (a
// status-colored dot at its meaningful date) + its EVENT TRAIL (small ticks along the track — what
// happened, when, by whom, from lib/work-items/gantt-badges). A marker outside the drawn range
// renders as an explicit edge chevron with its real (year-aware) date — never a fake in-range dot.

export type GanttItem = {
  title: string; who: string | null; state: string;
  marker: 'done' | 'due' | 'open' | 'undated'; date: string; arrival: string; overdue: boolean;
  href?: string | null;
  /** The event trail — dated actions on this item (ascending), from lib/work-items/gantt-badges. */
  events?: Array<{ date: string; label: string }>;
};
export type GanttGroup = { id: string; name: string; statusDot?: string; items: GanttItem[] };

// STATUS (what state the work is in) — distinct from the EVENT marker (when it happened / is due).
// The ONE item-state palette — lib/work-items/states.ts.
const statusOf = itemStateOf;

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const minS = (a: string, b: string) => (a < b ? a : b);
const maxS = (a: string, b: string) => (a > b ? a : b);

const DAY_W = 15;        // px per day
const LABEL_W_DEF = 300; // default left-pane width — the pane border is DRAGGABLE, persisted
const LABEL_W_MIN = 220;
const LABEL_W_MAX = 480;
const ROW_H = 30;        // px per row
const HEAD_H = 32;       // px header row

function cleanWho(who: string | null): string | null {
  if (!who) return null;
  let s = who.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').trim();
  if (/^[^\s@]+@[^\s@]+$/.test(s)) s = s.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return s || null;
}
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
// Year-aware — a clamped/off-range marker must never let "Aug 26" of another year read as this year's.
const fmtDateY = (d: string, today: string) =>
  d.slice(0, 4) === today.slice(0, 4) ? fmtDate(d) : new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function GanttChart({ groups, today, onOpenGroup, emptyLine }: {
  groups: GanttGroup[]; today: string; onOpenGroup?: (id: string, tab?: 'overview' | 'work') => void; emptyLine?: string;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // The left pane is RESIZABLE (drag the pane border) — persisted, SSR-cold initializer per the rule.
  const [labelW, setLabelW] = useState(LABEL_W_DEF);
  useLayoutEffect(() => { const w = loadLS<number>('aug-gantt-label-w'); if (w && w >= LABEL_W_MIN && w <= LABEL_W_MAX) setLabelW(w); }, []);
  const dragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX; const startW = labelW;
    const onMove = (ev: MouseEvent) => setLabelW(Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, startW + (ev.clientX - startX))));
    const onUp = (ev: MouseEvent) => {
      saveLS('aug-gantt-label-w', Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, startW + (ev.clientX - startX))));
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }, [labelW]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Guard against a stale/partial cache shape: only keep valid YYYY-MM-DD strings (a missing date
  // would propagate NaN into a `left`/`width` style and crash the render).
  const isDate = (d: unknown): d is string => typeof d === 'string' && Number.isFinite(ms(d));
  // TIMELINE HONESTY (projecthood-plan P3): only DATED events are plotted — an undated open item
  // folds into its group header as a count, never a fake arrival-date dot.
  const datedGroups = groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.marker === 'done' || i.marker === 'due'),
    undatedCount: g.items.filter((i) => i.marker !== 'done' && i.marker !== 'due').length,
  }));
  const allDates = datedGroups.flatMap((g) => g.items.flatMap((i) => [i.arrival, i.date])).filter(isDate);
  const scrollToToday = () => { const el = scrollRef.current; if (el) el.scrollTo({ left: Math.max(0, todayX - el.clientWidth * 0.15), behavior: 'smooth' }); };

  // Anchor the window on NOW: a little past context, real future due dates, but bounded so a stray
  // old done-item or a lone far-future due date can't stretch the axis into mostly-empty space.
  const earliest = allDates.length ? allDates.reduce(minS, allDates[0]) : today;
  const latest = allDates.length ? allDates.reduce(maxS, allDates[0]) : today;
  let minD = maxS(earliest, addDays(today, -21));   // cap the past at 3 weeks
  minD = minS(minD, addDays(today, -5));            // always a little past context
  let maxD = maxS(latest, addDays(today, 14));      // always a little future
  maxD = minS(maxD, addDays(today, 120));           // cap the future stretch at ~4 months
  const trackW = (days(minD, maxD) + 1) * DAY_W;
  const clampD = (d: string) => (!isDate(d) ? minD : d < minD ? minD : d > maxD ? maxD : d);
  const xOf = (d: string) => { const n = days(minD, clampD(d)) * DAY_W; return Number.isFinite(n) ? Math.max(0, n) : 0; };
  const inRange = (d: string) => isDate(d) && d >= minD && d <= maxD;

  // Week ticks (every 7 days from the range start).
  const weeks: string[] = [];
  { let c = minD; while (c <= maxD) { weeks.push(c); c = addDays(c, 7); } }
  const todayX = xOf(today);

  // Status roll-up across everything shown.
  const roll = { todo: 0, waiting: 0, done: 0, overdue: 0 };
  for (const g of datedGroups) for (const it of g.items) {
    if (it.state === 'done') roll.done++;
    else if (it.state === 'waiting' || it.state === 'in_progress') roll.waiting++;
    else roll.todo++;
    if (it.marker === 'due' && it.overdue) roll.overdue++;
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Land on "now": today sits ~15% from the left, so the past peeks and the future fills the view.
    el.scrollLeft = Math.max(0, todayX - el.clientWidth * 0.15);
  }, [todayX, trackW]);

  if (!allDates.length) {
    return <div className="mt-4 rounded-xl border border-dashed border-neutral-200 px-6 py-12 text-center text-[13px] text-neutral-400">{emptyLine || 'Work will appear here on the timeline as it’s captured.'}</div>;
  }

  return (
    <div className="mt-4 rounded-xl border border-neutral-200/70 overflow-hidden">
      {/* Status roll-up — full width, above both panes. */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-neutral-100 text-[11px] font-medium">
        <span className="inline-flex items-center gap-1.5 text-indigo-600"><span className="w-2 h-2 rounded-full bg-indigo-500" />{roll.todo} to do</span>
        <span className="inline-flex items-center gap-1.5 text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400" />{roll.waiting} waiting</span>
        <span className="inline-flex items-center gap-1.5 text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />{roll.done} done</span>
        {roll.overdue > 0 && <span className="inline-flex items-center gap-1.5 text-rose-600"><span className="w-2 h-2 rounded-full bg-rose-500" />{roll.overdue} overdue</span>}
        <button onClick={scrollToToday}
          className="ml-auto inline-flex items-center gap-1 text-neutral-400 font-normal hover:text-indigo-600 transition-colors"><span className="w-3 h-px bg-indigo-400" />today</button>
      </div>

      {/* TWO PANES: fixed task tree · draggable border · scrollable axis. */}
      <div className="flex items-stretch">

        {/* ── LEFT — the task tree (frozen: it is simply not inside the scroll pane). ── */}
        <div className="flex-shrink-0" style={{ width: labelW }}>
          <div className="flex items-center px-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-400 border-b border-neutral-200/70 bg-neutral-50/60" style={{ height: HEAD_H }}>Task</div>
          {datedGroups.map((g) => {
            const open = !collapsed.has(g.id);
            return (
              <div key={g.id}>
                <div className="flex items-center gap-1.5 px-3 border-b border-neutral-100 bg-white" style={{ height: ROW_H }}>
                  <button onClick={() => toggle(g.id)} className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 transition-colors"><ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} /></button>
                  {g.statusDot && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${g.statusDot}`} />}
                  <button onClick={() => onOpenGroup?.(g.id, 'overview')} className="min-w-0 flex-1 text-left text-[12.5px] font-semibold text-neutral-800 truncate hover:text-indigo-600 transition-colors" disabled={!onOpenGroup}>{g.name}</button>
                  <span className="flex-shrink-0 text-[10px] font-medium text-neutral-300 tabular-nums whitespace-nowrap">{g.items.length}{g.undatedCount > 0 ? ` · ${g.undatedCount} undated` : ''}</span>
                </div>
                <div className="overflow-hidden transition-[max-height] duration-300 ease-out" style={{ maxHeight: open ? g.items.length * ROW_H : 0 }}>
                  {g.items.map((it, idx) => {
                    const who = cleanWho(it.who);
                    const status = statusOf(it.state);
                    const isDone = it.state === 'done' || it.state === 'dismissed';
                    const titleTone = isDone ? 'text-neutral-400' : 'text-neutral-700';
                    const trail = it.events?.length ? ` — ${it.events.map((e) => `${e.label} ${fmtDate(e.date)}`).join(' · ')}` : '';
                    const tip = `${it.title}${who ? ` · ${who}` : ''} · ${status.label}${trail}`;
                    const inner = (
                      <>
                        <span className={`text-[12px] ${titleTone} truncate min-w-0 flex-1 group-hover/l:text-indigo-600 transition-colors`}>{it.title}</span>
                        {who && <span className="text-[10.5px] text-neutral-400 truncate flex-shrink-0 max-w-[116px]">{who}</span>}
                      </>
                    );
                    return (
                      <div key={idx} className={`flex items-center gap-2 pl-8 pr-3 border-b border-neutral-50 last:border-b-0 hover:bg-neutral-50/50 transition-colors ${isDone ? 'opacity-75' : ''}`} style={{ height: ROW_H }}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.dot}`} title={status.label} />
                        {it.href
                          ? <Link href={it.href} title={tip} className="min-w-0 flex-1 flex items-baseline gap-1.5 group/l">{inner}</Link>
                          : <button onClick={() => onOpenGroup?.(g.id, 'work')} title={tip} className="min-w-0 flex-1 flex items-baseline gap-1.5 text-left group/l" disabled={!onOpenGroup}>{inner}</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── THE BORDER — full height, draggable. ── */}
        <div onMouseDown={dragStart} title="Drag to resize"
          className="flex-shrink-0 w-[5px] cursor-col-resize bg-neutral-100 hover:bg-indigo-200 active:bg-indigo-300 transition-colors border-x border-neutral-200/60" />

        {/* ── RIGHT — the date axis (the ONLY thing that scrolls horizontally). ── */}
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto">
          <div className="relative" style={{ width: trackW }}>
            {/* header — week labels */}
            <div className="relative border-b border-neutral-200/70 bg-neutral-50/60" style={{ height: HEAD_H }}>
              {weeks.map((w) => <span key={w} className="absolute top-2 text-[10px] font-medium text-neutral-400 whitespace-nowrap" style={{ left: xOf(w) + 3 }}>{fmtDate(w)}</span>)}
            </div>
            {/* gridlines + today line — over the row area only */}
            <div className="absolute left-0 right-0 pointer-events-none" style={{ top: HEAD_H, bottom: 0 }}>
              {weeks.map((w) => <div key={w} className="absolute top-0 bottom-0 w-px bg-neutral-100" style={{ left: xOf(w) }} />)}
              <div className="absolute top-0 bottom-0 w-px bg-indigo-400/70 z-10" style={{ left: todayX }} />
            </div>
            {datedGroups.map((g) => {
              const open = !collapsed.has(g.id);
              const gStart = g.items.reduce((m, i) => minS(m, minS(i.arrival, i.date)), g.items[0] ? minS(g.items[0].arrival, g.items[0].date) : today);
              const gEnd = g.items.reduce((m, i) => maxS(m, i.date), g.items[0]?.date ?? today);
              return (
                <div key={g.id}>
                  <div className="relative border-b border-neutral-100" style={{ height: ROW_H }}>
                    {g.items.length > 0 && <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-neutral-200/80" style={{ left: xOf(gStart), width: Math.max(2, days(clampD(gStart), clampD(gEnd)) * DAY_W) }} />}
                  </div>
                  <div className="overflow-hidden transition-[max-height] duration-300 ease-out" style={{ maxHeight: open ? g.items.length * ROW_H : 0 }}>
                    {g.items.map((it, idx) => {
                      const status = statusOf(it.state);
                      const isOverdue = it.marker === 'due' && it.overdue;
                      const isDone = it.state === 'done' || it.state === 'dismissed';
                      const dotColor = isOverdue ? 'bg-rose-500' : status.dot;
                      const dateTone = isOverdue ? 'text-rose-600 font-semibold' : 'text-neutral-400';
                      const off = !inRange(it.date);         // marker outside the drawn range
                      const offLeft = off && it.date < minD;
                      const x = xOf(it.date);
                      const dateStr = fmtDateY(it.date, today);
                      const tip = `${it.title} · ${isOverdue ? 'Overdue' : status.label} · ${dateStr}`;
                      return (
                        // The AXIS row opens the same place its label does — the item's own room
                        // when it has one (href), else the project's Work tab.
                        <div key={idx}
                          onClick={() => { if (it.href) router.push(it.href); else onOpenGroup?.(g.id, 'work'); }}
                          className={`relative border-b border-neutral-50 last:border-b-0 cursor-pointer hover:bg-neutral-50/50 transition-colors ${isDone ? 'opacity-75' : ''}`} style={{ height: ROW_H }}>
                          {/* THE EVENT TRAIL — dated action ticks along the track (what happened, when,
                              by whom); hover a tick for its story. Out-of-range events are skipped. */}
                          {(it.events ?? []).filter((e) => inRange(e.date)).map((e, j) => (
                            <span key={j} title={`${e.label} · ${fmtDate(e.date)}`}
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-2.5 rounded-full bg-indigo-300/80 z-[5]"
                              style={{ left: xOf(e.date) }} />
                          ))}
                          {off ? (
                            // EDGE AFFORDANCE — an off-range marker is an explicit chevron with its real
                            // (year-aware) date, never a fake in-range dot pretending to be aligned.
                            <span className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-semibold ${isOverdue ? 'text-rose-600' : 'text-neutral-400'} ${offLeft ? 'left-1' : 'right-1 flex-row-reverse'}`} title={tip}>
                              <span>{offLeft ? '‹' : '›'}</span><span>{dateStr}</span>
                            </span>
                          ) : (
                            <>
                              <span className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white z-10`} style={{ left: x }} title={tip} />
                              <span className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-medium whitespace-nowrap ${dateTone}`}
                                style={x > trackW - 64 ? { right: trackW - x + 8 } : { left: x + 8 }}>{dateStr}</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
