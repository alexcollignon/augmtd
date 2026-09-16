'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE FILED DRAWER (owner, Sep 14: "the component is different across projects, loose items…
// now we're screwed as you have to double or triple the maintenance work. very sloppy.")
//
// He is right. The Sep 14 room wave (a wider, reader-sized drawer · the optimistic deeds · saved
// chats) landed on the PROJECT door while the /item door kept a 420px lookalike of the same
// slide-over with its own chrome, its own escape handling, its own animation block and no drag at
// all. Two spellings of one pane can only ever agree by luck.
//
// So the pane is ONE component, and what differs between doors is DATA:
//   · the project door files Tasks · Schedule · Meetings · Conversations (+ saved chats) · Files ·
//     Activity · History, with the intent band above and the deliverables below;
//   · a loose item files Thread · Related · Files · Prepared · History.
// There is no kind branch in here — a section is `{ id, label, node }`, and a door that has
// nothing to file renders no section (empty sections are ABSENT, never scaffolded).
//
// What the component itself owns, once, for every door: THE OVERLAY LAW (fixed to the viewport, so
// no clipping ancestor can swallow it) · the three ways out (✕ · Escape · a click outside, never
// mouse-leave) · the reduced-motion floor · and THE READER'S OWN WIDTH (the Gantt's idiom —
// dragged from the panel's own edge, clamped, persisted under one key).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { TabBar } from '@/components/ui';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

// THE FILED DRAWER'S WIDTH — the reader's, remembered (owner walk, Sep 14). One key, one clamp,
// stated once: a pane that can be dragged to zero or past the thread is not adjustable, it is
// breakable.
export const FILED_W_KEY = 'aug-filed-w';
// THE READER'S DEFAULT IS THE WIDEST ONE (owner walk, Sep 15). 540 was a compromise nobody asked
// for: everything this pane holds is a LIST of truncating rows — filenames, subjects, task titles —
// and the first thing every reader did was drag it open. The drag and the persisted key are
// untouched; only the width a reader gets before they have expressed a preference changes, and it
// is now the same number the clamp already calls the maximum. A saved width still wins.
export const FILED_W_MIN = 360;
export const FILED_W_MAX = 720;
export const FILED_W_DEFAULT = FILED_W_MAX;
export const clampFiledW = (w: number) => Math.max(FILED_W_MIN, Math.min(FILED_W_MAX, Math.round(w)));

/** THE DRAWER'S NAME (owner walk, Sep 15: "Filed — weird label, find something easier to
 *  understand"). "Filed" named the MECHANISM (the engine's verb for putting a thing away); a reader
 *  opening a project wants the word for what is behind the handle. "Details" is that word, and it
 *  lives HERE, once, so the two doors and the pane's own title can never drift apart. */
export const FILED_LABEL = 'Details';

/** A drawer section — the filed truth, summoned. Empty sections are ABSENT, never scaffolded.
 *  The icon is the section's own mark in the tab row — the house icon set, leading the label; a
 *  section without one simply renders its words (the kit's own optional). */
export type FiledSection = { id: string; label: string; node: React.ReactNode; icon?: React.ComponentType<{ className?: string }> };

export function FiledDrawer({
  open, onClose, title, sections, initialId, signal, banner, footer, emptyLine,
}: {
  open: boolean;
  onClose: () => void;
  /** The work's own name — the drawer says what it is filing, never what it thinks about it. */
  title: string;
  sections: FiledSection[];
  /** Which section the address asks for on the first open (?tab=work → Tasks). */
  initialId?: string;
  /** A host's request to land on a named section (the card's "Thread →"). Bumping `v` re-fires. */
  signal?: { tab: string; v: number } | null;
  /** Rendered above every section (the project room's Goals | Rules band). */
  banner?: React.ReactNode;
  /** Rendered below every section (what this work has PRODUCED — the one list nothing else holds). */
  footer?: React.ReactNode;
  emptyLine?: string;
}) {
  const [tab, setTab] = useState<string>(initialId ?? '');
  const activeId = sections.some((s) => s.id === tab) ? tab : (sections[0]?.id ?? '');
  const [filedW, setFiledW] = useState(FILED_W_DEFAULT);
  const draggingRef = useRef(false);

  useEffect(() => {
    const saved = Number(loadLS<number>(FILED_W_KEY) ?? NaN);
    if (Number.isFinite(saved)) setFiledW(clampFiledW(saved));
  }, []);

  // Escape closes — THE ONE overlay idiom (Escape + outside click, never mouse-leave).
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // THE CARD'S DOOR LANDS ON ITS SECTION — a "Thread →" lands on Thread, never on whatever was last
  // read. Signal-keyed (never mount-keyed) so a second click is never dead.
  const sigV = signal?.v ?? 0;
  const sigTab = signal?.tab ?? '';
  useEffect(() => {
    if (!sigV) return;
    if (sigTab) setTab(sigTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigV]);

  // The edge drag: pointer events on the WINDOW (a fast drag must not fall off the 6px handle),
  // written straight to state and persisted on release. Reduced-motion-irrelevant, no animation.
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      ev.preventDefault();
      setFiledW(clampFiledW(window.innerWidth - ev.clientX));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      setFiledW((w) => { saveLS(FILED_W_KEY, w); return w; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label={`${title} — ${FILED_LABEL}`}>
      <style href="aug-room-drawer" precedence="default">{`
@keyframes aug-drawer-in { from { transform: translateX(18px); opacity: 0.5; } to { transform: none; opacity: 1; } }
.aug-drawer { animation: aug-drawer-in 0.18s ease-out; }
@media (prefers-reduced-motion: reduce) { .aug-drawer { animation: none; } }
`}</style>
      {/* Outside-click closes; the thread stays readable beneath (no scrim over the record). */}
      <div className="absolute inset-0" onClick={() => onClose()} />
      <aside
        className="aug-drawer absolute top-0 right-0 h-full w-full flex flex-col bg-white border-l border-neutral-200/80 shadow-[-12px_0_32px_rgba(0,0,0,0.07)]"
        style={{ maxWidth: filedW }}
      >
        {/* THE EDGE IS THE HANDLE (the Gantt's own idiom): a 6px grab strip on the panel's border —
            the border IS the affordance, so the drawer grows no extra chrome. */}
        <div
          onPointerDown={(ev) => { ev.preventDefault(); draggingRef.current = true; document.body.style.cursor = 'col-resize'; }}
          onDoubleClick={() => { setFiledW(FILED_W_DEFAULT); saveLS(FILED_W_KEY, FILED_W_DEFAULT); }}
          role="separator" aria-orientation="vertical" aria-label="Resize the filed panel"
          title="Drag to resize · double-click to reset"
          className="absolute left-0 top-0 h-full w-1.5 -ml-[3px] cursor-col-resize hover:bg-indigo-200/60 transition-colors"
        />
        <div className="flex-shrink-0 flex items-center gap-2 px-5 pt-4 pb-3">
          {/* THE WORK NAMES ITSELF FIRST: the thing, then what you are looking at about it. */}
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-neutral-900">
            {title} <span className="font-normal text-neutral-400">— {FILED_LABEL}</span>
          </h2>
          <button onClick={() => onClose()} className="flex-shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors" title="Close">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* THE TABS — counts are COUNTED, never subtracted (the sum law); a section with nothing
            behind it never reaches this component at all. */}
        {sections.length > 1 && (
          <div className="flex-shrink-0 px-2">
            <TabBar tabs={sections.map((s) => ({ id: s.id, label: s.label, ...(s.icon ? { icon: s.icon } : {}) }))} active={activeId} onChange={setTab} />
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {banner}
          {sections.length === 0
            ? <p className="text-[12.5px] text-neutral-300">{emptyLine ?? 'Nothing filed under this yet.'}</p>
            : sections.find((s) => s.id === activeId)?.node}
          {footer}
        </div>
      </aside>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HISTORY SECTION (owner, Sep 14, twice: "the 'earlier' things I'm not sure it makes sense…
// I'm not sure where to fit it or what value it brings but looks odd").
//
// THE STREAM SHOWS THE PRESENT. The inline "earlier (N)" handle expanded into a wall of grey legacy
// narration sitting ABOVE the room's opening — record masquerading as conversation. The record did
// not stop mattering; its SEAT was wrong. It lives here now, in the one place this product already
// keeps filed truth, read-only like everything else in the drawer.
//
// What is PRESENT still stays in the stream by its own rules (a live ask, a card, the coalesced
// delta, the last turns of the exchange) — only the folded PAST relocates. The archival laws
// underneath (what counts as history at all) are untouched.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type RoomHistoryLine = { id: string; role: 'user' | 'system'; who: string | null; text: string; at: string | null };

export function RoomHistorySection({ lines }: { lines: RoomHistoryLine[] }) {
  if (!lines.length) return null;
  return (
    <div className="space-y-1.5">
      {lines.map((l) => (
        <p key={l.id} className="text-[12px] leading-snug text-neutral-500">
          {l.role === 'user'
            ? <span className="font-medium text-neutral-700">You: </span>
            : l.who ? <span className="font-medium text-neutral-700">{l.who.split(' ')[0]}: </span> : null}
          {l.text}
          {l.at && <span className="ml-1.5 text-[11px] text-neutral-300 tabular-nums">{l.at.slice(0, 10)}</span>}
        </p>
      ))}
    </div>
  );
}
