'use client';

import { useState, useMemo } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { InboxItem, ItemType, UserInboxCategory } from '@/lib/types/inbox';
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
  onFlag?: (id: string) => void;
  onCategorize?: (id: string, category: string | null) => void;
  userCategories?: UserInboxCategory[];
  sectionOrder?: string[];
}

const SECTIONS: Array<{ key: ItemType; label: string; dim?: boolean }> = [
  { key: 'reply',    label: 'Reply Needed' },
  { key: 'decision', label: 'Decision' },
  { key: 'meeting',  label: 'Meeting' },
  { key: 'review',   label: 'Review' },
  { key: 'fyi',      label: 'Noted', dim: true },
];

export default function EmailListSections({ items, selectedId, onSelect, compact = false, selectedIds, onToggleSelect, onDelete, onArchive, onFlag, onCategorize, userCategories = [], sectionOrder }: EmailListSectionsProps) {
  const orderedSections = sectionOrder
    ? [...SECTIONS].sort((a, b) => {
        const ai = sectionOrder.indexOf(a.key);
        const bi = sectionOrder.indexOf(b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
    : SECTIONS;
  const hasAnySelected = (selectedIds?.size ?? 0) > 0;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flaggedCollapsed, setFlaggedCollapsed] = useState(false);

  const flaggedItems = useMemo(() => items.filter(i => i.is_flagged === true), [items]);

  const bySection = useMemo(() => {
    const acc = items.reduce((acc, item) => {
      const t = item.item_type as ItemType;
      if (!SMART_VIEW_TYPES.includes(t)) return acc;
      const sd = item.source_data;
      if (!sd?.from_name && !sd?.from && !sd?.subject) return acc; // skip ghost rows
      if (!acc[t]) acc[t] = [];
      acc[t].push(item);
      return acc;
    }, {} as Record<ItemType, InboxItem[]>);
    // Sort each bucket newest first
    for (const key of Object.keys(acc) as ItemType[]) {
      acc[key].sort((a, b) => {
        const aTime = a.source_data?.received_at ? new Date(a.source_data.received_at as string).getTime() : new Date(a.created_at).getTime();
        const bTime = b.source_data?.received_at ? new Date(b.source_data.received_at as string).getTime() : new Date(b.created_at).getTime();
        return bTime - aTime;
      });
    }
    return acc;
  }, [items]);

  const toggle = (s: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const renderCard = (item: InboxItem) => (
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
      onFlag={onFlag}
      onCategorize={onCategorize}
      userCategories={userCategories}
      selectedIds={selectedIds}
    />
  );

  // Custom category sections (user-defined, shown above built-in sections)
  const customSections = useMemo(() =>
    userCategories.map(cat => ({
      cat,
      items: items.filter(i => i.custom_category === cat.name),
    })).filter(s => s.items.length > 0),
  [userCategories, items]);

  return (
    <div className="pt-1">
      {/* Custom user-defined sections — at top, above built-ins */}
      {customSections.map(({ cat, items: catItems }) => {
        const key = `custom:${cat.id}`;
        const isCollapsed = collapsed.has(key);
        return (
          <div key={key}>
            <button
              onClick={() => toggle(key)}
              className="w-full h-8 flex items-center justify-between px-3 bg-indigo-50 border-b border-indigo-100 hover:bg-indigo-100 transition-colors sticky top-0 z-10"
            >
              <div className="flex items-center gap-1.5">
                {cat.emoji && <span className="text-[13px]">{cat.emoji}</span>}
                <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">{cat.name}</span>
                <span className="text-[10px] text-indigo-400">({catItems.length})</span>
              </div>
              {isCollapsed
                ? <ChevronDownIcon className="w-3.5 h-3.5 text-indigo-400" />
                : <ChevronUpIcon className="w-3.5 h-3.5 text-indigo-400" />
              }
            </button>
            {!isCollapsed && (
              <div className="px-1 py-0.5 space-y-0.5">
                {catItems.map(renderCard)}
              </div>
            )}
          </div>
        );
      })}

      {/* Flagged section — always at top */}
      {flaggedItems.length > 0 && (
        <div>
          <button
            onClick={() => setFlaggedCollapsed(v => !v)}
            className="w-full h-8 flex items-center justify-between px-3 bg-amber-50 border-b border-amber-100 hover:bg-amber-100 transition-colors sticky top-0 z-10"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">Flagged</span>
              <span className="text-[10px] text-amber-400">({flaggedItems.length})</span>
            </div>
            {flaggedCollapsed
              ? <ChevronDownIcon className="w-3.5 h-3.5 text-amber-400" />
              : <ChevronUpIcon className="w-3.5 h-3.5 text-amber-400" />
            }
          </button>
          {!flaggedCollapsed && (
            <div className="px-1 py-0.5 space-y-0.5">
              {flaggedItems.map(renderCard)}
            </div>
          )}
        </div>
      )}

      {orderedSections.map(section => {
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
                {sectionItems.map(renderCard)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
