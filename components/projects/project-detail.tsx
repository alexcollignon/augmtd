'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronLeftIcon, PencilSquareIcon, FlagIcon, ShieldCheckIcon, SparklesIcon, UsersIcon, XMarkIcon, ArrowRightIcon, CheckCircleIcon, ArchiveBoxIcon, ArrowUturnLeftIcon, TrashIcon, BoltIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { WorkItem, WorkItemState } from '@/lib/work-items/model';
import ProjectGantt from '@/components/projects/project-gantt';
import { Button, Card } from '@/components/ui';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import HealthChip from '@/components/projects/health-chip';
import type { ProjectHealth } from '@/lib/projects/health';
import { computeProjectStatus, STATUS_TONE } from '@/lib/projects/status';

type Project = {
  id: string; name: string; description: string | null; status: 'active' | 'done' | 'archived';
  goals: string[]; rules: string[]; color: string | null; auto: boolean; itemCount?: number; health?: ProjectHealth;
};

const STATE_COL: Array<{ key: WorkItemState; label: string; dot: string }> = [
  { key: 'todo', label: 'To do', dot: 'bg-indigo-500' },
  { key: 'waiting', label: 'Waiting on', dot: 'bg-amber-500' },
  { key: 'done', label: 'Done', dot: 'bg-emerald-500' },
];

// A stat tile (icon · count · label) — the at-a-glance pulse, mirroring a modern project dashboard.
// Clickable tiles jump to the Work board filtered by that state.
const TILE_TONE = {
  indigo:  { bg: 'bg-indigo-50',  fg: 'text-indigo-500' },
  amber:   { bg: 'bg-amber-50',   fg: 'text-amber-500' },
  emerald: { bg: 'bg-emerald-50', fg: 'text-emerald-500' },
  rose:    { bg: 'bg-rose-50',    fg: 'text-rose-500' },
} as const;
function StatTile({ icon: Icon, count, label, tone, onClick }: { icon: React.ElementType; count: number; label: string; tone: keyof typeof TILE_TONE; onClick?: () => void }) {
  const t = TILE_TONE[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={`text-left rounded-xl border border-neutral-200/70 bg-white/70 px-3 py-3 ${onClick ? 'aug-interactive hover:border-indigo-200 cursor-pointer' : ''}`}>
      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${t.bg} ${t.fg}`}><Icon className="w-4 h-4" /></span>
      <div className="text-[22px] font-semibold text-neutral-900 tabular-nums leading-none mt-2.5">{count}</div>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-neutral-400 mt-1">{label}</div>
    </Comp>
  );
}

// Goals / Rules — INLINE editable with instant auto-save. Each line is an editable input (Enter or blur
// commits; clearing it removes the line); the last row is an "Add…" input. Every commit PATCHes the
// project's goals/rules array straight away (optimistic) — no modal, no Save button.
function EditableIntentCard({ icon: Icon, title, hint, field, initial, projectId }: {
  icon: React.ElementType; title: string; hint: string; field: 'goals' | 'rules'; initial: string[]; projectId: string;
}) {
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const persist = (next: string[]) => {
    setItems(next);
    fetch(`/api/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: next }) }).catch(() => {});
  };
  const commitAt = (i: number, value: string) => {
    const v = value.trim();
    if (v === items[i]) return;                                  // no change
    persist(v ? items.map((x, j) => (j === i ? v : x)) : items.filter((_, j) => j !== i));
  };
  const addDraft = () => { const t = draft.trim(); if (!t) return; persist([...items, t]); setDraft(''); };
  const noun = field === 'goals' ? 'goal' : 'rule';
  return (
    <div className="rounded-xl border border-neutral-200/70 bg-white p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-indigo-500" />
        <h3 className="text-[12.5px] font-semibold text-neutral-700">{title}</h3>
      </div>
      {items.length === 0 && <p className="text-[12px] text-neutral-400 mb-2">{hint}</p>}
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          // Key by value+index so an uncontrolled input refreshes its defaultValue after add/edit/remove
          // (a plain index key would leave a removed row showing the previous line's text).
          <li key={`${i}-${it}`} className="group/row flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 flex-shrink-0" />
            <input
              defaultValue={it}
              onBlur={(e) => commitAt(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              className="flex-1 min-w-0 bg-transparent text-[12.5px] text-neutral-700 focus:outline-none rounded px-1 py-1 -mx-1 focus:bg-indigo-50/40"
            />
            <button onClick={() => persist(items.filter((_, j) => j !== i))} title={`Remove ${noun}`} className="flex-shrink-0 opacity-0 group-hover/row:opacity-100 text-neutral-300 hover:text-rose-500 transition-all">
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full border border-neutral-200 flex-shrink-0" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }}
            onBlur={addDraft}
            placeholder={`Add a ${noun}…`}
            className="flex-1 min-w-0 bg-transparent text-[12.5px] text-neutral-600 placeholder:text-neutral-300 focus:outline-none rounded px-1 py-1 -mx-1 focus:bg-indigo-50/40"
          />
        </li>
      </ul>
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

export default function ProjectDetail({ project, onBack, onEdit, onStatus, onUngroup }: { project: Project; onBack: () => void; onEdit: () => void; onStatus: (s: 'active' | 'done' | 'archived') => void; onUngroup: () => void }) {
  // Instant-load: hydrate this project's items from localStorage (no skeleton flash on re-open), then
  // refresh in the background — same pattern as the Home / Timeline / item deep-dive.
  const [items, setItems] = useState<WorkItem[] | null>(() => loadLS<WorkItem[]>(`aug-project-items-${project.id}`));
  const [tab, setTab] = useState<'overview' | 'timeline' | 'work'>('overview');
  const [ungroupConfirm, setUngroupConfirm] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${project.id}/items`).then((r) => r.json()).then((d) => { if (alive) { setItems(d.items ?? []); saveLS(`aug-project-items-${project.id}`, d.items ?? []); } }).catch(() => { if (alive && !items) setItems([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const list = items ?? [];
  const count = (s: WorkItemState) => list.filter((w) => w.state === s).length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const status = computeProjectStatus(project.health, list, todayStr);
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
            {project.status === 'done' && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 bg-emerald-50 rounded-full px-1.5 py-0.5">Done</span>}
            {project.status === 'archived' && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 bg-neutral-100 rounded-full px-1.5 py-0.5">Archived</span>}
            {project.status === 'active' && project.health && <HealthChip status={project.health.status} />}
            {project.auto && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-indigo-500 bg-indigo-50 rounded-full px-1.5 py-0.5"><SparklesIcon className="w-2.5 h-2.5" />Auto</span>}
          </div>
          {project.description && <p className="text-[13px] text-neutral-400 mt-0.5 max-w-[640px]">{project.description}</p>}
        </div>
        {/* Lifecycle actions — Mark done / Archive on an active project; Reopen on a terminal one. Un-group
            (return items to loose, never destroys work) + Edit always available. */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {project.status === 'active' ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => onStatus('done')}><CheckCircleIcon className="w-4 h-4" />Done</Button>
              <Button variant="ghost" size="sm" onClick={() => onStatus('archived')} title="Archive"><ArchiveBoxIcon className="w-4 h-4" /></Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onStatus('active')}><ArrowUturnLeftIcon className="w-4 h-4" />Reopen</Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit} title="Edit"><PencilSquareIcon className="w-4 h-4" /></Button>
          {ungroupConfirm ? (
            <button onClick={onUngroup} onMouseLeave={() => setUngroupConfirm(false)} className="text-[12px] font-semibold text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5 hover:bg-rose-100 transition-colors" title="Removes the project; items return to loose initiatives (nothing is deleted)">Un-group</button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setUngroupConfirm(true)} title="Un-group (return items to loose)"><TrashIcon className="w-4 h-4" /></Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mt-5 border-b border-neutral-100">
        {(['overview', 'timeline', 'work'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-[13px] font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}>
            {t}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="mt-6 grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-[68px] rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}</div>
      ) : tab === 'overview' ? (
        // Card DASHBOARD: main column (state + pulse tiles, then the needs-you / team lanes) beside a
        // right rail of intent (Goals / Rules). A calm command center, not a flat list.
        (() => {
          const t = STATUS_TONE[status.tone];
          const todos = list.filter((w) => w.state === 'todo');
          const teamItems = list.filter((w) => w.actor === 'team');
          return (
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              {/* MAIN column */}
              <div className="lg:col-span-2 space-y-4">
                {/* State + pulse tiles */}
                <Card className="p-4">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${t.dot} flex-shrink-0`} />
                    <span className={`text-[13px] font-semibold ${t.text}`}>{status.label}</span>
                    <span className="text-[12.5px] text-neutral-500 truncate">· {status.detail}</span>
                  </div>
                  {status.nextAction && (
                    <Link href={status.nextAction.href} className="group mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-neutral-700 hover:text-indigo-600 transition-colors">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Next</span>
                      <span className="font-medium truncate max-w-[420px]">{status.nextAction.title}</span>
                      <ArrowRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-500" />
                    </Link>
                  )}
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatTile icon={BoltIcon} count={count('todo')} label="Need you" tone="indigo" onClick={() => setTab('work')} />
                    <StatTile icon={ClockIcon} count={count('waiting')} label="Waiting" tone="amber" onClick={() => setTab('work')} />
                    <StatTile icon={CheckCircleIcon} count={count('done')} label="Done" tone="emerald" onClick={() => setTab('work')} />
                    <StatTile icon={ExclamationTriangleIcon} count={project.health?.overdue ?? 0} label="Overdue" tone="rose" />
                  </div>
                </Card>

                {/* Needs you */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[13px] font-semibold text-neutral-800">Needs you <span className="text-neutral-300 font-normal">{todos.length}</span></h3>
                    {todos.length > 5 && <button onClick={() => setTab('work')} className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors">View all</button>}
                  </div>
                  {todos.length === 0 ? (
                    <p className="text-[12.5px] text-neutral-400 py-2">Nothing needs you here right now.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {todos.slice(0, 5).map((w) => <WorkCard key={w.id} w={w} onRemove={() => removeItem(w)} />)}
                    </div>
                  )}
                </Card>

                {/* From your team (only when there's team work) */}
                {teamItems.length > 0 && (
                  <Card className="p-4">
                    <h3 className="text-[13px] font-semibold text-neutral-800 mb-3">From your team <span className="text-neutral-300 font-normal">{teamItems.length}</span></h3>
                    <div className="space-y-1.5">
                      {teamItems.slice(0, 5).map((w) => <WorkCard key={w.id} w={w} onRemove={() => removeItem(w)} />)}
                      {teamItems.length > 5 && <p className="text-[11px] text-neutral-400 pl-1">+{teamItems.length - 5} more</p>}
                    </div>
                  </Card>
                )}

                {/* People */}
                {people.length > 0 && (
                  <Card className="p-4">
                    <h3 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-400 mb-2.5"><UsersIcon className="w-3.5 h-3.5" />People</h3>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {people.map((p, i) => (
                        <span key={i} className="text-[12px] font-medium text-neutral-600 bg-neutral-50 border border-neutral-200/70 rounded-full px-2.5 py-1">{p}</span>
                      ))}
                    </div>
                  </Card>
                )}
              </div>

              {/* RIGHT rail — intent (inline editable, instant auto-save) */}
              <div className="space-y-4">
                <EditableIntentCard key={`goals-${project.id}`} icon={FlagIcon} title="Goals" hint="What this project is trying to achieve." field="goals" initial={project.goals} projectId={project.id} />
                <EditableIntentCard key={`rules-${project.id}`} icon={ShieldCheckIcon} title="Rules" hint="How your coworkers should work on it — and what to avoid." field="rules" initial={project.rules} projectId={project.id} />
              </div>
            </div>
          );
        })()
      ) : tab === 'timeline' ? (
        <div className="mt-5">
          <div className="mb-1">
            <h3 className="text-[16px] font-semibold tracking-tight text-neutral-900">Project timeline</h3>
            <p className="text-[12.5px] text-neutral-400 mt-0.5">What happened, what&apos;s outstanding, and what&apos;s coming — by when, and by whom.</p>
          </div>
          <ProjectGantt items={list} todayStr={todayStr} name={project.name} />
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
