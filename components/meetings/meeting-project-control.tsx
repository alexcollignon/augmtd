'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';

// The meeting's PROJECT control — surface + manage which deal a meeting belongs to, right where you read it
// (not only from the project detail). A chip when assigned (✕ to detach), or "Add to project" → a picker.
// Reuses PATCH /api/items/project (kind:'meeting'), which sets project_locked so the choice sticks.
type Project = { id: string; name: string };

export default function MeetingProjectControl({ transcriptId, projectId }: { transcriptId: string; projectId?: string | null }) {
  const [pid, setPid] = useState<string | null>(projectId ?? null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (projectId !== undefined) setPid(projectId); }, [projectId]);
  useEffect(() => {
    // Lazy-load the project list (names for the chip + the picker) once.
    fetch('/api/projects').then((r) => r.json()).then((d) => setProjects((d.projects ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))).catch(() => {});
    // Resolve current membership when not provided by the host (keeps the control self-contained).
    if (projectId === undefined) fetch(`/api/items/project?kind=meeting&id=${transcriptId}`).then((r) => r.json()).then((d) => setPid(d.projectId ?? null)).catch(() => {});
  }, [transcriptId, projectId]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = projects.find((p) => p.id === pid) || null;
  const set = async (projectId: string | null) => {
    setBusy(true); setOpen(false);
    const prev = pid; setPid(projectId);
    try {
      const res = await fetch('/api/items/project', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'meeting', id: transcriptId, projectId }) });
      if (!res.ok) throw new Error();
      toast.success(projectId ? 'Added to project' : 'Removed from project');
    } catch { setPid(prev); toast.error('Could not update'); } finally { setBusy(false); }
  };

  return (
    <div ref={boxRef} className="relative inline-flex items-center">
      {pid && current ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/70 pl-2 pr-1 py-0.5 text-[12px] font-medium text-indigo-700">
          <FolderIcon className="w-3.5 h-3.5 text-indigo-500" />
          <button onClick={() => setOpen((v) => !v)} className="hover:underline max-w-[160px] truncate">{current.name}</button>
          <button onClick={() => set(null)} disabled={busy} title="Remove from project" className="text-indigo-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3.5 h-3.5" /></button>
        </span>
      ) : (
        <button onClick={() => setOpen((v) => !v)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-[12px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
          <PlusIcon className="w-3.5 h-3.5" />Add to project
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-56 max-h-64 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
          {projects.length === 0 && <p className="px-2 py-1.5 text-[12px] text-neutral-400">No projects yet.</p>}
          {projects.map((p) => (
            <button key={p.id} onClick={() => set(p.id)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-indigo-50 ${p.id === pid ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}>
              <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" /><span className="min-w-0 flex-1 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
