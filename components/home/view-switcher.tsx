'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Squares2X2Icon, CalendarDaysIcon, FolderIcon } from '@heroicons/react/24/outline';

// ── Floating view-switcher — a slim vertical "island" on the right edge of the Home. Collapsed to
// ICONS by default; HOVER expands it to reveal labels (smooth width animation, icons hold their x so
// nothing jumps). A top DRAG GRIP lets you reposition it vertically (persisted). It swaps the LENS on
// your workspace (Dashboard · Timeline · Projects) WITHOUT crowding — each view stays focused.
// Home-only, distinct from the app's left nav. Hidden while the Activity panel is open.

export type HomeView = 'dashboard' | 'timeline' | 'projects';

const VIEWS: Array<{ id: HomeView; label: string; icon: React.ElementType }> = [
  { id: 'dashboard', label: 'Home',     icon: Squares2X2Icon },
  { id: 'timeline',  label: 'Timeline', icon: CalendarDaysIcon },
  { id: 'projects',  label: 'Projects', icon: FolderIcon },
];

const STORE_KEY = 'home-island-top';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function ViewSwitcher({ value, onChange, hidden }: { value: HomeView; onChange: (v: HomeView) => void; hidden?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [top, setTop] = useState<number | null>(null); // px from top; null = vertically centered
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem(STORE_KEY));
    if (saved > 0) setTop(saved);
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const next = clamp(dragRef.current.startTop + (e.clientY - dragRef.current.startY), 12, window.innerHeight - 180);
    setTop(next);
  }, []);
  const onUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    setTop((t) => { if (t != null) localStorage.setItem(STORE_KEY, String(t)); return t; });
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }, [onMove]);
  const onGripDown = (e: React.PointerEvent) => {
    const current = top ?? (window.innerHeight / 2 - 70);
    dragRef.current = { startY: e.clientY, startTop: current };
    setDragging(true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  };

  const positioned = top != null;

  return (
    <div
      onMouseEnter={() => !dragging && setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={positioned ? { top } : undefined}
      className={`fixed right-5 z-30 flex flex-col overflow-hidden rounded-2xl border border-neutral-200/70 bg-white/85 backdrop-blur-md p-1.5 shadow-[0_10px_34px_-12px_rgba(0,0,0,0.22)] transition-[width,opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        positioned ? '' : 'top-1/2 -translate-y-1/2'
      } ${expanded ? 'w-[150px]' : 'w-[52px]'} ${hidden ? 'opacity-0 translate-x-4 pointer-events-none' : 'opacity-100'}`}
      role="tablist"
      aria-label="Home views"
    >
      {/* Drag grip — reposition the island vertically. */}
      <div
        onPointerDown={onGripDown}
        className={`flex items-center justify-center h-5 mb-1 rounded-lg ${dragging ? 'cursor-grabbing' : 'cursor-grab'} hover:bg-neutral-100/70 transition-colors`}
        title="Drag to move"
        aria-hidden="true"
      >
        <div className="grid grid-cols-3 gap-[3px]">
          {Array.from({ length: 6 }).map((_, i) => <span key={i} className="w-[3px] h-[3px] rounded-full bg-neutral-300" />)}
        </div>
      </div>

      {VIEWS.map((v) => {
        const active = value === v.id;
        const Icon = v.icon;
        return (
          <button
            key={v.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v.id)}
            title={v.label}
            className={`group flex items-center gap-2.5 h-10 px-[11px] rounded-xl transition-colors duration-200 ${
              active ? 'bg-indigo-50 text-indigo-600' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
            }`}
          >
            <Icon className="w-[18px] h-[18px] flex-shrink-0" />
            <span className={`text-[13px] font-medium whitespace-nowrap transition-opacity duration-300 ${expanded ? 'opacity-100 delay-100' : 'opacity-0'}`}>{v.label}</span>
          </button>
        );
      })}
    </div>
  );
}
