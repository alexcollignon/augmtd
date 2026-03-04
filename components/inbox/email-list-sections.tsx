'use client';

import { useState, useMemo } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { InboxItem, VisualSection } from '@/lib/types/inbox';
import EmailListCard from './email-list-card';

interface EmailListSectionsProps {
  items: InboxItem[];
  selectedId: string | null;
  onSelect: (item: InboxItem) => void;
  compact?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

const SECTIONS: Array<{ key: VisualSection; label: string; dotColor: string }> = [
  { key: 'prepared', label: 'Prepared', dotColor: 'bg-indigo-500' },
  { key: 'suggested', label: 'Suggested', dotColor: 'bg-amber-500' },
  { key: 'awareness', label: 'For Awareness', dotColor: 'bg-neutral-400' },
];

export default function EmailListSections({ items, selectedId, onSelect, compact = false, selectedIds, onToggleSelect }: EmailListSectionsProps) {
  const hasAnySelected = (selectedIds?.size ?? 0) > 0;
  const [collapsed, setCollapsed] = useState<Set<VisualSection>>(new Set());

  const bySection = useMemo(() => {
    return items.reduce((acc, item) => {
      const s = (item.visual_section || 'awareness') as VisualSection;
      if (!acc[s]) acc[s] = [];
      acc[s].push(item);
      return acc;
    }, {} as Record<VisualSection, InboxItem[]>);
  }, [items]);

  const toggle = (s: VisualSection) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  return (
    <div>
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
                <div className={`w-1.5 h-1.5 rounded-full ${section.dotColor}`} />
                <span className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">
                  {section.label}
                </span>
                <span className="text-[10px] text-neutral-400">({sectionItems.length})</span>
              </div>
              {isCollapsed
                ? <ChevronDownIcon className="w-3.5 h-3.5 text-neutral-400" />
                : <ChevronUpIcon className="w-3.5 h-3.5 text-neutral-400" />
              }
            </button>

            {!isCollapsed && sectionItems.map(item => (
              <EmailListCard
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onSelect={onSelect}
                compact={compact}
                isChecked={selectedIds?.has(item.id) ?? false}
                onToggleCheck={onToggleSelect}
                hasAnySelected={hasAnySelected}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
