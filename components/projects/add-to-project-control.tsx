'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderIcon, FolderPlusIcon, XMarkIcon, MagnifyingGlassIcon, SparklesIcon, CheckIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { broadcastProjectsUpdated } from '@/lib/projects/broadcast';

// The UNIVERSAL "add this to a project" control — one primitive reused on every item surface (inbox email,
// Home deep-dive, meeting). Reuses PATCH /api/items/project (sticky project_locked, RLS-safe, shared-note
// aware). Intuitive: the AI's best guess (`suggestName`, e.g. the item's initiative/sender) is pre-offered,
// then a typeahead over existing projects, then "New project". Optimistic + toast-with-undo + broadcasts so
// every other surface updates instantly (no reload).
type Project = { id: string; name: string };
type Kind = 'inbox' | 'meeting' | 'commitment';

export default function AddToProjectControl({
  kind,
  id,
  projectId,
  projectName,
  suggestName,
  compact = false,
  onChanged,
}: {
  kind: Kind;
  id: string;
  projectId?: string | null;         // current membership if the host knows it (else resolved lazily)
  projectName?: string | null;       // current project name for the chip (else resolved from the list)
  suggestName?: string | null;       // the AI best-guess label (initiative / sender), pre-offered
  compact?: boolean;                 // smaller "＋" affordance (dense rows)
  onChanged?: (projectId: string | null, projectName: string | null) => void;
}) {
  const [pid, setPid] = useState<string | null>(projectId ?? null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (projectId !== undefined) setPid(projectId ?? null); }, [projectId]);
  useEffect(() => {
    fetch('/api/projects?basic=1').then((r) => r.json())
      .then((d) => setProjects((d.projects ?? []).map((p: Project) => ({ id: p.id, name: p.name }))))
      .catch(() => {}).finally(() => setLoaded(true));
    // Resolve current membership if the host didn't provide it.
    if (projectId === undefined) fetch(`/api/items/project?kind=${kind}&id=${id}`).then((r) => r.json()).then((d) => setPid(d.projectId ?? null)).catch(() => {});
  }, [kind, id, projectId]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); } };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = projects.find((p) => p.id === pid) ?? (pid && projectName ? { id: pid, name: projectName } : null);

  // Does the AI suggestion already match an existing project? (case/space-insensitive)
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const suggestedProject = suggestName ? projects.find((p) => norm(p.name) === norm(suggestName)) ?? null : null;
  const showCreateSuggested = !!suggestName && !suggestedProject && !query.trim();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, query]);

  const apply = async (projectId: string | null, name: string | null) => {
    setBusy(true); setOpen(false); setQuery('');
    const prev = pid; setPid(projectId);
    onChanged?.(projectId, name);
    try {
      const res = await fetch('/api/items/project', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, projectId }),
      });
      if (!res.ok) throw new Error();
      broadcastProjectsUpdated({ reason: 'attach' });
      if (projectId) {
        toast.success(`Added to ${name ?? 'project'}`, { action: { label: 'Undo', onClick: () => apply(prev, projects.find((p) => p.id === prev)?.name ?? null) } });
      } else {
        toast.success('Removed from project');
      }
    } catch { setPid(prev); onChanged?.(prev, projects.find((p) => p.id === prev)?.name ?? null); toast.error('Could not update'); }
    finally { setBusy(false); }
  };

  // Create a project (from the suggestion or the typed query) then attach.
  const createAndAttach = async (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setBusy(true); setOpen(false); setQuery('');
    try {
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: clean }) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const p = data.project ?? data;
      if (!p?.id) throw new Error();
      setProjects((prev) => [...prev, { id: p.id, name: p.name }]);
      await apply(p.id, p.name); // apply() broadcasts + toasts
    } catch { toast.error('Could not create project'); setBusy(false); }
  };

  return (
    <div ref={boxRef} className="relative inline-flex items-center">
      {pid && current ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/70 pl-2 pr-1 py-0.5 text-[12px] font-medium text-indigo-700">
          <FolderIcon className="w-3.5 h-3.5 text-indigo-500" />
          <button onClick={() => setOpen((v) => !v)} className="hover:underline max-w-[160px] truncate">{current.name}</button>
          <button onClick={() => apply(null, null)} disabled={busy} title="Remove from project" className="text-indigo-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3.5 h-3.5" /></button>
        </span>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          className={compact
            ? 'inline-flex items-center gap-1 rounded-full border border-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors'
            : 'inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-[12px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors'}
        >
          <FolderPlusIcon className="w-3.5 h-3.5" />{compact ? 'Project' : 'Add to project'}
        </button>
      )}

      {open && (
        <div className="absolute top-full right-0 mt-1 z-40 w-64 rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
          {/* Search */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-neutral-100 mb-1">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && query.trim() && filtered.length === 0) createAndAttach(query); if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
              placeholder="Search or create…" className="flex-1 min-w-0 text-[12px] outline-none bg-transparent placeholder:text-neutral-400"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {/* AI best-guess: create the suggested initiative as a project */}
            {showCreateSuggested && (
              <button onClick={() => createAndAttach(suggestName!)} disabled={busy}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-amber-700 hover:bg-amber-50 transition-colors">
                <SparklesIcon className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1 truncate">New project “{suggestName}”</span>
              </button>
            )}
            {/* Suggested match already exists → highlight it first */}
            {suggestedProject && !query.trim() && (
              <button onClick={() => apply(suggestedProject.id, suggestedProject.name)} disabled={busy}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-indigo-700 hover:bg-indigo-50 transition-colors">
                <SparklesIcon className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1 truncate">{suggestedProject.name}</span>
                <span className="text-[10px] text-amber-600 flex-shrink-0">suggested</span>
              </button>
            )}

            {!loaded && <p className="px-2 py-1.5 text-[12px] text-neutral-400">Loading…</p>}
            {filtered.filter((p) => p.id !== suggestedProject?.id || query.trim()).map((p) => (
              <button key={p.id} onClick={() => apply(p.id, p.name)} disabled={busy}
                className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-indigo-50 ${p.id === pid ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}>
                <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.id === pid && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0 text-indigo-500" />}
              </button>
            ))}

            {/* Create from the typed query when it doesn't match anything */}
            {query.trim() && filtered.length === 0 && (
              <button onClick={() => createAndAttach(query)} disabled={busy}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-50 transition-colors">
                <FolderPlusIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate">New project “{query.trim()}”</span>
              </button>
            )}
            {loaded && projects.length === 0 && !suggestName && !query.trim() && (
              <p className="px-2 py-1.5 text-[12px] text-neutral-400">Type a name to create your first project.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
