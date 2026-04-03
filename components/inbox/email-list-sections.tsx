'use client';

import { useState, useMemo } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { InboxItem, ItemType } from '@/lib/types/inbox';
import { SMART_VIEW_TYPES } from '@/lib/types/inbox';
import EmailListCard from './email-list-card';

interface EmailListSectionsProps {
  items: InboxItem[];
  selectedId: string | null;
  onSelect: (item: InboxItem) => void;
  compact?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
}

const SECTIONS: Array<{ key: ItemType; label: string; dim?: boolean }> = [
  { key: 'reply',    label: 'Reply Needed' },
  { key: 'decision', label: 'Decision' },
  { key: 'meeting',  label: 'Meeting' },
  { key: 'review',   label: 'Review' },
  { key: 'fyi',      label: 'Noted', dim: true },
];

export default function EmailListSections({ items, selectedId, onSelect, compact = false, selectedIds, onToggleSelect, onDelete, onArchive }: EmailListSectionsProps) {
  const hasAnySelected = (selectedIds?.size ?? 0) > 0;
  const [collapsed, setCollapsed] = useState<Set<ItemType>>(new Set());

  const bySection = useMemo(() => {
    return items.reduce((acc, item) => {
      const t = item.item_type as ItemType;
      if (!SMART_VIEW_TYPES.includes(t)) return acc;
      if (!acc[t]) acc[t] = [];
      acc[t].push(item);
      return acc;
    }, {} as Record<ItemType, InboxItem[]>);
  }, [items]);

  const toggle = (s: ItemType) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  return (
    <div className="pt-1">
      {SECTIONS.map(section => {
        const sectionItems = bySection[section.key] || [];
        if (sectionItems.length === 0) return null;
        const isCollapsed = collapsed.has(section.key);

        return (
          <div key={section.key}>
            <button
              onClick={() => toggle(section.key)}
              className="w-full h-8 flex items-center justify-between px-3 bg-neutral-50 border-b border-neutral-100 hover:bg-neutral-100 transition-colors sticky top-0 z-10"
            >
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold uppercase tracking-wide ${section.dim ? 'text-neutral-400' : 'text-neutral-600'}`}>
                  {section.label}
                </span>
                <span className="text-[10px] text-neutral-400">({sectionItems.length})</span>
              </div>
              {isCollapsed
                ? <ChevronDownIcon className="w-3.5 h-3.5 text-neutral-400" />
                : <ChevronUpIcon className="w-3.5 h-3.5 text-neutral-400" />
              }
            </button>

            {!isCollapsed && (
              <div className="px-1 py-0.5 space-y-0.5">
                {sectionItems.map(item => (
                  <EmailListCard
                    key={item.id}
                    item={item}
                    isSelected={selectedId === item.id}
                    onSelect={onSelect}
                    compact={compact}
                    isChecked={selectedIds?.has(item.id) ?? false}
                    onToggleCheck={onToggleSelect}
                    hasAnySelected={hasAnySelected}
                    onDelete={onDelete}
                    onArchive={onArchive}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
