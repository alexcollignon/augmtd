'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONTEXT STRIP (one-room R3 — docs/one-room-plan.md). The per-anchor context, SPATIAL not
// conversational: what this work connects to (the project door, sibling threads/meetings/tasks/
// files) and — for a loose item — the founding affordance. Renders COLLAPSED at the bottom of the
// stage; the conversation stays narrative (events, proposals, chat) and never repeats this index.
// The ONLY thing that varies per anchor is THIS strip — the page anatomy never changes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRightIcon, EnvelopeIcon, CalendarDaysIcon, DocumentIcon, CheckCircleIcon, FolderIcon } from '@heroicons/react/24/outline';
import { fmtMonthDay } from '@/lib/utils/format-date';
import type { RailView } from '@/components/home/item-rail';

type StripKind = 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness';

function Chip({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition-colors max-w-full ${onClick ? 'hover:border-indigo-200 hover:text-indigo-600 cursor-pointer' : 'cursor-default'}`}
    >
      {icon}<span className="truncate">{label}</span>
    </button>
  );
}

export function ContextStrip({ kind, id, view }: { kind: StripKind; id: string; view: RailView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [founding, setFounding] = useState(false);
  const [foundName, setFoundName] = useState('');
  const [founded, setFounded] = useState<string | null>(null);
  const ent = view.entity;
  const sib = view.siblings;
  const otherThreads = sib.threads.filter((t) => !t.current);
  const related = otherThreads.length + sib.meetings.length + sib.commitments.length + sib.files.length;

  // Loose + nothing related → only the founding affordance is worth a strip; hide entirely
  // when there's nothing at all to show (grounded-or-absent).
  if (!ent && related === 0 && founded) return null;

  const linkKind = kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox_item';
  const foundProject = async () => {
    const n = foundName.trim();
    if (!n) return;
    setFounding(false); setFoundName('');
    try {
      const res = await fetch('/api/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.id) throw new Error();
      await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: linkKind, id, entityId: d.id }) });
      setFounded(n);
    } catch { setFounded(null); }
  };

  const summary = ent
    ? `${ent.tracked === false ? 'Connects to' : 'In'} ${ent.name}${related ? ` · ${related} related` : ''}`
    : founded ? `Started ${founded}` : related ? `${related} related` : 'Not part of a project';

  return (
    <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/50">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <FolderIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
        <span className="text-[12px] font-medium text-neutral-600 truncate">{summary}</span>
        <ChevronRightIcon className={`w-3.5 h-3.5 ml-auto text-neutral-300 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {ent && (
            <div className="flex flex-wrap gap-1.5">
              <Chip label={ent.tracked === false ? `Related work · ${ent.name}` : 'Open project'} onClick={() => router.push(`/?view=projects&entity=${ent.id}`)} />
            </div>
          )}
          {!ent && !founded && (
            founding ? (
              <input
                autoFocus value={foundName} onChange={(e) => setFoundName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') foundProject(); if (e.key === 'Escape') { setFounding(false); setFoundName(''); } }}
                onBlur={() => { if (foundName.trim()) foundProject(); else setFounding(false); }}
                placeholder="Project name…"
                className="w-full max-w-[240px] text-[12px] border-b border-indigo-300 outline-none bg-transparent py-0.5"
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Chip label="Start a project from this" onClick={() => setFounding(true)} />
              </div>
            )
          )}
          {founded && <p className="text-[12px] text-neutral-500">Started {founded} — this is in it now.</p>}
          {otherThreads.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {otherThreads.slice(0, 3).map((t) => (
                <Chip key={t.id} icon={<EnvelopeIcon className="w-3 h-3 flex-shrink-0" />}
                  label={`${t.who ? `${t.who.split(' ')[0]} · ` : ''}${t.subject}`}
                  onClick={() => router.push(`/item/${t.id}`)} />
              ))}
            </div>
          )}
          {(sib.meetings.length > 0 || sib.commitments.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {sib.meetings.slice(0, 2).map((m) => (
                <Chip key={m.id} icon={<CalendarDaysIcon className="w-3 h-3 flex-shrink-0" />}
                  label={`${m.title}${m.at ? ` · ${fmtMonthDay(m.at)}` : ''}`}
                  onClick={() => router.push(`/item/${m.id}?kind=meeting`)} />
              ))}
              {sib.commitments.slice(0, 3).map((c) => (
                <Chip key={c.id} icon={<CheckCircleIcon className="w-3 h-3 flex-shrink-0" />}
                  label={c.description}
                  onClick={() => router.push(`/item/${c.id}?kind=commitment`)} />
              ))}
            </div>
          )}
          {sib.files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sib.files.slice(0, 3).map((f) => (
                <Chip key={f.id} icon={<DocumentIcon className="w-3 h-3 flex-shrink-0" />} label={f.filename} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
