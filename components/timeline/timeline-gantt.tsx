'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TIMELINE — as a PROJECT-CLUSTERED GANTT (the Projects-page event chart, on the Home Timeline).
// Each swimlane is a body of work; its member items are dated events. Clicking a project name → opens
// the project (Overview); clicking an item → opens the project on its Work tab. Self-contained: holds
// the open-detail state and renders the entity ROOM (P7c), so no cross-lens plumbing. Falls back to the flat
// station TimelineView for anything not clustered under a project (the "everything else" toggle).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import GanttChart, { type GanttGroup } from '@/components/entities/gantt-chart';
import EntityRoom from '@/components/entities/entity-room';
import TimelineView from '@/components/timeline/timeline-view';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { useLiveRefresh } from '@/hooks/use-live-refresh';

type Data = { ganttGroups: GanttGroup[]; todayStr: string };

export default function TimelineGantt({ onDetailChange }: { onDetailChange?: (open: boolean) => void } = {}) {
  // SSR'd-route rule: initializer COLD; cache hydrates pre-paint. Key v2: lanes became
  // TRACKED-only server-side — a stale v1 blob would keep showing untracked project lanes.
  const [data, setData] = useState<Data | null>(null);
  useLayoutEffect(() => { const c = loadLS<Data>('aug-timeline-gantt-v2'); if (c) setData((prev) => prev ?? c); }, []);
  const [mode, setMode] = useState<'gantt' | 'list'>('gantt');
  const [selected, setSelected] = useState<{ id: string; tab: 'overview' | 'work' } | null>(null);
  const [err, setErr] = useState(false);

  // Stable handle so the shared live-refresh hook can fire the latest load() closure.
  const loadRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/home/timeline').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
      if (!alive) return;
      const next = { ganttGroups: (d.ganttGroups ?? []) as GanttGroup[], todayStr: d.todayStr as string };
      setData(next); saveLS('aug-timeline-gantt-v2', next);
    }).catch(() => { if (alive && !data) setErr(true); });
    load();
    // LIVE (Living-Home): refetch on focus/visibility + a gentle interval — actions taken anywhere
    // (done/dismiss/prepared work) show up here without a manual reload.
    loadRef.current = load;
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The ONE live-refresh idiom — hooks/use-live-refresh.
  useLiveRefresh(() => loadRef.current?.());

  const open = (id: string, tab: 'overview' | 'work' = 'overview') => { setSelected({ id, tab }); onDetailChange?.(true); };
  const close = () => { setSelected(null); onDetailChange?.(false); };
  useEffect(() => () => onDetailChange?.(false), [onDetailChange]);

  if (selected) return <EntityRoom entityId={selected.id} initialTab={selected.tab} onBack={close} />;
  if (err) return <div className="mt-10 text-[13px] text-neutral-400">Couldn&apos;t load your timeline.</div>;

  const groups = data?.ganttGroups ?? [];
  return (
    <div className="mt-7">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Timeline</h2>
          <p className="text-[13px] text-neutral-400 mt-0.5">Your work over time, clustered by project. Click a project to open it.</p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-neutral-200/80 bg-white/80 p-1">
          {(['gantt', 'list'] as const).map((mo) => (
            <button key={mo} onClick={() => setMode(mo)} className={`rounded-full px-3 py-1 text-[12px] font-medium transition-all duration-150 ${mode === mo ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-400 hover:text-neutral-600'}`}>
              {mo === 'gantt' ? 'By project' : 'Everything'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'list' ? (
        <TimelineView />
      ) : !data ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}</div>
      ) : groups.length === 0 ? (
        <p className="text-[13px] text-neutral-400 py-8 text-center">Nothing clustered under a project yet — try &ldquo;Everything&rdquo;.</p>
      ) : (
        <GanttChart groups={groups} today={data.todayStr} onOpenGroup={(id, tab) => open(id, tab ?? 'overview')} />
      )}
    </div>
  );
}
