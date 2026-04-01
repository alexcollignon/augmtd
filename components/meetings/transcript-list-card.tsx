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
  botState: string | null;
  source: 'bot' | 'recording' | 'upload';
  summary?: string | null;
  isNew?: boolean;
  attendees?: Array<{ email: string; name?: string }>;
}

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-orange-100 text-orange-700',
];

function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(attendee: { email: string; name?: string }): string {
  if (attendee.name) {
    const parts = attendee.name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }
  return attendee.email.slice(0, 2).toUpperCase();
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]{10,}[.!?]/);
  return match ? match[0].trim() : text.split('\n')[0].trim();
}

export default function TranscriptListCard({
  id,
  calendarEventId,
  title,
  startTime,
  durationMinutes,
  workItemsGenerated,
  processed,
  botState,
  source,
  summary,
  isNew,
  attendees = [],
}: TranscriptListCardProps) {
  const href = calendarEventId ? `/meetings/${calendarEventId}` : `/meetings/recording/${id}`;

  const date = new Date(startTime);
  const dateLabel = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const timeLabel = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const statusBadge = !processed
    ? { label: 'Transcribing…', className: 'text-amber-700 bg-amber-50' }
    : botState === 'failed'
    ? { label: 'Failed', className: 'text-red-700 bg-red-50' }
    : null;

  const sourceLabel = source === 'bot' ? 'Online' : source === 'recording' ? 'In-person' : 'Upload';
  const SourceIcon = source === 'upload' ? CloudArrowUpIcon : MicrophoneIcon;

  const bulletSummary = summary ? firstSentence(summary) : null;
  const visibleAttendees = attendees.slice(0, 5);
  const extraCount = attendees.length - visibleAttendees.length;

  const inner = (
    <div className="flex items-start gap-4 px-4 py-3 bg-neutral-50 rounded-lg hover:bg-neutral-100 transition-colors cursor-pointer">
      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 bg-white rounded-lg flex items-center justify-center mt-0.5 shadow-sm">
        <SourceIcon className="w-4 h-4 text-neutral-500" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-neutral-900 leading-tight truncate flex items-center gap-1.5">
            {title}
            {isNew && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0 inline-block" />}
          </h3>
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-400 bg-neutral-100 rounded-md px-2 py-0.5">{sourceLabel}</span>
            {statusBadge && (
              <span className={`text-[11px] font-medium rounded-md px-2 py-0.5 ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
        </div>

        <p className="text-[11px] text-neutral-500 mt-0.5">
          {dateLabel} · {timeLabel}{durationMinutes > 0 && ` · ${durationMinutes}min`}
        </p>

        {bulletSummary && (
          <p className="text-[12px] text-neutral-600 mt-1.5 truncate leading-relaxed">
            <span className="text-neutral-300 mr-1">•</span>{bulletSummary}
          </p>
        )}

        {/* Attendees + action items row */}
        {(visibleAttendees.length > 0 || workItemsGenerated > 0) && (
          <div className="flex items-center justify-between mt-2">
            {visibleAttendees.length > 0 ? (
              <div className="flex items-center">
                <div className="flex -space-x-1">
                  {visibleAttendees.map((a) => (
                    <div
                      key={a.email}
                      title={a.name || a.email}
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-1 ring-white ${avatarColor(a.email)}`}
                    >
                      {initials(a)}
                    </div>
                  ))}
                </div>
                {extraCount > 0 && (
                  <span className="ml-1.5 text-[10px] text-neutral-400">+{extraCount}</span>
                )}
              </div>
            ) : <div />}

            {workItemsGenerated > 0 && (
              <p className="text-[11px] text-blue-600 font-medium">
                {workItemsGenerated} action {workItemsGenerated === 1 ? 'item' : 'items'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return <Link href={href}>{inner}</Link>;
}
