'use client';

import { useEffect, useState } from 'react';
import { HEALTH_META, type ProjectHealthStatus } from '@/lib/projects/health';

// ── Portfolio Gantt — the VISUAL timeline of your INITIATIVES (projects), not individual tasks. Each
// project is a swimlane spanning its active range (first activity → furthest due/today); dated items are
// milestones on the bar; a "today" line anchors now. Meaningful at the project level because projects
// HAVE spans (point-tasks don't). Health colors the bar. Horizontal-scroll for wide ranges.

type Milestone = { date: string; title: string; kind: string; done: boolean };
type GProject = { id: string; name: string; status: ProjectHealthStatus; start: string; end: string; milestones: Milestone[] };

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const minS = (a: string, b: string) => (a < b ? a : b);
const maxS = (a: string, b: string) => (a > b ? a : b);
const nextMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`; };

const BAR: Record<ProjectHealthStatus, string> = {
  on_track: 'bg-emerald-400', needs_attention: 'bg-amber-400', stalled: 'bg-rose-300', clear: 'bg-neutral-300',
};

const DAY_W = 13;   // px per day
const LABEL_W = 168;

export default function PortfolioGantt({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [data, setData] = useState<{ today: string; projects: GProject[] } | null>(null);

  useEffect(() => {
    fetch('/api/projects/gantt').then((r) => r.json()).then(setData).catch(() => setData({ today: new Date().toISOString().slice(0, 10), projects: [] }));
  }, []);

  if (!data) {
    return <div className="mt-5 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-gradient-to-r from-neutral-100 to-neutral-50 animate-pulse" />)}</div>;
  }
  if (!data.projects.length) {
    return <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 px-6 py-14 text-center text-[13px] text-neutral-400">No initiatives yet — create a project (or accept a suggestion) to see it on the timeline.</div>;
  }

  const { today, projects } = data;
  // Overall range, padded so "today" always has context on both sides.
  let minD = projects.reduce((m, p) => minS(m, p.start), projects[0].start);
  let maxD = projects.reduce((m, p) => maxS(m, p.end), projects[0].end);
  minD = minS(minD, addDays(today, -14));
  maxD = maxS(maxD, addDays(today, 30));
  const totalDays = days(minD, maxD) + 1;
  const trackW = totalDays * DAY_W;
  const xOf = (d: string) => Math.max(0, days(minD, d) * DAY_W);

  const months: string[] = [];
  let cur = `${minD.slice(0, 7)}-01`;
  while (cur <= maxD) { months.push(cur); cur = nextMonth(cur); }

  return (
    <div className="mt-5 overflow-x-auto">
      <div style={{ minWidth: LABEL_W + trackW }}>
        {/* Month header. */}
        <div className="relative h-6 mb-1" style={{ marginLeft: LABEL_W, width: trackW }}>
          {months.map((m) => (
            <span key={m} className="absolute top-0 text-[10.5px] font-medium text-neutral-400" style={{ left: xOf(m) }}>
              {new Date(`${m}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
            </span>
          ))}
        </div>

        {/* Rows. */}
        <div className="relative border-t border-neutral-100">
          {/* month gridlines + today line, spanning all rows */}
          <div className="absolute inset-0 pointer-events-none" style={{ marginLeft: LABEL_W }}>
            {months.map((m) => <div key={m} className="absolute top-0 bottom-0 w-px bg-neutral-100" style={{ left: xOf(m) }} />)}
            <div className="absolute top-0 bottom-0 w-px bg-indigo-400/70 z-10" style={{ left: xOf(today) }} />
          </div>

          {projects.map((p) => {
            const left = xOf(p.start);
            const width = Math.max(DAY_W, (days(p.start, p.end)) * DAY_W);
            return (
              <div key={p.id} className="relative flex items-center h-11 border-b border-neutral-100 last:border-b-0">
                <button onClick={() => onOpenProject(p.id)} className="sticky left-0 z-20 bg-white h-full flex items-center gap-2 pr-3 text-left group" style={{ width: LABEL_W }}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${HEALTH_META[p.status].dot}`} />
                  <span className="text-[12.5px] font-medium text-neutral-700 truncate group-hover:text-indigo-600 transition-colors">{p.name}</span>
                </button>
                <div className="relative h-full flex-shrink-0" style={{ width: trackW }}>
                  {/* the span bar */}
                  <div className={`absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full ${BAR[p.status]} opacity-70`} style={{ left, width }} title={`${p.name} · ${HEALTH_META[p.status].label}`} />
                  {/* milestones */}
                  {p.milestones.map((mi, i) => (
                    <span
                      key={i}
                      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border ${mi.done ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-neutral-400'} z-10`}
                      style={{ left: xOf(mi.date) }}
                      title={`${mi.title} · ${new Date(`${mi.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend. */}
        <div className="flex items-center gap-4 mt-3 text-[10.5px] text-neutral-400" style={{ marginLeft: LABEL_W }}>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rotate-45 border border-neutral-400 bg-white" />due</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rotate-45 bg-emerald-500" />done</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-px bg-indigo-400" />today</span>
        </div>
      </div>
    </div>
  );
}
