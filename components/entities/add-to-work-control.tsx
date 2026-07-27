'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { loadLS } from '@/lib/utils/local-cache';

// ONE BRAIN — the item-level membership chip (deep-dive header, inbox detail). Shows which body of work
// this item belongs to (its ENTITY LINK) and lets the user attach/detach — via='user' + locked, so the
// memory never overrides the human. Replaces the label-era AddToProjectControl (projects table died).
type Ent = { id: string; name: string; status: string; weight: number };
const KIND_MAP: Record<string, string> = { inbox: 'inbox_item', email: 'inbox_item', meeting: 'meeting', commitment: 'commitment' };

export default function AddToWorkControl({ kind, id, compact }: { kind: string; id: string; projectId?: string | null; projectName?: string | null; suggestName?: string | null; compact?: boolean }) {
  const itemKind = KIND_MAP[kind] ?? 'inbox_item';
  const [entities, setEntities] = useState<Ent[]>(() => (loadLS<{ entities?: Ent[] }>('aug-portfolio-v1')?.entities ?? []).filter((e) => e.status === 'active'));
  const [entId, setEntId] = useState<string | null>(null);
  const [entName, setEntName] = useState<string | null>(null);
  const [entTracked, setEntTracked] = useState<boolean>(true); // T4 — accepted vs merely-recognized
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => {
      if (alive && d?.entities) setEntities((d.entities as Ent[]).filter((e) => e.status === 'active').sort((a, b) => b.weight - a.weight));
    }).catch(() => {});
    fetch(`/api/items/entity?kind=${itemKind}&id=${id}`).then((r) => r.json()).then((m) => {
      if (alive) { setEntId(m.entityId ?? null); setEntName(m.entityName ?? null); setEntTracked(m.tracked !== false); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [itemKind, id]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // Found + attach in one motion (the "this is actually EG Bank" correction). Human creation (R4);
  // the server narrates existing members into the new project's room; the attach is locked.
  const createAndAttach = async () => {
    const n = newName.trim();
    if (!n || busy) return;
    setBusy(true); setCreating(false); setNewName(''); setOpen(false);
    try {
      const res = await fetch('/api/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.id) throw new Error();
      const att = await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: itemKind, id, entityId: d.id }) });
      if (!att.ok) throw new Error();
      setEntId(d.id); setEntName(n); setEntTracked(true);
      toast.success(`Started ${n} — moved here`);
      try { window.dispatchEvent(new CustomEvent('aug:membership-changed', { detail: { kind: itemKind, id } })); } catch { /* SSR-safe */ }
      setEntities((prev) => [{ id: d.id, name: n, status: 'active', weight: 100 }, ...prev.filter((e) => e.id !== d.id)]);
    } catch { toast.error('Could not create the project'); } finally { setBusy(false); }
  };

  const setEntity = async (nid: string | null) => {
    setBusy(true); setOpen(false);
    const prev = { entId, entName };
    setEntId(nid); setEntName(nid ? (entities.find((e) => e.id === nid)?.name ?? null) : null);
    try {
      const res = await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: itemKind, id, entityId: nid }) });
      if (!res.ok) throw new Error();
      toast.success(nid ? 'Linked' : 'Unlinked');
      // Coherence (promise fix): ONE membership change → every reader of this item refetches
      // (the deep-dive view, the rail's conversation, the strip) — the chip and the room can
      // never disagree after a correction.
      try { window.dispatchEvent(new CustomEvent('aug:membership-changed', { detail: { kind: itemKind, id } })); } catch { /* SSR-safe */ }
    } catch { setEntId(prev.entId); setEntName(prev.entName); toast.error('Could not update'); } finally { setBusy(false); }
  };

  return (
    <div ref={boxRef} className="relative inline-flex items-center">
      {entId && entName && entTracked ? (
        <span className={`inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200/70 pl-2 pr-1 py-0.5 font-medium text-indigo-700 ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
          <FolderIcon className="w-3 h-3 text-indigo-500" />
          <button onClick={() => setOpen((v) => !v)} className="hover:underline max-w-[140px] truncate">{entName}</button>
          <button onClick={() => setEntity(null)} disabled={busy} title="Unlink from this work" className="text-indigo-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3 h-3" /></button>
        </span>
      ) : entId && entName ? (
        /* T4 — the memory RECOGNIZED this grouping but the user never ACCEPTED it: quiet context,
           no project chrome. Accept = track (the same verb as the portfolio). */
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-neutral-300 pl-2 pr-1.5 py-0.5 text-neutral-500 ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
          <button onClick={() => setOpen((v) => !v)} className="hover:text-neutral-700 max-w-[160px] truncate">connects to {entName}</button>
          <button
            onClick={async () => {
              setBusy(true);
              try {
                const r = await fetch(`/api/entities/${entId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'track' }) });
                if (!r.ok) throw new Error();
                setEntTracked(true); toast.success('Tracking as a project');
              } catch { toast.error('Could not track'); } finally { setBusy(false); }
            }}
            disabled={busy} className="font-medium text-indigo-500 hover:text-indigo-700 transition-colors"
          >Track</button>
          {/* Promise fix #4 — CORRECTION is one tap even on a merely-recognized grouping: "not
              this" writes the locked refusal, so recognition never re-files it here. */}
          <button onClick={() => setEntity(null)} disabled={busy} title="Wrong — this doesn't belong here" className="text-neutral-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3 h-3" /></button>
        </span>
      ) : (
        <button onClick={() => setOpen((v) => !v)} disabled={busy} className={`inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 font-medium text-neutral-400 hover:border-indigo-300 hover:text-indigo-600 transition-colors ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
          <PlusIcon className="w-3 h-3" />Link to work
        </button>
      )}
      {open && (
        <div className="absolute top-full right-0 mt-1 z-30 w-60 max-h-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
          {entities.map((e) => (
            <button key={e.id} onClick={() => setEntity(e.id)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-indigo-50 ${e.id === entId ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}>
              <FolderIcon className="w-3 h-3 flex-shrink-0 text-neutral-400" /><span className="min-w-0 flex-1 truncate">{e.name}</span>
            </button>
          ))}
          {entities.length === 0 && <p className="px-2 py-1.5 text-[12px] text-neutral-400">Nothing to link yet.</p>}
          {/* Promise fix #4 — the correction often needs a project that doesn't exist yet ("this is
              actually EG Bank"): found it right here — create (human, R4) + attach (locked) in one go. */}
          <div className="border-t border-neutral-100 mt-1 pt-1">
            {creating ? (
              <input
                autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createAndAttach(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                placeholder="New project name…"
                className="w-full rounded-lg border border-indigo-200 px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none"
              />
            ) : (
              <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
                <PlusIcon className="w-3 h-3 flex-shrink-0" />Start a new project…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
