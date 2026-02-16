'use client';

import { useState, useMemo } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { InboxItem, VisualSection } from '@/lib/types/inbox';
import { getSectionDisplayName } from '@/lib/types/inbox';
import WorkCard from './work-card';
import { batchInboxItems } from '@/lib/utils/batch-inbox-items';

interface WorkSectionsProps {
  items: InboxItem[];
}

export default function WorkSections({ items }: WorkSectionsProps) {
  const [expandedSections, setExpandedSections] = useState<Set<VisualSection>>(
    new Set(['prepared', 'suggested'])
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
    }));

    return [...unbatched, ...batchItems];
  }, [batches, unbatched]);

  // Group items by visual section
  const itemsBySection = displayItems.reduce((acc, item) => {
    const section = item.visual_section || 'awareness';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<VisualSection, any[]>);

  const toggleSection = (section: VisualSection) => {
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

  // Section configuration
  const sections: Array<{
    key: VisualSection;
    title: string;
    description: string;
    dotColor: string;
    textColor: string;
    countBg: string;
    countText: string;
  }> = [
    {
      key: 'prepared',
      title: 'Prepared Work',
      description: 'Ready for your action',
      dotColor: 'bg-indigo-500',
      textColor: 'text-neutral-900',
      countBg: 'bg-indigo-100',
      countText: 'text-indigo-700',
    },
    {
      key: 'suggested',
      title: 'Suggested Work',
      description: 'May need your input — confirm if yours',
      dotColor: 'bg-amber-500',
      textColor: 'text-neutral-900',
      countBg: 'bg-amber-100',
      countText: 'text-amber-700',
    },
    {
      key: 'awareness',
      title: 'For Awareness',
      description: 'For your information only',
      dotColor: 'bg-neutral-400',
      textColor: 'text-neutral-700',
      countBg: 'bg-neutral-100',
      countText: 'text-neutral-600',
    },
  ];

  return (
    <div className="space-y-8">
      {sections.map(section => {
        const sectionItems = itemsBySection[section.key] || [];
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
                <div className={`w-2 h-2 rounded-full ${section.dotColor} shadow-sm`} />

                <div className="flex items-center gap-3">
                  <h2 className={`text-[15px] font-semibold ${section.textColor}`}>
                    {section.title}
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
                  <div key={item.id}>
                    <WorkCard item={item} />
                    {/* Show batch indicator if this is a batched item */}
                    {(item as any).__isBatch && (
                      <div className="ml-4 pl-4 border-l-2 border-neutral-200 py-1">
                        <span className="text-xs text-neutral-500">
                          {(item as any).__batchCount} similar items batched together
                        </span>
                      </div>
                    )}
                  </div>
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
