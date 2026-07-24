'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ITEM PICKER — the single "+ Add" affordance over LOOSE items (no project), shared by every
// surface that attaches work to an entity: the room's Tasks section, the portfolio's suggestion
// expansion (shape the group BEFORE accepting), and the New-project modal (found with work in it).
// One component · one read (/api/entities/loose-items, fact-filtered) · callers own the write
// (the ONE sticky membership PATCH) — nothing to drift.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';

export type LooseItem = { kind: 'inbox_item' | 'commitment' | 'meeting'; id: string; label: string; who: string | null; at: string | null };

export function AddItemPicker({ onPick, onClose, align = 'right' }: {
  onPick: (it: LooseItem) => void; onClose: () => void; align?: 'left' | 'right';
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<LooseItem[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/entities/loose-items${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then((r) => r.json()).then((d) => setItems(Array.isArray(d.items) ? d.items : [])).catch(() => setItems([]));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 z-30 w-[320px] rounded-xl border border-neutral-200 bg-white shadow-lg p-2`} onMouseLeave={onClose}>
      <input
        autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search your loose emails, to-dos, meetings…"
        className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12px] text-neutral-700 placeholder:text-neutral-300 outline-none focus:border-indigo-300 transition-colors"
      />
      <div className="mt-1.5 max-h-[260px] overflow-y-auto">
        {items === null ? (
          <p className="text-[12px] text-neutral-300 px-2 py-3">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-neutral-300 px-2 py-3">Nothing loose{q ? ' matches' : ''} — everything recent is already placed.</p>
        ) : items.map((it) => (
          <button key={`${it.kind}-${it.id}`} onClick={() => onPick(it)} className="block w-full text-left rounded-lg px-2 py-1.5 hover:bg-neutral-50 transition-colors">
            <span className="block text-[12px] text-neutral-700 truncate">{it.label}</span>
            {it.who && <span className="block text-[11px] text-neutral-400 truncate">{it.who.split('<')[0].trim()}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
