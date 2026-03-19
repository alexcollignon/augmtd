'use client';

import Link from 'next/link';
import { MicrophoneIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';

interface TranscriptListCardProps {
  id: string;
  calendarEventId: string | null;
  title: string;
  startTime: string;
  durationMinutes: number;
  workItemsGenerated: number;
  processed: boolean;
  source: 'bot' | 'recording' | 'upload';
  summary?: string | null;
}

export default function TranscriptListCard({
  id,
  calendarEventId,
  title,
  startTime,
  durationMinutes,
  workItemsGenerated,
  processed,
  source,
  summary,
}: TranscriptListCardProps) {
  const href = calendarEventId ? `/meetings/${calendarEventId}` : `/meetings/recording/${id}`;

  const date = new Date(startTime);
  const dateLabel = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const timeLabel = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const statusBadge = !processed
    ? { label: 'Processing', className: 'text-amber-700 bg-amber-50' }
    : workItemsGenerated > 0
    ? { label: 'Reviewed', className: 'text-green-700 bg-green-50' }
    : { label: 'Needs review', className: 'text-red-700 bg-red-50' };

  const SourceIcon = source === 'upload' ? CloudArrowUpIcon : MicrophoneIcon;

  const inner = (
    <div className="flex items-start gap-4 px-4 py-3 bg-white border border-neutral-100 hover:bg-neutral-50 transition-colors cursor-pointer">
      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 bg-neutral-100 flex items-center justify-center mt-0.5">
        <SourceIcon className="w-4 h-4 text-neutral-500" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-neutral-900 leading-tight truncate">
            {title}
          </h3>
          <span className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        </div>

        <p className="text-[11px] text-neutral-500 mt-0.5">
          {dateLabel} · {timeLabel} · {durationMinutes}min
        </p>

        {summary && (
          <p className="text-[12px] text-neutral-600 mt-1.5 line-clamp-2 leading-relaxed">
            {summary}
          </p>
        )}

        {workItemsGenerated > 0 && (
          <p className="text-[11px] text-blue-600 font-medium mt-1">
            {workItemsGenerated} action {workItemsGenerated === 1 ? 'item' : 'items'} extracted
          </p>
        )}
      </div>
    </div>
  );

  return <Link href={href}>{inner}</Link>;
}
