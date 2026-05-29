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
  const hasAnySelected = (selectedIds?.size ?? 0) > 0;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flaggedCollapsed, setFlaggedCollapsed] = useState(false);

  const flaggedItems = useMemo(() => items.filter(i => i.is_flagged === true), [items]);

  const bySection = useMemo(() => {
    const acc = items.reduce((acc, item) => {
      // Custom category takes priority — don't show in built-in sections
      if (item.custom_category) return acc;
      const t = item.item_type as ItemType;
      if (!SMART_VIEW_TYPES.includes(t)) return acc;
      const sd = item.source_data;
      if (!sd?.from_name && !sd?.from && !sd?.subject) return acc;
      if (!acc[t]) acc[t] = [];
      acc[t].push(item);
      return acc;
    }, {} as Record<ItemType, InboxItem[]>);
    for (const key of Object.keys(acc) as ItemType[]) {
      acc[key].sort((a, b) => {
        const aTime = a.source_data?.received_at ? new Date(a.source_data.received_at as string).getTime() : new Date(a.created_at).getTime();
        const bTime = b.source_data?.received_at ? new Date(b.source_data.received_at as string).getTime() : new Date(b.created_at).getTime();
        return bTime - aTime;
      });
    }
    return acc;
  }, [items]);

  // Build a unified ordered list: built-ins + custom categories merged by sectionOrder.
  // sectionOrder may contain built-in keys ('reply','decision',...) and custom category names.
  const allSections = useMemo(() => {
    const builtinMap = Object.fromEntries(SECTIONS.map(s => [s.key, s]));
    const customMap = Object.fromEntries(userCategories.map(c => [c.name, c]));
    const defaultKeys = [...SECTIONS.map(s => s.key), ...userCategories.map(c => c.name)];
    const orderedKeys = sectionOrder
      ? [
          ...sectionOrder.filter(k => k in builtinMap || k in customMap),
          ...defaultKeys.filter(k => !sectionOrder.includes(k)),
        ]
      : defaultKeys;
    return orderedKeys.map(key => {
      if (key in builtinMap) return { type: 'builtin' as const, key, label: builtinMap[key].label, dim: builtinMap[key].dim };
      if (key in customMap) return { type: 'custom' as const, key, cat: customMap[key] };
      return null;
    }).filter(Boolean) as Array<
      | { type: 'builtin'; key: string; label: string; dim?: boolean }
      | { type: 'custom'; key: string; cat: UserInboxCategory }
    >;
  }, [sectionOrder, userCategories]);

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

  return (
    <div className="pt-1">
      {/* Flagged — always pinned at top */}
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

      {/* Unified ordered sections — built-ins and custom categories interleaved */}
      {allSections.map(entry => {
        const sectionItems = entry.type === 'builtin'
          ? (bySection[entry.key as ItemType] || [])
          : items.filter(i => i.custom_category === entry.cat.name);
        if (sectionItems.length === 0) return null;
        const isCollapsed = collapsed.has(entry.key);
        const isCustom = entry.type === 'custom';

        return (
          <div key={entry.key}>
            <button
              onClick={() => toggle(entry.key)}
              className={`w-full h-8 flex items-center justify-between px-3 border-b transition-colors sticky top-0 z-10 ${
                isCustom
                  ? 'bg-indigo-50 border-indigo-100 hover:bg-indigo-100'
                  : 'bg-neutral-50 border-neutral-100 hover:bg-neutral-100'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-[11px] font-semibold uppercase tracking-wide ${
                  isCustom ? 'text-indigo-600' : (entry.type === 'builtin' && entry.dim) ? 'text-neutral-400' : 'text-neutral-600'
                }`}>
                  {entry.type === 'builtin' ? entry.label : entry.cat.name}
                </span>
                <span className={`text-[10px] ${isCustom ? 'text-indigo-400' : 'text-neutral-400'}`}>({sectionItems.length})</span>
              </div>
              {isCollapsed
                ? <ChevronDownIcon className={`w-3.5 h-3.5 ${isCustom ? 'text-indigo-400' : 'text-neutral-400'}`} />
                : <ChevronUpIcon className={`w-3.5 h-3.5 ${isCustom ? 'text-indigo-400' : 'text-neutral-400'}`} />
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
