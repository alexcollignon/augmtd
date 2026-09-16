'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TIMELINE — ONE visual language for both tabs (the event-Gantt): "By project" = a swimlane per
// TRACKED project; "Everything" = the same chart with the LOOSE band appended (every dated work item
// not living in a tracked project — a projectless user's whole timeline). The old station-list
// fallback broke the lens's own rule (same visual = same meaning); now the date axis IS the lens.
// Smart default: land on whichever tab has content (the Projects-lens pattern). Clicking a project
// lane opens the project room; a loose item opens its own deep-dive (href). Self-contained detail.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import GanttChart, { type GanttGroup } from '@/components/entities/gantt-chart';
import { useRouter } from 'next/navigation';
import { projectHref } from '@/lib/room/project-href';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { useLiveRefresh } from '@/hooks/use-live-refresh';
import { mayReplaceInPlace, freezeRows, hasContent, type ArrivalReason } from '@/lib/room/no-mutation';

type Data = { ganttGroups: GanttGroup[]; looseGroup: GanttGroup | null; todayStr: string };

export default function TimelineGantt({ onDetailChange }: { onDetailChange?: (open: boolean) => void } = {}) {
  // SSR'd-route rule: initializer COLD; cache hydrates pre-paint. Key v3: the loose band joined
  // the payload (a stale v2 blob has no looseGroup).
  const [data, setData] = useState<Data | null>(null);
  // THE NO-MUTATION LAW needs the SERVED chart synchronously — `apply` is the ONE write site.
  const paintedRef = useRef<Data | null>(null);
  const apply = useCallback((next: Data | ((prev: Data | null) => Data | null)) => {
    setData((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      paintedRef.current = v;
      return v;
    });
  }, []);
  useLayoutEffect(() => {
    const c = loadLS<Data>('aug-timeline-gantt-v3');
    if (!c) return;
    apply((prev) => prev ?? c);
    // The smart default applies to the INSTANT paint too — a projectless user lands on
    // Everything from the cache, not after the refetch.
    if (!touchedRef.current && c.ganttGroups.length === 0 && c.looseGroup) setMode('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mode, setMode] = useState<'gantt' | 'all'>('gantt');
  const touchedRef = useRef(false); // the user's explicit toggle outranks the smart default
  const router = useRouter();
  const [err, setErr] = useState(false);

  const aliveRef = useRef(true);
  // THE NO-MUTATION LAW (lib/room/no-mutation.ts): a lane's bars are dated CLAIMS — a poll that
  // re-lays them (a bar moving, a lane re-ordering, a marker changing colour) is exactly the
  // mutation the law forbids. A `background` arrival APPENDS lanes the reader has never seen and
  // leaves every painted lane as it opened; an `open` landing on a painted chart (the cache) becomes
  // the NEXT open's first paint. A painted lane is frozen WHOLE rather than merged item-by-item:
  // GanttItem carries no stable id, so appending inside a lane could redraw a moved bar twice — and
  // a duplicate is a mutation too.
  const load = useCallback((reason: ArrivalReason) => {
    fetch('/api/home/timeline').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
      if (!aliveRef.current) return;
      const next: Data = { ganttGroups: (d.ganttGroups ?? []) as GanttGroup[], looseGroup: (d.looseGroup ?? null) as GanttGroup | null, todayStr: d.todayStr as string };
      // A held payload is never a lost one: the cache IS the next open's first paint.
      saveLS('aug-timeline-gantt-v3', next);
      // THE EMPTY-PAINT RULE: a laneless painted Gantt is a skeleton, never a hold.
      const painted = paintedRef.current && hasContent(paintedRef.current.ganttGroups.length + (paintedRef.current.looseGroup ? 1 : 0))
        ? paintedRef.current : null;
      const paint = mayReplaceInPlace(reason, !!painted) || !painted;
      if (paint) apply(next);
      else if (reason === 'background') {
        apply({
          ganttGroups: freezeRows(painted!.ganttGroups, next.ganttGroups, (g) => g.id),
          looseGroup: painted!.looseGroup ?? next.looseGroup,
          todayStr: next.todayStr, // the clock is ambient, never a claim about a bar
        });
      }
      // SMART DEFAULT (the Projects-lens pattern): land on the tab that HAS content — a
      // projectless user opens straight onto Everything instead of an empty By-project. It is a
      // choice about an EMPTY view, so it moves nothing painted; a held arrival never re-decides it.
      if (paint && !touchedRef.current && next.ganttGroups.length === 0 && next.looseGroup) setMode('all');
    }).catch(() => { if (aliveRef.current && !paintedRef.current) setErr(true); });
  }, [apply]);
  useEffect(() => {
    aliveRef.current = true;
    load('open');
    return () => { aliveRef.current = false; };
  }, [load]);
  // The ONE live-refresh idiom — hooks/use-live-refresh.
  useLiveRefresh(() => load('background'));

  // THE ADDRESS LAW (Sep 7 — the last in-place room mount, missed by the first inventory): a lane
  // click NAVIGATES to the room's own address; the tab nuance rides `?tab=`. The old `selected`
  // state painted a full EntityRoom while the URL still said /home.
  const open = (id: string, tab: 'overview' | 'work' = 'overview') => {
    if (id === 'loose') return; // the loose band is not a project room; its items link out themselves
    router.push(`${projectHref(id)}${tab === 'work' ? '?tab=work' : ''}`);
  };
  // The lens never hosts a room any more — announced once so the Home greeting can't stay stuck.
  useEffect(() => { onDetailChange?.(false); }, [onDetailChange]);
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
