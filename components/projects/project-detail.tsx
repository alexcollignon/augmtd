'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronLeftIcon, PencilSquareIcon, FlagIcon, ShieldCheckIcon, SparklesIcon, UsersIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { WorkItem, WorkItemState } from '@/lib/work-items/model';
import { TimelineStations } from '@/components/timeline/timeline-view';
import { Button } from '@/components/ui';
import HealthChip from '@/components/projects/health-chip';
import type { ProjectHealth } from '@/lib/projects/health';

type Project = {
  id: string; name: string; description: string | null; status: 'active' | 'archived';
  goals: string[]; rules: string[]; color: string | null; auto: boolean; itemCount?: number; health?: ProjectHealth;
};

// A compact "what's here" list — the brief's Needs-you / Team lanes (not a board).
function MiniList({ title, tint, items, onRemove }: { title: string; tint: string; items: WorkItem[]; onRemove?: (w: WorkItem) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className={`text-[11px] font-semibold uppercase tracking-[0.07em] mb-2 ${tint}`}>{title} <span className="text-neutral-300">{items.length}</span></h3>
      <div className="space-y-1.5">
        {items.slice(0, 5).map((w) => <WorkCard key={w.id} w={w} onRemove={onRemove ? () => onRemove(w) : undefined} />)}
        {items.length > 5 && <p className="text-[11px] text-neutral-400 pl-1">+{items.length - 5} more</p>}
      </div>
    </div>
  );
}

const STATE_COL: Array<{ key: WorkItemState; label: string; dot: string }> = [
  { key: 'todo', label: 'To do', dot: 'bg-indigo-500' },
  { key: 'waiting', label: 'Waiting on', dot: 'bg-amber-500' },
  { key: 'done', label: 'Done', dot: 'bg-emerald-500' },
];

function IntentCard({ icon: Icon, title, hint, items }: { icon: React.ElementType; title: string; hint: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-neutral-200/70 bg-white p-4">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-indigo-500" />
        <h3 className="text-[12.5px] font-semibold text-neutral-700">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-neutral-400 mt-1">{hint}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-[12.5px] text-neutral-600 flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 mt-1.5 flex-shrink-0" />{it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkCard({ w, onRemove }: { w: WorkItem; onRemove?: () => void }) {
  const inner = (
    <>
      <p className="text-[12.5px] font-medium text-neutral-800 leading-snug line-clamp-2 pr-4">{w.title}</p>
      {w.who && <p className="text-[11px] text-neutral-400 mt-1 truncate">{w.who}</p>}
      {onRemove && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          title="Remove from project"
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-rose-500 transition-all"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </>
  );
  const cls = 'group relative block rounded-lg border border-neutral-200/70 bg-white px-3 py-2.5 transition-all';
  return w.href && w.href !== '/'
    ? <Link href={w.href} className={`${cls} hover:border-neutral-300 hover:shadow-sm`}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}

export default function ProjectDetail({ project, onBack, onEdit }: { project: Project; onBack: () => void; onEdit: () => void }) {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [tab, setTab] = useState<'overview' | 'work'>('overview');

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${project.id}/items`).then((r) => r.json()).then((d) => { if (alive) setItems(d.items ?? []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [project.id]);

  const list = items ?? [];
  const count = (s: WorkItemState) => list.filter((w) => w.state === s).length;
  // Un-assign an item from the project (the undo for the auto-attach magnet). Optimistic + non-fatal.
  const removeItem = async (w: WorkItem) => {
    setItems((prev) => (prev ?? []).filter((x) => x.id !== w.id));
    const kind = w.source === 'commitment' ? 'commitment' : 'inbox';
    try {
      await fetch('/api/items/project', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: w.entityId, projectId: null }) });
      toast.success('Removed from project');
    } catch { toast.error('Could not remove'); }
  };
  // People involved — unique counterparties/senders across the project's work (clean name, no email).
  const people = [...new Set(list.map((w) => w.who).filter(Boolean).map((w) => String(w).replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').trim()))].slice(0, 8);

  return (
    <div className="mt-7">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-400 hover:text-indigo-600 transition-colors mb-3">
        <ChevronLeftIcon className="w-4 h-4" />Projects
      </button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[20px] font-semibold tracking-tight text-neutral-900 truncate">{project.name}</h2>
            {project.health && <HealthChip status={project.health.status} />}
            {project.auto && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-indigo-500 bg-indigo-50 rounded-full px-1.5 py-0.5"><SparklesIcon className="w-2.5 h-2.5" />Auto</span>}
          </div>
          {project.description && <p className="text-[13px] text-neutral-400 mt-0.5 max-w-[640px]">{project.description}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}><PencilSquareIcon className="w-4 h-4" />Edit</Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mt-5 border-b border-neutral-100">
        {(['overview', 'work'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-[13px] font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}>
            {t}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="mt-6 grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-[68px] rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}</div>
      ) : tab === 'overview' ? (
        <div className="mt-5 space-y-6">
          {/* Pulse — the health rollup + a one-line summary + people. A brief, not a board. */}
          <div className="flex items-center gap-3 flex-wrap text-[12.5px] text-neutral-500">
            <span>{count('todo')} need you</span>
            <span className="text-neutral-300">·</span>
            <span>{count('waiting')} waiting</span>
            <span className="text-neutral-300">·</span>
            <span>{count('done')} done</span>
            {project.health && project.health.overdue > 0 && <><span className="text-neutral-300">·</span><span className="font-medium text-rose-500">{project.health.overdue} overdue</span></>}
          </div>
          {people.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400"><UsersIcon className="w-3.5 h-3.5" />People</span>
              {people.map((p, i) => (
                <span key={i} className="text-[12px] font-medium text-neutral-600 bg-white border border-neutral-200/70 rounded-full px-2.5 py-0.5">{p}</span>
              ))}
            </div>
          )}
          {/* The brief: what needs you + what your team's on — the actionable heart, not a Kanban. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <MiniList title="Needs you" tint="text-neutral-500" items={list.filter((w) => w.state === 'todo')} onRemove={removeItem} />
            <MiniList title="From your team" tint="text-indigo-600/80" items={list.filter((w) => w.actor === 'team')} onRemove={removeItem} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <IntentCard icon={FlagIcon} title="Goals" hint="What this project is trying to achieve. Add goals via Edit." items={project.goals} />
            <IntentCard icon={ShieldCheckIcon} title="Rules" hint="How your coworkers should work on it — and what to avoid. Add rules via Edit." items={project.rules} />
          </div>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400 mb-3">Timeline</h3>
            <TimelineStations items={list} emptyLine="This project's work will line up here by when it's due." />
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATE_COL.map((col) => {
            const inCol = list.filter((w) => w.state === col.key);
            return (
              <div key={col.key}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500">{col.label}</h3>
                  <span className="text-[11px] text-neutral-300">{inCol.length}</span>
                </div>
                <div className="space-y-2">
                  {inCol.length === 0 ? <p className="text-[11.5px] text-neutral-300 px-1">Nothing here.</p> : inCol.map((w) => <WorkCard key={w.id} w={w} onRemove={() => removeItem(w)} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
