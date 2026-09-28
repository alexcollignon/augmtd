'use client';

import React from 'react';
import { cn } from '@/lib/cn';

// ─── SegmentedControl ─────────────────────────────────────────────────────────
// Canonical view switcher (e.g. Home/Skills, meetings view toggle). Neutral
// track, white active segment with shadow. For in-page section tabs that change
// the panel below, prefer <TabBar> (underline style) instead.

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentItem<T>[];
  /** Active segment. Pass null when none should be active (e.g. drilled into a
   *  different view) — all segments render inactive. */
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({ items, value, onChange, className }: SegmentedControlProps<T>) {
  return (
    <div className={cn('flex gap-0.5 p-0.5 bg-neutral-100 rounded-lg', className)}>
      {items.map(item => {
        const active = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150 ease-out',
              active ? 'bg-white text-indigo-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-700',
            )}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────────────────
// Canonical in-page tab bar (underline style) — used inside a panel to switch
// content sections (e.g. worker profile: Chat/Knowledge/Tasks/…).

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** A served count, rendered INLINE after the label as a muted number ("Tasks 5") — never baked
   *  into the label string (a "· 5" suffix wrapped onto its own line in a narrow bar). 0/absent → none. */
  count?: number;
}

export interface TabBarProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

export function TabBar<T extends string>({ tabs, active, onChange, className }: TabBarProps<T>) {
  return (
    // The bar SCROLLS rather than wraps: every tab keeps its label and count on one line.
    <div className={cn('flex gap-0 border-b border-neutral-100 px-2 overflow-x-auto [scrollbar-width:none]', className)}>
      {tabs.map(tab => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors motion-reduce:transition-none -mb-px',
              isActive ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-neutral-400 hover:text-neutral-600',
            )}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <span className="tabular-nums font-normal text-neutral-400">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
