'use client';

import Image from 'next/image';
import { PaperClipIcon } from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import { needsConfirmation } from '@/lib/types/inbox';

interface EmailListCardProps {
  item: InboxItem;
  isSelected: boolean;
  onSelect: (item: InboxItem) => void;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function EmailListCard({ item, isSelected, onSelect }: EmailListCardProps) {
  const sourceData = item.source_data;
  const isBatch = (item as any).__isBatch === true;
  const batchCount = (item as any).__batchCount as number | undefined;
  const needsConfirm = needsConfirmation(item);

  const accentColor = needsConfirm
    ? 'bg-amber-400'
    : item.visual_section === 'prepared'
    ? 'bg-indigo-500'
    : item.visual_section === 'suggested'
    ? 'bg-amber-400'
    : 'bg-neutral-300';

  const fromDisplay = isBatch && batchCount && batchCount > 1
    ? `${batchCount} emails`
    : sourceData?.from_name || sourceData?.from || 'Unknown';

  const subjectDisplay = isBatch
    ? item.work_title || sourceData?.subject || '(no subject)'
    : sourceData?.subject || '(no subject)';

  const snippetDisplay = (typeof sourceData?.snippet === 'string' ? sourceData.snippet : null)
    || (typeof sourceData?.body === 'string' ? sourceData.body.slice(0, 120) : null)
    || '';
  const timeDisplay = sourceData?.received_at ? formatTime(sourceData.received_at as string) : '';

  return (
    <button
      onClick={() => onSelect(item)}
      className={`w-full text-left relative border-b border-neutral-100 transition-colors ${
        isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
      }`}
    >
      {/* Accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentColor}`} />

      <div className="pl-4 pr-3 py-3">
        {/* Row 1: From + time */}
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <span className={`text-[13px] font-semibold truncate ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
            {fromDisplay}
          </span>
          {timeDisplay && (
            <span className="text-[10px] text-neutral-400 flex-shrink-0">{timeDisplay}</span>
          )}
        </div>

        {/* Row 2: Subject */}
        <p className={`text-[12px] truncate mb-0.5 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>
          {subjectDisplay}
        </p>

        {/* Row 3: Snippet */}
        {snippetDisplay && (
          <p className="text-[11px] text-neutral-400 line-clamp-1 leading-relaxed">
            {snippetDisplay}
          </p>
        )}

        {/* Provider + badges */}
        <div className="flex items-center gap-2 mt-1.5">
          {sourceData?.provider && (
            <Image
              src={sourceData.provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
              alt={sourceData.provider as string}
              width={10}
              height={10}
              className="opacity-30"
            />
          )}
          {needsConfirm && (
            <span className="text-[10px] text-amber-600 font-medium">Confirm?</span>
          )}
          {sourceData?.draft && (
            <span className="text-[10px] text-violet-600">Draft ready</span>
          )}
          {sourceData?.attachments?.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-neutral-400">
              <PaperClipIcon className="w-2.5 h-2.5" />
              <span className="text-[10px]">{sourceData.attachments.length}</span>
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
