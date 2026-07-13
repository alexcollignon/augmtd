'use client';

import { useEffect, useState } from 'react';
import { HEALTH_META, type ProjectHealthStatus } from '@/lib/projects/health';
import { loadLS } from '@/lib/utils/local-cache';
import GanttChart, { type GanttItem } from '@/components/projects/gantt-chart';

// ── Portfolio Gantt — the bar-based timeline of EVERY project, rendered by the shared <GanttChart/>. Each
// project is a collapsible group; its tasks are colored duration bars (arrival → due/resolved/today). The
// data (/api/projects/gantt) already carries per-item spans, so this file is a thin fetch + map wrapper.

type GProject = { id: string; name: string; status: ProjectHealthStatus; start: string; end: string; items: GanttItem[] };
type GData = { today: string; projects: GProject[] };

export default function PortfolioGantt({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  // Instant-load: hydrate from localStorage (no skeleton on re-open), then refresh in the background.
  const [data, setData] = useState<GData | null>(() => loadLS<GData>('aug-portfolio-gantt-v3'));

  useEffect(() => {
    let alive = true;
    fetch('/api/projects/gantt').then((r) => r.json()).then((d: GData) => {
      if (!alive) return;
      setData(d);
      try { localStorage.setItem('aug-portfolio-gantt-v3', JSON.stringify(d)); } catch { /* non-fatal */ }
    }).catch(() => { if (alive && !data) setData({ today: new Date().toISOString().slice(0, 10), projects: [] }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) {
    return <div className="mt-5 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 rounded-lg bg-gradient-to-r from-neutral-100 to-neutral-50 animate-pulse" />)}</div>;
  }
  if (!data.projects.length) {
    return <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 px-6 py-14 text-center text-[13px] text-neutral-400">No initiatives yet — create a project (or accept a suggestion) to see it on the timeline.</div>;
  }

  const groups = data.projects.map((p) => ({ id: p.id, name: p.name, statusDot: HEALTH_META[p.status].dot, items: p.items }));
  return <GanttChart groups={groups} today={data.today} onOpenGroup={onOpenProject} />;
}
