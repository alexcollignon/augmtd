'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FolderIcon, PlusIcon, PencilSquareIcon, TrashIcon, XMarkIcon, SparklesIcon, FlagIcon, ShieldCheckIcon, UsersIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Button, IconButton, Input, Textarea, Card, EmptyState, SegmentedControl } from '@/components/ui';
import ProjectDetail from '@/components/projects/project-detail';
import HealthChip from '@/components/projects/health-chip';
import PortfolioGantt from '@/components/projects/portfolio-gantt';
import type { ProjectHealth } from '@/lib/projects/health';

// Session cache — so switching lenses (Home ↔ Projects) doesn't refetch/recompute each time. Projects
// refresh in the background; suggestions (an AI call) are computed ONCE per session and reused.
let projectsCache: Project[] | null = null;
let suggestionsCache: Suggestion[] | null = null;
const dismissedCache = new Set<string>();

// ── Projects — an AI-clustered (soon) or manually-created LENS grouping your work by initiative.
// S3.1: the list + create/edit (name, description, Goals, Rules) + archive/delete. Goals = what the
// project is trying to achieve; Rules = how your coworkers should work on it / what to avoid — the
// project-scoped intent that makes your AI team project-aware (wired to coworker context in a later slice).
// Kept simple: a clean card grid, one modal, chip-list editors. Auto-clustering + scoped detail come next.

type Project = {
  id: string; name: string; description: string | null; status: 'active' | 'archived';
  goals: string[]; rules: string[]; color: string | null; auto: boolean; itemCount?: number; health?: ProjectHealth;
};
type SuggestionItem = { table: string; id: string; title: string; who: string | null };
type Suggestion = { name: string; purpose: string; stakeholders: string[]; items: SuggestionItem[] };

// ── AI-suggested clusters — the "it just knows" surface. Each card leads with what the initiative IS
// (purpose) and WHO's involved (stakeholders), then the items (expandable). Create turns it into a real
// project + assigns the items; Dismiss hides it. Legible first, list second.
function SuggestionCard({ s, onCreate, onDismiss }: { s: Suggestion; onCreate: () => Promise<void>; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? s.items : s.items.slice(0, 3);
  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-white p-4 flex flex-col h-full">
      <div className="flex items-start gap-2.5">
        <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-100/70 text-indigo-500">
          <SparklesIcon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold text-neutral-900 leading-snug">{s.name}</h3>
          {s.purpose && <p className="text-[12px] text-neutral-500 mt-1 leading-snug">{s.purpose}</p>}
        </div>
      </div>

      {s.stakeholders.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <UsersIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
          {s.stakeholders.slice(0, 4).map((p, i) => (
            <span key={i} className="text-[11px] font-medium text-neutral-600 bg-white border border-neutral-200/70 rounded-full px-2 py-0.5">{p}</span>
          ))}
          {s.stakeholders.length > 4 && <span className="text-[11px] text-neutral-400">+{s.stakeholders.length - 4}</span>}
        </div>
      )}

      <div className="mt-3 pt-2.5 border-t border-indigo-100/60">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">{s.items.length} item{s.items.length === 1 ? '' : 's'}</p>
        <ul className="space-y-1">
          {shown.map((it, i) => (
            <li key={i} className="text-[11.5px] text-neutral-500 truncate flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-indigo-300 flex-shrink-0" />{it.title}
            </li>
          ))}
        </ul>
        {s.items.length > 3 && (
          <button onClick={() => setExpanded((v) => !v)} className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors mt-1.5">
            {expanded ? 'Show less' : `View all ${s.items.length}`}
          </button>
        )}
      </div>

      <div className="mt-auto pt-3 flex items-center gap-2">
        <Button size="sm" onClick={async () => { setBusy(true); try { await onCreate(); } finally { setBusy(false); } }} disabled={busy}>
          {busy ? 'Creating…' : 'Create project'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>Dismiss</Button>
      </div>
    </div>
  );
}

// A small add/remove chip-list editor shared by Goals + Rules.
function ChipListEditor({ label, hint, icon: Icon, items, onChange, placeholder }: {
  label: string; hint: string; icon: React.ElementType; items: string[]; onChange: (v: string[]) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (!t) return; onChange([...items, t]); setDraft(''); };
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-neutral-400" />
        <span className="text-[12px] font-semibold text-neutral-600">{label}</span>
      </div>
      <p className="text-[11.5px] text-neutral-400 mb-2">{hint}</p>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg bg-neutral-50 border border-neutral-200/70 px-2.5 py-1.5">
            <span className="flex-1 text-[12.5px] text-neutral-700">{it}</span>
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-neutral-300 hover:text-rose-500 transition-colors" aria-label="Remove">
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={placeholder} className="flex-1" />
          <Button variant="soft" size="sm" onClick={add} disabled={!draft.trim()}>Add</Button>
        </div>
      </div>
    </div>
  );
}

function ProjectModal({ initial, onClose, onSaved }: { initial: Project | null; onClose: () => void; onSaved: (p: Project) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [goals, setGoals] = useState<string[]>(initial?.goals ?? []);
  const [rules, setRules] = useState<string[]>(initial?.rules ?? []);
  const [saving, setSaving] = useState(false);
  const editing = !!initial;

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/projects/${initial!.id}` : '/api/projects', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, goals, rules }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      onSaved(d.project);
      const n = d.project?.itemCount || 0;
      toast.success(editing ? 'Project updated' : (n ? `Project created · ${n} item${n === 1 ? '' : 's'} grouped` : 'Project created'));
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/30 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div className="mt-[6vh] w-full max-w-[540px] rounded-2xl bg-white border border-neutral-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="text-[15px] font-semibold text-neutral-900">{editing ? 'Edit project' : 'New project'}</h2>
          <IconButton onClick={onClose} aria-label="Close"><XMarkIcon className="w-4 h-4" /></IconButton>
        </div>
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-[12px] font-semibold text-neutral-600 mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fidelidade deal" autoFocus />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-neutral-600 mb-1 block">Description <span className="font-normal text-neutral-400">· optional</span></label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What is this initiative about?" />
          </div>
          <ChipListEditor label="Goals" hint="What the project is trying to achieve." icon={FlagIcon} items={goals} onChange={setGoals} placeholder="Add a goal…" />
          <ChipListEditor label="Rules" hint="How your coworkers should work on it — and what to avoid." icon={ShieldCheckIcon} items={rules} onChange={setRules} placeholder="Add a rule…" />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-neutral-100">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!name.trim() || saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Create project'}</Button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ p, onOpen, onEdit, onDelete }: { p: Project; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <Card interactive className="group p-4 flex flex-col h-full" onClick={onOpen}>
      <div className="flex items-start gap-2.5">
        <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-500">
          <FolderIcon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[14px] font-semibold text-neutral-900 truncate">{p.name}</h3>
            {p.auto && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-indigo-500 bg-indigo-50 rounded-full px-1.5 py-0.5"><SparklesIcon className="w-2.5 h-2.5" />Auto</span>}
          </div>
          {p.description && <p className="text-[12px] text-neutral-500 mt-0.5 line-clamp-2 leading-snug">{p.description}</p>}
        </div>
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <IconButton onClick={onEdit} aria-label="Edit"><PencilSquareIcon className="w-3.5 h-3.5" /></IconButton>
          {confirmDel ? (
            <button onClick={onDelete} className="text-[11px] font-semibold text-rose-600 bg-rose-50 rounded-md px-2 py-1 hover:bg-rose-100 transition-colors" onMouseLeave={() => setConfirmDel(false)}>Delete</button>
          ) : (
            <IconButton tone="danger" onClick={() => setConfirmDel(true)} aria-label="Delete"><TrashIcon className="w-3.5 h-3.5" /></IconButton>
          )}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center gap-2">
        {p.health && <HealthChip status={p.health.status} size="sm" />}
        <span className="text-[11px] text-neutral-400">{p.itemCount ?? 0} open</span>
        {p.health && p.health.overdue > 0 && <span className="text-[11px] font-medium text-rose-500">{p.health.overdue} overdue</span>}
        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-neutral-300">
          {p.goals.length > 0 && <span className="inline-flex items-center gap-1"><FlagIcon className="w-3 h-3" />{p.goals.length}</span>}
          {p.rules.length > 0 && <span className="inline-flex items-center gap-1"><ShieldCheckIcon className="w-3 h-3" />{p.rules.length}</span>}
        </span>
      </div>
    </Card>
  );
}

export default function ProjectsView() {
  const [projects, setProjects] = useState<Project[] | null>(projectsCache);
  const [modal, setModal] = useState<{ open: boolean; edit: Project | null }>({ open: false, edit: null });
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(suggestionsCache); // null = still loading
  const [dismissed, setDismissed] = useState<Set<string>>(dismissedCache);
  const [selected, setSelected] = useState<Project | null>(null);
  const [mode, setMode] = useState<'portfolio' | 'timeline'>('portfolio');

  useEffect(() => {
    // Projects: show cache instantly, refresh in the background (cheap query).
    fetch('/api/projects').then((r) => r.json()).then((d) => { projectsCache = d.projects ?? []; setProjects(projectsCache); }).catch(() => { if (!projectsCache) setProjects([]); });
    // Suggestions: an AI call — compute ONCE per session, then reuse from cache (no refetch on lens switch).
    if (suggestionsCache === null) {
      fetch('/api/projects/suggestions').then((r) => r.json()).then((d) => { suggestionsCache = d.suggestions ?? []; setSuggestions(suggestionsCache); }).catch(() => { suggestionsCache = []; setSuggestions([]); });
    }
  }, []);

  const dismiss = (name: string) => { dismissedCache.add(name); setDismissed(new Set(dismissedCache)); };
  const refreshSuggestions = () => {
    setSuggestions(null); // show the loading state
    fetch('/api/projects/suggestions?refresh=1').then((r) => r.json()).then((d) => { suggestionsCache = d.suggestions ?? []; setSuggestions(suggestionsCache); }).catch(() => { suggestionsCache = []; setSuggestions([]); });
  };
  const acceptSuggestion = async (s: Suggestion) => {
    try {
      const res = await fetch('/api/projects/accept-suggestion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: s.name, purpose: s.purpose, items: s.items.map((i) => ({ table: i.table, id: i.id })) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      projectsCache = [d.project, ...(projectsCache ?? [])];
      suggestionsCache = (suggestionsCache ?? []).filter((x) => x.name !== s.name);
      setProjects(projectsCache); setSuggestions(suggestionsCache);
      toast.success(`Created “${s.name}” · ${d.project.itemCount} items grouped`);
    } catch (e) { toast.error((e as Error).message); }
  };
  const visibleSuggestions = (suggestions ?? []).filter((s) => !dismissed.has(s.name));

  const onSaved = (p: Project) => {
    const list = projectsCache ?? projects ?? [];
    const i = list.findIndex((x) => x.id === p.id);
    projectsCache = i >= 0 ? list.map((x) => (x.id === p.id ? { ...x, ...p } : x)) : [{ ...p, itemCount: 0 }, ...list];
    setProjects(projectsCache);
    setSelected((cur) => (cur && cur.id === p.id ? { ...cur, ...p } : cur)); // keep an open detail in sync
    setModal({ open: false, edit: null });
  };
  const onDelete = async (id: string) => {
    projectsCache = (projectsCache ?? projects ?? []).filter((p) => p.id !== id);
    setProjects(projectsCache);
    await fetch(`/api/projects/${id}`, { method: 'DELETE' }).catch(() => {});
    toast.success('Project deleted');
  };

  // A selected project opens its scoped detail IN PLACE (stays within the Home lens + island).
  if (selected) {
    return (
      <>
        <ProjectDetail project={selected} onBack={() => setSelected(null)} onEdit={() => setModal({ open: true, edit: selected })} />
        {modal.open && <ProjectModal initial={modal.edit} onClose={() => setModal({ open: false, edit: null })} onSaved={onSaved} />}
      </>
    );
  }

  return (
    <div className="mt-7">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Projects</h2>
          <p className="text-[13px] text-neutral-400 mt-0.5">Group your work into initiatives — with goals and rules your coworkers respect.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <SegmentedControl<'portfolio' | 'timeline'>
            value={mode}
            onChange={setMode}
            items={[{ value: 'portfolio', label: 'Portfolio' }, { value: 'timeline', label: 'Timeline' }]}
            className="w-[188px]"
          />
          <Button size="sm" onClick={() => setModal({ open: true, edit: null })}><PlusIcon className="w-4 h-4" />New project</Button>
        </div>
      </div>

      {/* TIMELINE mode — the portfolio Gantt (initiatives across time). */}
      {mode === 'timeline' && (
        <PortfolioGantt onOpenProject={(id) => { const p = (projects ?? []).find((x) => x.id === id); if (p) setSelected(p); }} />
      )}

      {mode === 'portfolio' && (<>
      {/* Suggested clusters — AUGMTD groups your work automatically; you confirm. */}
      {(suggestions === null || visibleSuggestions.length > 0) && (
        <div className="mb-7">
          <div className="flex items-center gap-1.5 mb-3">
            <SparklesIcon className={`w-3.5 h-3.5 text-indigo-500 ${suggestions === null ? 'animate-pulse' : ''}`} />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-indigo-600/80">Suggested for you</h3>
            {suggestions === null ? (
              <span className="text-[11px] text-neutral-400 animate-pulse">finding initiatives…</span>
            ) : (
              <button onClick={refreshSuggestions} title="Refresh suggestions" className="ml-1 text-neutral-300 hover:text-indigo-600 transition-colors"><ArrowPathIcon className="w-3.5 h-3.5" /></button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {suggestions === null
              ? [0, 1, 2].map((i) => <div key={i} className="h-[168px] rounded-xl border border-indigo-100/60 bg-gradient-to-br from-indigo-50/40 to-white animate-pulse" />)
              : visibleSuggestions.map((s) => (
                  <SuggestionCard key={s.name} s={s} onCreate={() => acceptSuggestion(s)} onDismiss={() => dismiss(s.name)} />
                ))}
          </div>
        </div>
      )}

      {projects === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-[104px] rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title="No projects yet"
          description="Create a project to group related emails, commitments, and your team's work — or let AUGMTD suggest them from your activity."
          action={<Button size="sm" onClick={() => setModal({ open: true, edit: null })}><PlusIcon className="w-4 h-4" />New project</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={() => setSelected(p)} onEdit={() => setModal({ open: true, edit: p })} onDelete={() => onDelete(p.id)} />
          ))}
        </div>
      )}
      </>)}

      {modal.open && <ProjectModal initial={modal.edit} onClose={() => setModal({ open: false, edit: null })} onSaved={onSaved} />}
    </div>
  );
}
