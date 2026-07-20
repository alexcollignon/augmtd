'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { loadLS } from '@/lib/utils/local-cache';

// The meeting's membership control — which body of work this meeting belongs to, managed where you read it.
// ONE BRAIN: operates on ENTITY LINKS — the same membership every surface reads (recognition placed it;
// your attach/detach is via='user' + locked = final; a detach is a remembered "none", so recognition never
// re-links behind your back).
type Ent = { id: string; name: string; status: string; weight: number };

const MOM_DOT: Record<string, string> = { needs_you: 'bg-rose-500', gone_quiet: 'bg-amber-500', stalled: 'bg-amber-500', waiting: 'bg-blue-400', active: 'bg-emerald-500' };

export default function MeetingProjectControl({ transcriptId }: { transcriptId: string; projectId?: string | null }) {
  const [entities, setEntities] = useState<Ent[]>(() => (loadLS<{ entities?: Ent[] }>('aug-portfolio-v1')?.entities ?? []).filter((e) => e.status === 'active'));
  const [entId, setEntId] = useState<string | null>(null);
  const [entName, setEntName] = useState<string | null>(null);
  const [momentum, setMomentum] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => {
      if (alive && d?.entities) setEntities((d.entities as Ent[]).filter((e) => e.status === 'active').sort((a, b) => b.weight - a.weight));
    }).catch(() => {});
    fetch(`/api/items/entity?kind=meeting&id=${transcriptId}`).then((r) => r.json()).then((m) => {
      if (alive) { setEntId(m.entityId ?? null); setEntName(m.entityName ?? null); setMomentum(m.momentum ?? null); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [transcriptId]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const setEntity = async (id: string | null) => {
    setBusy(true); setOpen(false);
    const prev = { entId, entName };
    const next = id ? entities.find((e) => e.id === id) ?? null : null;
    setEntId(id); setEntName(next?.name ?? null);
    try {
      const res = await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'meeting', id: transcriptId, entityId: id }) });
      if (!res.ok) throw new Error();
      toast.success(id ? 'Linked' : 'Unlinked');
    } catch { setEntId(prev.entId); setEntName(prev.entName); toast.error('Could not update'); } finally { setBusy(false); }
  };

  return (
    <div ref={boxRef} className="relative inline-flex items-center">
      {entId && entName ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/70 pl-2 pr-1 py-0.5 text-[12px] font-medium text-indigo-700">
          {momentum ? <span className={`w-2 h-2 rounded-full flex-shrink-0 ${MOM_DOT[momentum] ?? 'bg-emerald-500'}`} /> : <FolderIcon className="w-3.5 h-3.5 text-indigo-500" />}
          <button onClick={() => setOpen((v) => !v)} className="hover:underline max-w-[160px] truncate">{entName}</button>
          <button onClick={() => setEntity(null)} disabled={busy} title="Unlink from this work" className="text-indigo-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3.5 h-3.5" /></button>
        </span>
      ) : (
        <button onClick={() => setOpen((v) => !v)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-[12px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
          <PlusIcon className="w-3.5 h-3.5" />Link to work
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-64 max-h-64 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
          {entities.map((e) => (
            <button key={e.id} onClick={() => setEntity(e.id)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-indigo-50 ${e.id === entId ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}>
              <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" /><span className="min-w-0 flex-1 truncate">{e.name}</span>
            </button>
          ))}
          {entities.length === 0 && <p className="px-2 py-1.5 text-[12px] text-neutral-400">Nothing to link yet.</p>}
        </div>
      )}
    </div>
  );
}
