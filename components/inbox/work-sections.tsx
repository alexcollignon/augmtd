'use client';

import { useState, useMemo } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import WorkCard from './work-card';
import { batchInboxItems } from '@/lib/utils/batch-inbox-items';
import { classifyItem, TYPE_CONFIG, TYPE_ORDER, type ItemType } from '@/lib/inbox/classify-item';

interface WorkSectionsProps {
  items: InboxItem[];
}

export default function WorkSections({ items }: WorkSectionsProps) {
  // Default-expand the "your move" types + waiting on; context (meetings, FYI) starts collapsed.
  const [expandedSections, setExpandedSections] = useState<Set<ItemType>>(
    new Set(['needs_reply', 'to_do', 'waiting_on'])
  );

  // Apply batching logic to items
  const { batches, unbatched } = useMemo(() => batchInboxItems(items), [items]);

  // Combine batches and unbatched items for display
  const displayItems = useMemo(() => {
    // Convert batches to a display format (treat as regular items for now)
    const batchItems = batches.map(batch => ({
      ...batch.items[0], // Use first item as template
      id: batch.id,
      work_title: batch.summary,
      // Add batch metadata so we can detect it
      __isBatch: true,
      __batchCount: batch.count,
      __batchItems: batch.items,
    } as InboxItem & { __isBatch: boolean; __batchCount: number; __batchItems: InboxItem[] }));

    return [...unbatched, ...batchItems];
  }, [batches, unbatched]);

  // Group every item by its single legible type (the source of truth). 'hidden' (resolved/noise)
  // never shows here.
  const itemsBySection = displayItems.reduce((acc, item) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const type = classifyItem(item as any);
    if (type === 'hidden') return acc;
    if (!acc[type]) acc[type] = [];
    acc[type].push(item);
    return acc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as Record<ItemType, any[]>);

  const toggleSection = (section: ItemType) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Section configuration comes straight from the single source of truth.
  const sections = TYPE_ORDER.map(key => ({ key, ...TYPE_CONFIG[key] }));

  return (
    <div className="space-y-8">
      {sections.map(section => {
        let sectionItems = itemsBySection[section.key] || [];
        // In "Needs reply", a READ-but-unreplied email is the sharpest "you meant to reply and
        // didn't" — surface those above the ones you haven't even opened. (read ≠ replied.)
        if (section.key === 'needs_reply') {
          sectionItems = [...sectionItems].sort((a, b) =>
            ((a as InboxItem).is_read === true ? 0 : 1) - ((b as InboxItem).is_read === true ? 0 : 1));
        }
        if (sectionItems.length === 0) return null;

        const isExpanded = expandedSections.has(section.key);

        return (
          <div key={section.key} className="space-y-4">
            {/* Section Header */}
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                {/* Status dot */}
                <div className={`w-2 h-2 rounded-full ${section.dot} shadow-sm`} />

                <div className="flex items-center gap-3">
                  <h2 className="text-[15px] font-semibold text-neutral-900">
                    {section.label}
                  </h2>

                  {/* Count badge */}
                  <div className={`
                    inline-flex items-center justify-center
                    min-w-[24px] h-6 px-2 rounded-full
                    ${section.countBg} ${section.countText}
                    text-[12px] font-semibold
                  `}>
                    {sectionItems.length}
                  </div>
                </div>

                <span className="text-[13px] text-neutral-500 hidden sm:block">
                  {section.description}
                </span>
              </div>

              {/* Expand/collapse icon */}
              <div className="p-1 rounded-lg hover:bg-neutral-100 transition-colors">
                {isExpanded ? (
                  <ChevronUpIcon className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 transition-colors" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 transition-colors" />
                )}
              </div>
            </button>

            {/* Section Items - List layout for better density */}
            {isExpanded && (
              <div className="space-y-1 animate-in fade-in duration-200">
                {sectionItems.map(item => (
                  <WorkCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Empty State */}
      {items.length === 0 && (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-neutral-100 to-neutral-200 mb-5 shadow-sm">
            <svg
              className="w-8 h-8 text-neutral-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold text-neutral-900 mb-1.5">
            All caught up!
          </h3>
          <p className="text-[13px] text-neutral-600 max-w-md mx-auto">
            No pending work items. New items will appear here when emails arrive.
          </p>
        </div>
      )}
    </div>
  );
}
