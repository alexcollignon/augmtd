'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FolderIcon, PlusIcon, PencilSquareIcon, TrashIcon, XMarkIcon, SparklesIcon, FlagIcon, ShieldCheckIcon, UsersIcon, ArrowPathIcon, EyeSlashIcon, FolderPlusIcon, ChevronRightIcon, ArrowRightIcon, CheckCircleIcon, ArchiveBoxIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { Button, IconButton, Input, Textarea, Card, EmptyState, SegmentedControl } from '@/components/ui';
import ProjectDetail from '@/components/projects/project-detail';
import { statusFromHealth, STATUS_TONE } from '@/lib/projects/status';
import PortfolioGantt from '@/components/projects/portfolio-gantt';
import { showUndoToast } from '@/lib/activity/undo-toast';
import type { ProjectHealth } from '@/lib/projects/health';
import type { InitiativeState } from '@/lib/projects/active-initiatives';

// Initiative state → a calm dot colour (mirrors the Home In-motion tones), so a suggestion reads its
// urgency at a glance without a heavy badge.
const STATE_DOT: Record<InitiativeState, { dot: string; text: string }> = {
  needs_attention: { dot: 'bg-rose-500',    text: 'text-rose-600' },
  active:          { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  waiting:         { dot: 'bg-blue-500',    text: 'text-blue-600' },
  awareness:       { dot: 'bg-neutral-300', text: 'text-neutral-400' },
};

// Session cache — so switching lenses (Home ↔ Projects) doesn't refetch/recompute each time. Projects
// refresh in the background; suggestions (an AI call) are computed ONCE per session and reused.
let projectsCache: Project[] | null = null;
let suggestionsCache: Suggestion[] | null = null;

// ── Projects — an AI-clustered (soon) or manually-created LENS grouping your work by initiative.
// S3.1: the list + create/edit (name, description, Goals, Rules) + archive/delete. Goals = what the
// project is trying to achieve; Rules = how your coworkers should work on it / what to avoid — the
// project-scoped intent that makes your AI team project-aware (wired to coworker context in a later slice).
// Kept simple: a clean card grid, one modal, chip-list editors. Auto-clustering + scoped detail come next.

type ProjectStatus = 'active' | 'done' | 'archived';
type Project = {
  id: string; name: string; description: string | null; status: ProjectStatus;
  goals: string[]; rules: string[]; color: string | null; auto: boolean; itemCount?: number; health?: ProjectHealth;
  nextItem?: { title: string; href: string; who: string | null; bucket: string; explicit: string | null } | null;
};
type SuggestionItem = { table: string; id: string; title: string; who: string | null };
type Suggestion = { key: string; name: string; purpose: string; state: InitiativeState; stateLabel: string; stakeholders: string[]; items: SuggestionItem[]; outreach?: string[] };

// ── AI-suggested clusters — a COMPACT ROW (collapsed: state dot · name · N related · Track / Not relevant).
// Click to expand → items (with include/exclude review) + stakeholders + Create. "Track as project" is the
// same accept action as In-motion; "Not relevant" is the persistent, undoable mute (one brain). Legible +
// dense so a long list of initiatives reads as a scannable board, not a wall of cards.
function SuggestionRow({ s, highlight, onCreate, onMute }: { s: Suggestion; highlight?: boolean; onCreate: (draft: { name: string; items: SuggestionItem[] }) => Promise<void>; onMute: () => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(s.name);
  const [included, setIncluded] = useState(() => new Set(s.items.map((_, i) => i)));
  const tone = STATE_DOT[s.state];
  const toggle = (i: number) => setIncluded((current) => { const next = new Set(current); if (next.has(i)) next.delete(i); else next.add(i); return next; });
  const relatedCount = s.items.length + (s.outreach?.length ?? 0);
  return (
    <div className={`rounded-xl border bg-white transition-all duration-300 ease-out ${highlight ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-neutral-200/80'}`}>
      {/* Collapsed header row */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left" aria-label={open ? 'Collapse' : 'Expand'}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tone.dot}`} />
          <span className="text-[13.5px] font-semibold text-neutral-900 truncate">{s.name}</span>
          <span className="text-[11px] text-neutral-400 flex-shrink-0">{relatedCount} related{s.outreach && s.outreach.length > 0 ? ` · ${s.outreach.length} awaiting` : ''}</span>
          <ChevronRightIcon className={`w-3.5 h-3.5 flex-shrink-0 text-neutral-300 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button size="sm" onClick={() => { if (!open) setOpen(true); else void onCreate({ name: name.trim() || s.name, items: s.items.filter((_, i) => included.has(i)) }); }} disabled={busy}>
            <FolderPlusIcon className="w-3.5 h-3.5" />Track
          </Button>
          <IconButton onClick={onMute} aria-label="Not relevant" title="Not relevant"><EyeSlashIcon className="w-4 h-4" /></IconButton>
        </div>
      </div>

      {/* Expanded body — review grouping + create */}
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="px-3.5 pb-3 pt-0.5 border-t border-neutral-100">
            {s.purpose && <p className="text-[12px] text-neutral-500 mt-2 leading-snug">{s.purpose}</p>}
            {s.stakeholders.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <UsersIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                {s.stakeholders.slice(0, 5).map((p, i) => <span key={i} className="text-[11px] font-medium text-neutral-600 bg-neutral-50 border border-neutral-200/70 rounded-full px-2 py-0.5">{p}</span>)}
              </div>
            )}
            <div className="mt-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Review grouping</span>
                <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" className="flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12.5px] font-medium text-neutral-900 outline-none focus:border-indigo-300" />
              </div>
              <ul className="space-y-1">
                {s.items.map((it, i) => (
                  <li key={i} className="text-[12px] flex items-center gap-1.5">
                    <button type="button" onClick={() => toggle(i)} className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] ${included.has(i) ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-neutral-300 bg-white text-transparent'}`} aria-label={`${included.has(i) ? 'Remove' : 'Include'} ${it.title}`}>✓</button>
                    <span className={included.has(i) ? 'truncate text-neutral-600' : 'truncate line-through text-neutral-300'}>{it.title}</span>
                  </li>
                ))}
                {s.items.length === 0 && s.outreach && s.outreach.length > 0 && (
                  <li className="text-[11.5px] text-neutral-400 italic">Outreach you&apos;re awaiting replies to — the project adopts them once created.</li>
                )}
              </ul>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={async () => { setBusy(true); try { await onCreate({ name: name.trim() || s.name, items: s.items.filter((_, i) => included.has(i)) }); } finally { setBusy(false); } }} disabled={busy || (s.items.length > 0 && included.size === 0) || !name.trim()}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onMute} disabled={busy}>Not relevant</Button>
            </div>
          </div>
        </div>
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme renewal" autoFocus />
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

function ProjectCard({ p, onOpen, onEdit, onDelete, onStatus }: { p: Project; onOpen: () => void; onEdit: () => void; onDelete: () => void; onStatus: (s: ProjectStatus) => void }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const terminal = p.status !== 'active';
  return (
    <Card interactive className="group p-4 flex flex-col h-full" onClick={onOpen}>
      <div className="flex items-start gap-2.5">
        <span className={`flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg ${p.status === 'done' ? 'bg-emerald-50 text-emerald-500' : p.status === 'archived' ? 'bg-neutral-100 text-neutral-400' : 'bg-indigo-50 text-indigo-500'}`}>
          <FolderIcon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className={`text-[14px] font-semibold truncate ${p.status === 'archived' ? 'text-neutral-500' : 'text-neutral-900'}`}>{p.name}</h3>
            {p.status === 'done' && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-emerald-600 bg-emerald-50 rounded-full px-1.5 py-0.5">Done</span>}
            {p.status === 'archived' && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-neutral-400 bg-neutral-100 rounded-full px-1.5 py-0.5">Archived</span>}
            {p.status === 'active' && p.auto && <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-indigo-500 bg-indigo-50 rounded-full px-1.5 py-0.5"><SparklesIcon className="w-2.5 h-2.5" />Auto</span>}
          </div>
          {p.description && <p className="text-[12px] text-neutral-500 mt-0.5 line-clamp-2 leading-snug">{p.description}</p>}
        </div>
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {terminal ? (
            <IconButton onClick={() => onStatus('active')} aria-label="Reopen" title="Reopen"><ArrowUturnLeftIcon className="w-3.5 h-3.5" /></IconButton>
          ) : (
            <>
              <IconButton onClick={() => onStatus('done')} aria-label="Mark done" title="Mark done"><CheckCircleIcon className="w-3.5 h-3.5" /></IconButton>
              <IconButton onClick={() => onStatus('archived')} aria-label="Archive" title="Archive"><ArchiveBoxIcon className="w-3.5 h-3.5" /></IconButton>
            </>
          )}
          <IconButton onClick={onEdit} aria-label="Edit"><PencilSquareIcon className="w-3.5 h-3.5" /></IconButton>
          {confirmDel ? (
            <button onClick={onDelete} className="text-[11px] font-semibold text-rose-600 bg-rose-50 rounded-md px-2 py-1 hover:bg-rose-100 transition-colors" onMouseLeave={() => setConfirmDel(false)} title="Removes the project; its items return to loose initiatives (nothing is deleted)">Un-group</button>
          ) : (
            <IconButton tone="danger" onClick={() => setConfirmDel(true)} aria-label="Un-group" title="Un-group (return items to loose)"><TrashIcon className="w-3.5 h-3.5" /></IconButton>
          )}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center gap-2">
        {p.health && (() => {
          const st = statusFromHealth(p.health); const t = STATUS_TONE[st.tone];
          return <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold ${t.text} ${t.bg} rounded-full px-1.5 py-0.5`}><span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />{st.label}</span>;
        })()}
        <span className="text-[11px] text-neutral-400">{p.itemCount ?? 0} open</span>
        {p.health && p.health.overdue > 0 && <span className="text-[11px] font-medium text-rose-500">{p.health.overdue} overdue</span>}
        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-neutral-300">
          {p.goals.length > 0 && <span className="inline-flex items-center gap-1"><FlagIcon className="w-3 h-3" />{p.goals.length}</span>}
          {p.rules.length > 0 && <span className="inline-flex items-center gap-1"><ShieldCheckIcon className="w-3 h-3" />{p.rules.length}</span>}
        </span>
      </div>
      {p.nextItem && (
        <div className="mt-2.5 rounded-lg bg-neutral-50/80 px-2.5 py-2">
          <p className="aug-eyebrow text-neutral-400">Next movement</p>
          <p className="mt-1 text-[11.5px] font-medium text-neutral-700 line-clamp-1">{p.nextItem.title}</p>
        </div>
      )}
    </Card>
  );
}

export default function ProjectsView() {
  const [projects, setProjects] = useState<Project[] | null>(projectsCache);
  const [modal, setModal] = useState<{ open: boolean; edit: Project | null }>({ open: false, edit: null });
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(suggestionsCache); // null = still loading
  const [selected, setSelected] = useState<Project | null>(null);
  const [mode, setMode] = useState<'portfolio' | 'timeline'>('portfolio');
  const [statusView, setStatusView] = useState<ProjectStatus>('active'); // portfolio filter: Active · Done · Archived
  const [suggestionsUpdatedAt, setSuggestionsUpdatedAt] = useState<Date | null>(null);
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null); // ?initiative=<key> deep-link from In-motion
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    // Projects: show cache instantly, refresh in the background (cheap query).
    fetch('/api/projects').then((r) => r.json()).then((d) => { projectsCache = d.projects ?? []; setProjects(projectsCache); }).catch(() => { if (!projectsCache) setProjects([]); });
    // Suggestions: an AI call — compute ONCE per session, then reuse from cache (no refetch on lens switch).
    if (suggestionsCache === null) {
      fetch('/api/projects/suggestions', { cache: 'no-store' }).then((r) => r.json()).then((d) => { suggestionsCache = d.suggestions ?? []; setSuggestions(suggestionsCache); setSuggestionsUpdatedAt(new Date()); }).catch(() => { suggestionsCache = []; setSuggestions([]); });
    }
    // Deep-link: land on a specific initiative's suggestion (from the In-motion "Open in Projects").
    const target = new URLSearchParams(window.location.search).get('initiative');
    if (target) { setHighlightKey(target); setShowAllSuggestions(true); }
  }, []);

  // Once the highlighted suggestion is in the DOM, scroll it into view + let the ring fade after a moment.
  useEffect(() => {
    if (!highlightKey) return;
    const el = rowRefs.current[highlightKey];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightKey(null), 2600);
    return () => clearTimeout(t);
  }, [highlightKey, suggestions]);

  // MUTE ("not relevant") — persistent + undoable (one brain with In-motion). Optimistically drop it from
  // the suggestion list + session cache, persist via /api/initiatives/mute; Undo un-mutes (via showUndoToast's
  // restore) and re-adds it. The spine already filters muted initiatives, so it won't return on next fetch.
  const mute = (s: Suggestion) => {
    suggestionsCache = (suggestionsCache ?? []).filter((x) => x.key !== s.key);
    setSuggestions(suggestionsCache);
    fetch('/api/initiatives/mute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: s.key, label: s.name }) }).catch(() => {});
    showUndoToast({
      message: `Marked "${s.name}" not relevant`, entityType: 'initiative', entityId: s.key,
      onUndo: () => { suggestionsCache = [s, ...(suggestionsCache ?? [])]; setSuggestions(suggestionsCache); },
    });
  };
  const refreshSuggestions = () => {
    if (refreshingSuggestions) return;
    setRefreshingSuggestions(true);
    setSuggestions(null); // show the loading state
    fetch(`/api/projects/suggestions?refresh=1&at=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).then((d) => { suggestionsCache = d.suggestions ?? []; setSuggestions(suggestionsCache); setSuggestionsUpdatedAt(new Date()); }).catch(() => { suggestionsCache = []; setSuggestions([]); }).finally(() => setRefreshingSuggestions(false));
  };
  const acceptSuggestion = async (s: Suggestion, draft?: { name: string; items: SuggestionItem[] }) => {
    const selected = draft ?? { name: s.name, items: s.items };
    if (!selected.items.length) return;
    try {
      const res = await fetch('/api/projects/accept-suggestion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selected.name, purpose: s.purpose, items: selected.items.map((i) => ({ table: i.table, id: i.id })) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      projectsCache = [d.project, ...(projectsCache ?? [])];
      suggestionsCache = (suggestionsCache ?? []).filter((x) => x.key !== s.key);
      setProjects(projectsCache); setSuggestions(suggestionsCache);
      toast.success(`Created “${selected.name}” · ${d.project.itemCount} items grouped`);
    } catch (e) { toast.error((e as Error).message); }
  };
  const visibleSuggestions = suggestions ?? [];

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
    toast.success('Un-grouped · items returned to loose initiatives');
  };
  // Lifecycle transition (done / archived / active-reopen). Optimistic; the card re-buckets under the
  // matching status filter. Un-group stays a delete; this is the non-destructive lifecycle.
  const setStatus = async (id: string, status: ProjectStatus) => {
    const list = projectsCache ?? projects ?? [];
    projectsCache = list.map((p) => (p.id === id ? { ...p, status } : p));
    setProjects(projectsCache);
    setSelected((cur) => (cur && cur.id === id ? { ...cur, status } : cur));
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!res.ok) throw new Error();
      toast.success(status === 'done' ? 'Marked done' : status === 'archived' ? 'Archived' : 'Reopened');
    } catch { toast.error('Could not update the project'); }
  };

  // A selected project opens its scoped detail IN PLACE (stays within the Home lens + island).
  if (selected) {
    return (
      <>
        <ProjectDetail project={selected} onBack={() => setSelected(null)} onEdit={() => setModal({ open: true, edit: selected })} onStatus={(s) => setStatus(selected.id, s)} onUngroup={() => { onDelete(selected.id); setSelected(null); }} />
        {modal.open && <ProjectModal initial={modal.edit} onClose={() => setModal({ open: false, edit: null })} onSaved={onSaved} />}
      </>
    );
  }

  return (
    <div className="mt-7">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Projects</h2>
          <p className="text-[13px] text-neutral-400 mt-0.5">Give related work a place to live. You confirm every project before it becomes part of your workspace.</p>
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
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-indigo-600/80">Possible projects</h3>
            {suggestions === null ? (
              <span className="text-[11px] text-neutral-400 animate-pulse">re-reading ungrouped work…</span>
            ) : (
              <span className="ml-1 flex items-center gap-2">
                {suggestionsUpdatedAt && <span className="text-[10.5px] font-normal text-neutral-300">updated just now</span>}
                <button onClick={refreshSuggestions} title="Re-read ungrouped work" className={`text-neutral-300 hover:text-indigo-600 transition-colors ${refreshingSuggestions ? 'animate-spin text-indigo-400' : ''}`}><ArrowPathIcon className="w-3.5 h-3.5" /></button>
              </span>
            )}
          </div>
          {suggestions === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-[52px] rounded-xl border border-neutral-200/70 bg-neutral-50/60 animate-pulse" />)}</div>
          ) : (() => {
            const CAP = 6;
            const lead = visibleSuggestions.slice(0, CAP);
            const rest = visibleSuggestions.slice(CAP);
            const shown = showAllSuggestions ? visibleSuggestions : lead;
            return (
              <div className="space-y-2">
                {shown.map((s) => (
                  <div key={s.key} ref={(el) => { rowRefs.current[s.key] = el; }}>
                    <SuggestionRow s={s} highlight={highlightKey === s.key} onCreate={(draft) => acceptSuggestion(s, draft)} onMute={() => mute(s)} />
                  </div>
                ))}
                {rest.length > 0 && (
                  <button onClick={() => setShowAllSuggestions((v) => !v)} className="text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 transition-all duration-150 ease-out pt-0.5">
                    {showAllSuggestions ? 'Show less' : `Show ${rest.length} more`}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Portfolio status filter — Active is the working set; Done + Archived keep the record out of the way.
          Only the buckets that have projects show a tab (no empty "Archived" tab when there's nothing there). */}
      {projects !== null && projects.length > 0 && (() => {
        const counts = { active: 0, done: 0, archived: 0 } as Record<ProjectStatus, number>;
        for (const p of projects) counts[p.status]++;
        const tabs: ProjectStatus[] = (['active', 'done', 'archived'] as ProjectStatus[]).filter((s) => counts[s] > 0 || s === 'active');
        return (
          <div className="flex items-center gap-1 mb-3">
            {tabs.map((s) => (
              <button key={s} onClick={() => setStatusView(s)} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium transition-all duration-150 ease-out ${statusView === s ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50'}`}>
                {s === 'active' ? 'Active' : s === 'done' ? 'Done' : 'Archived'}
                <span className="tabular-nums text-[11px] opacity-70">{counts[s]}</span>
              </button>
            ))}
          </div>
        );
      })()}

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
      ) : projects.filter((p) => p.status === statusView).length === 0 ? (
        <p className="text-[13px] text-neutral-400 py-6 text-center">No {statusView} projects.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.filter((p) => p.status === statusView).map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={() => setSelected(p)} onEdit={() => setModal({ open: true, edit: p })} onDelete={() => onDelete(p.id)} onStatus={(s) => setStatus(p.id, s)} />
          ))}
        </div>
      )}
      </>)}

      {modal.open && <ProjectModal initial={modal.edit} onClose={() => setModal({ open: false, edit: null })} onSaved={onSaved} />}
    </div>
  );
}
