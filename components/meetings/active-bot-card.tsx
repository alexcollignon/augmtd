'use client';

import Link from 'next/link';
import { ArrowRightIcon } from '@heroicons/react/24/outline';

interface ActiveBotCardProps {
  title: string;
  state: 'joining' | 'recording';
  calendarEventId: string | null;
  startedAt?: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1m ago';
  return `${mins}m ago`;
}

export default function ActiveBotCard({ title, state, calendarEventId, startedAt }: ActiveBotCardProps) {
  const isRecording = state === 'recording';

  const inner = (
    <div className={`flex items-center gap-3 px-4 py-3 bg-white border ${isRecording ? 'border-red-100' : 'border-amber-100'} hover:bg-neutral-50 transition-colors`}>
      {/* Pulsing dot */}
      <div className={`flex-shrink-0 w-2 h-2 rounded-full animate-pulse ${isRecording ? 'bg-red-500' : 'bg-amber-400'}`} />

      {/* Title + chip */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-neutral-900 truncate">{title}</p>
        <span className={`inline-block text-[10px] font-medium mt-0.5 ${isRecording ? 'text-red-600' : 'text-amber-600'}`}>
          {isRecording ? '● Recording' : 'Joining…'}
        </span>
      </div>

      {/* Started ago + view link */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {startedAt && (
          <span className="text-[11px] text-neutral-400">{timeAgo(startedAt)}</span>
        )}
        {calendarEventId && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600">
            View <ArrowRightIcon className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  );

  if (calendarEventId) {
    return <Link href={`/meetings/${calendarEventId}`}>{inner}</Link>;
  }
  return inner;
}
