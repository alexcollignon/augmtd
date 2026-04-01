'use client';

import { useMemo } from 'react';
import type { InboxItem } from '@/lib/types/inbox';
import EmailListCard from './email-list-card';

interface EmailListChronologicalProps {
  items: InboxItem[];
  selectedId: string | null;
  onSelect: (item: InboxItem) => void;
  compact?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (itemDay.getTime() === today.getTime()) return 'Today';
  if (itemDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function EmailListChronological({ items, selectedId, onSelect, compact = false, selectedIds, onToggleSelect }: EmailListChronologicalProps) {
  const hasAnySelected = (selectedIds?.size ?? 0) > 0;
  const groups = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const aTime = a.source_data?.received_at ? new Date(a.source_data.received_at as string).getTime() : 0;
      const bTime = b.source_data?.received_at ? new Date(b.source_data.received_at as string).getTime() : 0;
      return bTime - aTime;
    });

    const result: Array<{ label: string; items: InboxItem[] }> = [];
    let currentLabel = '';
    for (const item of sorted) {
      const label = item.source_data?.received_at
        ? getDateLabel(item.source_data.received_at as string)
        : 'Earlier';
      if (label !== currentLabel) {
        result.push({ label, items: [item] });
        currentLabel = label;
      } else {
        result[result.length - 1].items.push(item);
      }
    }
    return result;
  }, [items]);

  return (
    <div className="pt-1">
      {groups.map(group => (
        <div key={group.label}>
          <div className="h-8 flex items-center px-3 bg-neutral-50 border-b border-neutral-100 sticky top-0 z-10">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
              {group.label}
            </span>
          </div>
          <div className="px-1 py-0.5 space-y-0.5">
            {group.items.map(item => (
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
        </div>
      ))}
    </div>
  );
}
