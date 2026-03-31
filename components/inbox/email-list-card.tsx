'use client';

import Image from 'next/image';
import { PaperClipIcon, CheckIcon } from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';


interface EmailListCardProps {
  item: InboxItem;
  isSelected: boolean;
  onSelect: (item: InboxItem) => void;
  compact?: boolean;
  isChecked?: boolean;
  onToggleCheck?: (id: string) => void;
  hasAnySelected?: boolean;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function EmailListCard({ item, isSelected, onSelect, compact = false, isChecked = false, onToggleCheck, hasAnySelected = false }: EmailListCardProps) {
  const sourceData = item.source_data;
  const accentColor = item.visual_section === 'prepared'
    ? 'bg-indigo-500'
    : 'bg-neutral-300';

  const fromDisplay = sourceData?.from_name || sourceData?.from || '';
  const subjectDisplay = sourceData?.subject || '';

  const snippetDisplay = ((typeof sourceData?.snippet === 'string' ? sourceData.snippet : null)
    || (typeof sourceData?.body === 'string' ? [...sourceData.body].slice(0, 120).join('') : null)
    || '').normalize('NFC').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const timeDisplay = sourceData?.received_at ? formatTime(sourceData.received_at as string) : '';

  const checkboxVisible = isChecked || hasAnySelected;

  // pointer-events-none when hidden so the invisible zone doesn't intercept card clicks
  const Checkbox = (
    <div
      onClick={(e) => { e.stopPropagation(); onToggleCheck?.(item.id); }}
      className={`absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center z-10 transition-opacity cursor-pointer ${
        checkboxVisible
          ? 'opacity-100'
          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
      }`}
    >
      <div className={`w-3.5 h-3.5 border-2 flex items-center justify-center flex-shrink-0 ${
        isChecked ? 'border-indigo-600 bg-indigo-600' : 'border-neutral-300 bg-white'
      }`}>
        {isChecked && <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
      </div>
    </div>
  );

  if (compact) {
    return (
      <div
        onClick={() => onSelect(item)}
        className={`w-full text-left relative rounded-md transition-colors cursor-pointer group ${
          isChecked ? 'bg-indigo-50/60' : isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
        }`}
      >
        {Checkbox}
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md ${accentColor}`} />
        <div className="pl-8 pr-3 py-1.5">
          <div className="flex items-baseline justify-between gap-2 mb-0.5">
            <span className={`text-[12px] font-semibold truncate ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
              {fromDisplay}
            </span>
            {timeDisplay && (
              <span className="text-[10px] text-neutral-400 flex-shrink-0">{timeDisplay}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <p className={`text-[11px] truncate flex-1 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-500'}`}>
              {subjectDisplay}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelect(item)}
      className={`w-full text-left relative rounded-md transition-colors cursor-pointer group ${
        isChecked ? 'bg-indigo-50/60' : isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
      }`}
    >
      {Checkbox}
      {/* Accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md ${accentColor}`} />

      <div className="pl-8 pr-3 py-3">
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
          <p className="text-[11px] text-neutral-400 line-clamp-1 leading-relaxed" suppressHydrationWarning>
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
          {sourceData?.attachments?.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-neutral-400">
              <PaperClipIcon className="w-2.5 h-2.5" />
              <span className="text-[10px]">{sourceData.attachments.length}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
