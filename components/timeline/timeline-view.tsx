'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUturnLeftIcon, BoltIcon, ClockIcon, CalendarDaysIcon, FlagIcon, SparklesIcon,
  CheckCircleIcon, FolderIcon,
} from '@heroicons/react/24/outline';
import type { WorkItem, WorkItemKind } from '@/lib/work-items/model';
import { BUCKET_ORDER, BUCKET_LABELS, type TimeBucket } from '@/lib/work-items/timeframe';

// ── The Home TIMELINE — a simple, intuitive "what's on your plate, by when". NOT a duration-Gantt:
// AUGMTD items are point obligations, most with no date, so we lay time out left→right as STATIONS
// (Recently done · Overdue · Today · This week · Soon · Later · Someday) and hang cards under each.
// It reads at a glance and works even when nothing has a date — the whole point. Coworker deliverables
// get the indigo/team accent so your team's work is visible on the same spine as yours.

const KIND_META: Record<WorkItemKind, { icon: React.ElementType; tint: string; label: string }> = {
  reply:       { icon: ArrowUturnLeftIcon, tint: 'text-rose-500',    label: 'Reply' },
  action:      { icon: BoltIcon,           tint: 'text-indigo-500',  label: 'Action' },
  commitment:  { icon: FlagIcon,           tint: 'text-indigo-500',  label: 'Commitment' },
  followup:    { icon: ClockIcon,          tint: 'text-amber-500',   label: 'Follow up' },
  meeting:     { icon: CalendarDaysIcon,   tint: 'text-violet-500',  label: 'Meeting' },
  deliverable: { icon: SparklesIcon,       tint: 'text-indigo-500',  label: 'From your team' },
};

// Station accents — the leftmost past is muted, "today" is the indigo focal point, urgency reads warm.
const STATION_DOT: Record<TimeBucket | 'history', string> = {
  history:   'bg-neutral-300',
  overdue:   'bg-rose-500',
  today:     'bg-indigo-600',
  this_week: 'bg-indigo-400',
  soon:      'bg-neutral-400',
  later:     'bg-neutral-300',
  someday:   'bg-neutral-300',
};

type ProjectMap = Record<string, { name: string; color: string | null }>;

function TimelineCard({ w, index, projectMap }: { w: WorkItem; index: number; projectMap?: ProjectMap }) {
  const proj = w.projectId && projectMap ? projectMap[w.projectId] : undefined;
  const meta = KIND_META[w.kind];
  const Icon = meta.icon;
  const team = w.actor === 'team';
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), 40 + index * 25); return () => clearTimeout(t); }, [index]);
  return (
    <Link
      href={w.href}
      className={`group block rounded-xl border bg-white px-3 py-2.5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_4px_16px_-8px_rgba(0,0,0,0.12)] ${
        team ? 'border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white hover:border-indigo-200' : 'border-neutral-200/80 hover:border-neutral-300'
      } ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5'}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${meta.tint}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-neutral-800 leading-snug line-clamp-2">{w.title}</p>
          <div className="flex items-center gap-1.5 mt-1">
            {team && <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Team</span>}
            {w.who && <span className="text-[11px] text-neutral-400 truncate">{team ? w.who : w.who}</span>}
            {w.when.explicit && (
              <span className="text-[10.5px] font-medium text-indigo-500 flex-shrink-0">
                {new Date(w.when.explicit).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          {proj && (
            <span className="mt-1.5 inline-flex items-center gap-1 max-w-full text-[10px] font-medium text-neutral-500 bg-neutral-100 rounded-full px-1.5 py-0.5">
              <FolderIcon className="w-2.5 h-2.5 flex-shrink-0" /><span className="truncate">{proj.name}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function Station({ bucket, label, items, muted, index, projectMap }: { bucket: TimeBucket | 'history'; label: string; items: WorkItem[]; muted?: boolean; index: number; projectMap?: ProjectMap }) {
  return (
    <div className="relative flex-shrink-0 w-[248px]" style={{ transitionDelay: `${index * 40}ms` }}>
      {/* Station header — a dot on the axis + the time label + count. */}
      <div className="flex items-center gap-2 mb-3 h-[26px]">
        <span className={`w-2.5 h-2.5 rounded-full ring-4 ring-neutral-50 flex-shrink-0 ${STATION_DOT[bucket]}`} />
        <h3 className={`text-[11px] font-semibold uppercase tracking-[0.07em] ${muted ? 'text-neutral-400' : bucket === 'today' ? 'text-indigo-600' : bucket === 'overdue' ? 'text-rose-600' : 'text-neutral-500'}`}>{label}</h3>
        <span className="text-[11px] font-medium text-neutral-300">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-[11.5px] text-neutral-300 px-1 py-2">Nothing here.</p>
        ) : (
          items.map((w, i) => <TimelineCard key={w.id} w={w} index={i} projectMap={projectMap} />)
        )}
      </div>
    </div>
  );
}

export default function TimelineView() {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [projectMap, setProjectMap] = useState<ProjectMap>({});
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/home/timeline')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) { setItems(d.items ?? []); setProjectMap(d.projectsById ?? {}); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  if (err) return <div className="mt-10 text-[13px] text-neutral-400">Couldn&apos;t load your timeline.</div>;
  if (!items) {
    return (
      <div className="mt-8 flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-shrink-0 w-[248px] space-y-2">
            <div className="h-4 w-24 rounded bg-neutral-100 animate-pulse mb-3" />
            {[0, 1, 2].map((j) => <div key={j} className="h-[58px] rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-7">
      <div className="mb-5">
        <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Timeline</h2>
        <p className="text-[13px] text-neutral-400 mt-0.5">Everything on your plate, laid out by when — even what has no fixed date.</p>
      </div>
      <TimelineStations items={items} projectMap={projectMap} />
    </div>
  );
}

// The station-lane renderer — REUSED by the full Home timeline and the per-project scoped timeline.
// Groups items into time stations (history + buckets) and lays them left→right on a thin axis.
export function TimelineStations({ items, emptyLine, projectMap }: { items: WorkItem[]; emptyLine?: string; projectMap?: ProjectMap }) {
  const upcoming = items.filter((w) => w.state !== 'done' && w.state !== 'dismissed');
  const history = items.filter((w) => w.state === 'done' || w.state === 'dismissed').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const byBucket = (b: TimeBucket) => upcoming.filter((w) => w.when.bucket === b).sort((a, b2) => (a.when.explicit || '9999').localeCompare(b2.when.explicit || '9999') || b2.at.localeCompare(a.at));

  const stations: Array<{ bucket: TimeBucket | 'history'; label: string; items: WorkItem[]; muted?: boolean }> = [];
  if (history.length) stations.push({ bucket: 'history', label: 'Recently done', items: history, muted: true });
  for (const b of BUCKET_ORDER) {
    const inB = byBucket(b);
    if (inB.length) stations.push({ bucket: b, label: BUCKET_LABELS[b], items: inB });
  }

  if (!stations.length) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 px-6 py-14 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <CheckCircleIcon className="w-6 h-6 text-emerald-500" />
        </div>
        <p className="text-[14px] font-medium text-neutral-700">Nothing on the timeline</p>
        <p className="text-[13px] text-neutral-400 mt-1">{emptyLine ?? "Commitments, replies, and your team's work will line up here by when they're due."}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-[13px] left-1 right-1 h-px bg-gradient-to-r from-neutral-200 via-neutral-200 to-transparent" aria-hidden="true" />
      <div className="flex gap-5 overflow-x-auto pb-4 -mx-1 px-1">
        {stations.map((s, i) => (
          <Station key={s.bucket} bucket={s.bucket} label={s.label} items={s.items} muted={s.muted} index={i} projectMap={projectMap} />
        ))}
      </div>
    </div>
  );
}
