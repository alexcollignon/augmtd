'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TIMELINE — ONE visual language for both tabs (the event-Gantt): "By project" = a swimlane per
// TRACKED project; "Everything" = the same chart with the LOOSE band appended (every dated work item
// not living in a tracked project — a projectless user's whole timeline). The old station-list
// fallback broke the lens's own rule (same visual = same meaning); now the date axis IS the lens.
// Smart default: land on whichever tab has content (the Projects-lens pattern). Clicking a project
// lane opens the project room; a loose item opens its own deep-dive (href). Self-contained detail.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import GanttChart, { type GanttGroup } from '@/components/entities/gantt-chart';
import EntityRoom from '@/components/entities/entity-room';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { useLiveRefresh } from '@/hooks/use-live-refresh';

type Data = { ganttGroups: GanttGroup[]; looseGroup: GanttGroup | null; todayStr: string };

export default function TimelineGantt({ onDetailChange }: { onDetailChange?: (open: boolean) => void } = {}) {
  // SSR'd-route rule: initializer COLD; cache hydrates pre-paint. Key v3: the loose band joined
  // the payload (a stale v2 blob has no looseGroup).
  const [data, setData] = useState<Data | null>(null);
  useLayoutEffect(() => {
    const c = loadLS<Data>('aug-timeline-gantt-v3');
    if (!c) return;
    setData((prev) => prev ?? c);
    // The smart default applies to the INSTANT paint too — a projectless user lands on
    // Everything from the cache, not after the refetch.
    if (!touchedRef.current && c.ganttGroups.length === 0 && c.looseGroup) setMode('all');
  }, []);
  const [mode, setMode] = useState<'gantt' | 'all'>('gantt');
  const touchedRef = useRef(false); // the user's explicit toggle outranks the smart default
  const [selected, setSelected] = useState<{ id: string; tab: 'overview' | 'work' } | null>(null);
  const [err, setErr] = useState(false);

  // Stable handle so the shared live-refresh hook can fire the latest load() closure.
  const loadRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/home/timeline').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
      if (!alive) return;
      const next: Data = { ganttGroups: (d.ganttGroups ?? []) as GanttGroup[], looseGroup: (d.looseGroup ?? null) as GanttGroup | null, todayStr: d.todayStr as string };
      setData(next); saveLS('aug-timeline-gantt-v3', next);
      // SMART DEFAULT (the Projects-lens pattern): land on the tab that HAS content — a
      // projectless user opens straight onto Everything instead of an empty By-project.
      if (!touchedRef.current && next.ganttGroups.length === 0 && next.looseGroup) setMode('all');
    }).catch(() => { if (alive && !data) setErr(true); });
    load();
    loadRef.current = load;
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The ONE live-refresh idiom — hooks/use-live-refresh.
  useLiveRefresh(() => loadRef.current?.());

  const open = (id: string, tab: 'overview' | 'work' = 'overview') => {
    if (id === 'loose') return; // the loose band is not a project room; its items link out themselves
    setSelected({ id, tab }); onDetailChange?.(true);
  };
  const close = () => { setSelected(null); onDetailChange?.(false); };
  useEffect(() => () => onDetailChange?.(false), [onDetailChange]);

  if (selected) return <EntityRoom entityId={selected.id} initialTab={selected.tab} onBack={close} />;
  if (err) return <div className="mt-10 text-[13px] text-neutral-400">Couldn&apos;t load your timeline.</div>;

  const lanes = data?.ganttGroups ?? [];
  const everything: GanttGroup[] = [...lanes, ...(data?.looseGroup ? [data.looseGroup] : [])];
  const shown = mode === 'all' ? everything : lanes;
  return (
    <div className="mt-7">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Timeline</h2>
          <p className="text-[13px] text-neutral-400 mt-0.5">
            {mode === 'gantt' ? 'Your work over time, clustered by project. Click a project to open it.' : 'Everything on one date axis — project lanes first, loose work below.'}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-neutral-200/80 bg-white/80 p-1">
          {(['gantt', 'all'] as const).map((mo) => (
            <button key={mo} onClick={() => { touchedRef.current = true; setMode(mo); }} className={`rounded-full px-3 py-1 text-[12px] font-medium transition-all duration-150 ${mode === mo ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-400 hover:text-neutral-600'}`}>
              {mo === 'gantt' ? 'By project' : 'Everything'}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        mode === 'gantt' ? (
          // ACTIONABLE empty state — advice alone is a dead end; creation is one tap away.
          <div className="py-10 text-center">
            <p className="text-[13px] text-neutral-400">No projects yet — track one to get its lane here.</p>
            <Link href="/home?view=projects" className="mt-3 inline-flex items-center rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors">
              Start a project →
            </Link>
          </div>
        ) : (
          <p className="text-[13px] text-neutral-400 py-8 text-center">Nothing with a date yet — new work lands here as it arrives.</p>
        )
      ) : (
        <GanttChart groups={shown} today={data.todayStr} onOpenGroup={(id, tab) => open(id, tab ?? 'overview')} />
      )}
    </div>
  );
}
