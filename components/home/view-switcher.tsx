'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Squares2X2Icon, CalendarDaysIcon, FolderIcon } from '@heroicons/react/24/outline';

// ── Workspace island — deliberately kept on the edge, while the workspace reserves its gutter so
// this never sits on top of a card or rail. It expands only on intent and preserves the distinctive
// AUGMTD interaction.

// 'conversations' and 'workflows' are sidebar-reached lenses — never switcher pills.
export type HomeView = 'dashboard' | 'timeline' | 'projects' | 'conversations' | 'workflows';

const VIEWS: Array<{ id: HomeView; label: string; icon: React.ElementType }> = [
  { id: 'dashboard', label: 'Home',     icon: Squares2X2Icon },
  { id: 'projects',  label: 'Projects', icon: FolderIcon },
  { id: 'timeline',  label: 'Timeline', icon: CalendarDaysIcon },
];

export default function ViewSwitcher({ value, onChange, hidden }: { value: HomeView; onChange: (v: HomeView) => void; hidden?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [top, setTop] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  useEffect(() => {
    const saved = Number(localStorage.getItem('home-island-top'));
    if (saved > 0) setTop(saved);
  }, []);
  const onMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    setTop(clamp(dragRef.current.startTop + (e.clientY - dragRef.current.startY), 12, window.innerHeight - 180));
  }, []);
  const onUp = useCallback(() => {
    dragRef.current = null; setDragging(false);
    setTop((t) => { if (t != null) localStorage.setItem('home-island-top', String(t)); return t; });
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
  }, [onMove]);
  const onGripDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startTop: top ?? (window.innerHeight / 2 - 70) };
    setDragging(true);
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    e.preventDefault();
  };

  return (
    <div
      onMouseEnter={() => !dragging && setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={top != null ? { top } : undefined}
      className={`fixed right-5 z-30 flex flex-col overflow-hidden rounded-2xl border border-neutral-200/70 bg-white/88 backdrop-blur-md p-1.5 shadow-[0_10px_34px_-12px_rgba(0,0,0,0.22)] transition-[width,opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${top == null ? 'top-1/2 -translate-y-1/2' : ''} ${expanded ? 'w-[150px]' : 'w-[52px]'} ${hidden ? 'opacity-0 translate-x-4 pointer-events-none' : 'opacity-100'}`}
      role="tablist"
      aria-label="Home views"
    >
      <div onPointerDown={onGripDown} className={`flex items-center justify-center h-5 mb-1 rounded-lg ${dragging ? 'cursor-grabbing' : 'cursor-grab'} hover:bg-neutral-100/70 transition-colors`} title="Drag to move" aria-hidden="true">
        <div className="grid grid-cols-3 gap-[3px]">{Array.from({ length: 6 }).map((_, i) => <span key={i} className="w-[3px] h-[3px] rounded-full bg-neutral-300" />)}</div>
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
