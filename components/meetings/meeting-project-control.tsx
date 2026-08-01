'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { loadLS } from '@/lib/utils/local-cache';
import { AnchoredPopover } from '@/components/ui/anchored-popover';

// The meeting's membership control — which body of work this meeting belongs to, managed where you read it.
// ONE BRAIN: operates on ENTITY LINKS — the same membership every surface reads (recognition placed it;
// your attach/detach is via='user' + locked = final; a detach is a remembered "none", so recognition never
// re-links behind your back).
type Ent = { id: string; name: string; status: string; weight: number; tracked?: boolean };

const MOM_DOT: Record<string, string> = { needs_you: 'bg-rose-500', gone_quiet: 'bg-amber-500', stalled: 'bg-amber-500', waiting: 'bg-blue-400', active: 'bg-emerald-500', unknown: 'bg-neutral-300' };

export default function MeetingProjectControl({ transcriptId }: { transcriptId: string; projectId?: string | null }) {
  const [entities, setEntities] = useState<Ent[]>(() => (loadLS<{ entities?: Ent[] }>('aug-portfolio-v1')?.entities ?? []).filter((e) => e.status === 'active'));
  const [entId, setEntId] = useState<string | null>(null);
  const [entName, setEntName] = useState<string | null>(null);
  const [momentum, setMomentum] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  const filtered = query.trim() ? entities.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())) : entities;

  useEffect(() => {
    let alive = true;
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => {
      if (alive && d?.entities) {
        // CURATED (projecthood Phase 3): the picker lists ACCEPTED projects (tracked) — the same
        // definition the Projects lens uses, ONE source. A user who accepted nothing yet sees the
        // brain's judged projects (the pre-acceptance experience is never empty).
        const act = (d.entities as Ent[]).filter((e) => e.status === 'active');
        const accepted = act.filter((e) => (e as unknown as { tracked?: boolean }).tracked);
        const judged = act.filter((e) => (e as unknown as { scope?: string | null }).scope === 'project');
        setEntities((accepted.length ? accepted : judged).sort((a, b) => b.weight - a.weight));
      }
    }).catch(() => {});
    fetch(`/api/items/entity?kind=meeting&id=${transcriptId}`).then((r) => r.json()).then((m) => {
      if (alive) { setEntId(m.entityId ?? null); setEntName(m.entityName ?? null); setMomentum(m.momentum ?? null); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [transcriptId]);
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
          {momentum ? <span className={`w-2 h-2 rounded-full flex-shrink-0 ${MOM_DOT[momentum] ?? MOM_DOT.unknown}`} /> : <FolderIcon className="w-3.5 h-3.5 text-indigo-500" />}
          <button onClick={() => setOpen((v) => !v)} className="hover:underline max-w-[160px] truncate">{entName}</button>
          <button onClick={() => setEntity(null)} disabled={busy} title="Unlink from this work" className="text-indigo-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3.5 h-3.5" /></button>
        </span>
      ) : (
        <button onClick={() => setOpen((v) => !v)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-[12px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
          <PlusIcon className="w-3.5 h-3.5" />Add to project
        </button>
      )}
      {/* PORTALED (the overlay law — components/ui/anchored-popover.tsx). */}
      <AnchoredPopover anchorRef={boxRef} open={open} onClose={() => setOpen(false)} align="left" width={256}>
        <div className="rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
          {/* Same picker grammar as the deep-dive's AddToWorkControl: search leads. */}
          <input
            autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && filtered.length === 1) setEntity(filtered[0].id);
            }}
            placeholder="Search projects…"
            className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none focus:border-indigo-300"
          />
          <div className="max-h-56 overflow-y-auto mt-1">
            {/* ONE PICKER GRAMMAR: your projects lead (name-sorted, stable); untracked below "Suggested". */}
            {(() => {
              const byName = (a: Ent, b: Ent) => a.name.localeCompare(b.name);
              const trackedList = filtered.filter((e) => e.tracked).sort(byName);
              const suggestedList = filtered.filter((e) => !e.tracked).sort(byName);
              const row = (e: Ent) => (
                <button key={e.id} onClick={() => setEntity(e.id)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-indigo-50 ${e.id === entId ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}>
                  <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" /><span className="min-w-0 flex-1 truncate">{e.name}</span>
                </button>
              );
              return (
                <>
                  {trackedList.map(row)}
                  {suggestedList.length > 0 && (
                    <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 border-t border-neutral-100 mt-1">Suggested</p>
                  )}
                  {suggestedList.map(row)}
                  {filtered.length === 0 && <p className="px-2 py-1.5 text-[12px] text-neutral-400">{query.trim() ? 'No match.' : 'Nothing to link yet.'}</p>}
                </>
              );
            })()}
          </div>
        </div>
      </AnchoredPopover>
    </div>
  );
}
