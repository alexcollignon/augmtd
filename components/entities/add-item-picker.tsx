'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ITEM PICKER — the single "+ Add" affordance over LOOSE items (no project), shared by every
// surface that attaches work to an entity: the room's Tasks section, the portfolio's suggestion
// expansion (shape the group BEFORE accepting), and the New-project modal (found with work in it).
// One component · one read (/api/entities/loose-items, fact-filtered) · callers own the write
// (the ONE sticky membership PATCH) — nothing to drift.
// PORTALED (the overlay law, July 29): renders through AnchoredPopover so it escapes clipped/
// transformed ancestors and is never layered under sibling rails. Dismissal is outside-click +
// Escape — never mouse-leave (content visibility is never hover-tied).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { useFeatures } from '@/context/workspace-context';

export type LooseItem = { kind: 'inbox_item' | 'commitment' | 'meeting'; id: string; label: string; who: string | null; at: string | null };

export function AddItemPicker({ anchorRef, onPick, onClose, align = 'right' }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onPick: (it: LooseItem) => void; onClose: () => void; align?: 'left' | 'right';
}) {
  const features = useFeatures(); // sovereign copy law — email-off workspaces never read mailbox framing
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
    <AnchoredPopover anchorRef={anchorRef} open onClose={onClose} align={align} width={320}>
      <div className="rounded-xl border border-neutral-200 bg-white shadow-lg p-2">
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          placeholder={features.email === false ? 'Search your loose to-dos, meetings…' : 'Search your loose emails, to-dos, meetings…'}
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
    </AnchoredPopover>
  );
}
