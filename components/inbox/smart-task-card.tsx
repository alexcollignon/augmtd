'use client';

import { PaperClipIcon, CheckIcon } from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';

interface SmartTaskCardProps {
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

export default function SmartTaskCard({
  item,
  isSelected,
  onSelect,
  compact = false,
  isChecked = false,
  onToggleCheck,
  hasAnySelected = false,
}: SmartTaskCardProps) {
  const sourceData = item.source_data;

  const accentColor = item.visual_section === 'prepared'
    ? 'bg-indigo-500'
    : item.visual_section === 'suggested'
    ? 'bg-amber-400'
    : 'bg-neutral-300';

  // Task title — AI-generated outcome description, fallback to subject
  const titleDisplay = item.work_title || sourceData?.subject || '(no subject)';
  const fromDisplay = sourceData?.from_name || sourceData?.from || 'Unknown';
  const timeDisplay = sourceData?.received_at ? formatTime(sourceData.received_at as string) : '';

  // Action badge — derived from draft presence + detected role
  const actionBadge = (() => {
    if (sourceData?.draft) return { label: 'Reply', color: 'bg-violet-100 text-violet-700' };
    const role = (item.recipient_context as any)?.detectedRole;
    if (role === 'reviewer') return { label: 'Review', color: 'bg-blue-100 text-blue-700' };
    if (role === 'approver') return { label: 'Approve', color: 'bg-orange-100 text-orange-700' };
    if (role === 'informed') return { label: 'Read', color: 'bg-neutral-100 text-neutral-500' };
    return { label: 'Action', color: 'bg-neutral-100 text-neutral-600' };
  })();

  // Status chip — shown when action badge alone isn't enough context
  const statusChip = (() => {
    if (sourceData?.draft) return null;
    if (item.visual_section === 'awareness') return { label: 'FYI', color: 'text-neutral-400' };
    return null;
  })();

  const checkboxVisible = isChecked || hasAnySelected;

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
        className={`w-full text-left relative border-b border-neutral-100 transition-colors cursor-pointer group ${
          isChecked ? 'bg-indigo-50/60' : isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
        }`}
      >
        {Checkbox}
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentColor}`} />
        <div className="pl-8 pr-3 py-1.5 flex items-center gap-2">
          <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0 ${actionBadge.color}`}>
            {actionBadge.label}
          </span>
          <span className={`text-[12px] truncate flex-1 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>
            {titleDisplay}
          </span>
          {timeDisplay && (
            <span className="text-[10px] text-neutral-400 flex-shrink-0">{timeDisplay}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelect(item)}
      className={`w-full text-left relative border-b border-neutral-100 transition-colors cursor-pointer group ${
        isChecked ? 'bg-indigo-50/60' : isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
      }`}
    >
      {Checkbox}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentColor}`} />

      <div className="pl-8 pr-3 py-3">
        {/* Row 1: action badge + title + time */}
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0 ${actionBadge.color}`}>
              {actionBadge.label}
            </span>
            <span className={`text-[12px] font-semibold truncate ${isSelected ? 'text-indigo-700' : 'text-neutral-800'}`}>
              {titleDisplay}
            </span>
          </div>
          {timeDisplay && (
            <span className="text-[10px] text-neutral-400 flex-shrink-0">{timeDisplay}</span>
          )}
        </div>

        {/* Row 2: sender + status chip */}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-neutral-400 truncate">via {fromDisplay}</span>
          {statusChip && (
            <span className={`text-[10px] font-medium ${statusChip.color}`}>{statusChip.label}</span>
          )}
        </div>

        {/* Row 3: attachment indicator */}
        {sourceData?.attachments?.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            <PaperClipIcon className="w-2.5 h-2.5 text-neutral-400" />
            <span className="text-[10px] text-neutral-400">{sourceData.attachments.length}</span>
          </div>
        )}
      </div>
    </div>
  );
}
