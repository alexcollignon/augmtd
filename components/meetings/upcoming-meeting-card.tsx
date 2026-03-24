'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowPathIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  CalendarDaysIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import { formatMeetingTime, calculateDuration } from '@/lib/types/meetings';

interface LinkedWork {
  processes: Array<{ id: string; title: string; score: number }>;
  threads: Array<{ id: string; title: string; score: number }>;
  files: Array<{ id: string; filename: string; score: number }>;
  priorMeetings: Array<{ id: string; title: string; calendarEventId: string | null; score: number }>;
}

interface UpcomingMeetingCardProps {
  event: CalendarEvent;
  botState: string | null;
  onScheduled?: (eventId: string) => void;
  onCancelled?: (eventId: string) => void;
}

export default function UpcomingMeetingCard({ event, botState, onScheduled, onCancelled }: UpcomingMeetingCardProps) {
  const [linkedWork, setLinkedWork] = useState<LinkedWork | null>(null);
  const [schedulingBot, setSchedulingBot] = useState(false);
  const [cancellingBot, setCancellingBot] = useState(false);

  // Reset scheduling state if parent cancels from elsewhere (e.g. sidebar)
  useEffect(() => {
    if (!botState || botState === 'cancelled') {
      setSchedulingBot(false);
    }
  }, [botState]);
  const { primary } = formatMeetingTime(event.start_time, event.end_time);
  const duration = calculateDuration(event.start_time, event.end_time);

  useEffect(() => {
    fetch(`/api/meetings/${event.id}/linked-work`)
      .then((r) => r.json())
      .then(setLinkedWork)
      .catch(() => {});
  }, [event.id]);

  const totalChips =
    (linkedWork?.processes.length ?? 0) +
    (linkedWork?.threads.length ?? 0) +
    (linkedWork?.files.length ?? 0) +
    (linkedWork?.priorMeetings.length ?? 0);

  const prepReady = totalChips >= 2;

  const statusBadge = event.meeting_status === 'in_progress'
    ? { label: 'Now', className: 'text-red-700 bg-red-50' }
    : event.meeting_status === 'starting_soon'
    ? { label: 'Soon', className: 'text-amber-700 bg-amber-50' }
    : prepReady
    ? { label: 'Prep ready', className: 'text-emerald-700 bg-emerald-50' }
    : null;

  return (
    <Link href={`/meetings/${event.id}`}>
      <div className="flex items-start gap-4 px-4 py-3 bg-white border border-neutral-100 hover:bg-neutral-50 transition-colors cursor-pointer">
        {/* Icon */}
        <div className="flex-shrink-0 w-8 h-8 bg-neutral-100 flex items-center justify-center mt-0.5">
          {event.meeting_link
            ? <VideoCameraIcon className="w-4 h-4 text-neutral-500" />
            : <CalendarDaysIcon className="w-4 h-4 text-neutral-500" />
          }
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-neutral-900 leading-tight truncate">
              {event.title}
            </h3>
            {statusBadge && (
              <span className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-[11px] text-neutral-500">
              {primary} · {duration}min
              {event.attendees.length > 0 && (
                <> · {event.attendees.slice(0, 3).map((a) => a.name?.split(' ')[0] || a.email?.split('@')[0]).join(', ')}{event.attendees.length > 3 && ` +${event.attendees.length - 3}`}</>
              )}
            </p>
            {event.meeting_link?.includes('meet.google.com') && (
              botState === 'joining' ? (
                <span className="text-[10px] font-medium text-amber-600">Joining…</span>
              ) : botState === 'recording' ? (
                <span className="text-[10px] font-medium text-red-600">● Recording</span>
              ) : botState === 'done' ? (
                <span className="text-[10px] font-medium text-neutral-400">Done</span>
              ) : botState === 'scheduled' ? (
                cancellingBot ? (
                  <span className="text-[10px] font-medium text-neutral-400 animate-pulse">Removing assistant…</span>
                ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-emerald-600">Assistant scheduled ✓</span>
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCancellingBot(true);
                      let success = false;
                      try {
                        const res = await fetch(`/api/meetings/${event.id}/cancel-bot`, { method: 'DELETE' });
                        success = res.ok;
                      } finally {
                        setCancellingBot(false);
                      }
                      if (success) { setSchedulingBot(false); onCancelled?.(event.id); }
                    }}
                    className="text-[10px] text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    × Remove
                  </button>
                </span>
                )
              ) : schedulingBot ? (
                <span className="text-[10px] font-medium text-neutral-400 animate-pulse">Scheduling assistant…</span>
              ) : (
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSchedulingBot(true);
                    try {
                      const res = await fetch(`/api/meetings/${event.id}/schedule-bot`, { method: 'POST' });
                      if (res.ok) {
                        onScheduled?.(event.id);
                        // Don't reset schedulingBot — botState prop change handles the transition
                      } else {
                        setSchedulingBot(false);
                      }
                    } catch {
                      setSchedulingBot(false);
                    }
                  }}
                  className="text-[10px] font-medium text-indigo-500 hover:text-indigo-700"
                >
                  + Send assistant
                </button>
              )
            )}
          </div>

          {/* Context chips */}
          {linkedWork && totalChips > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {linkedWork.processes.slice(0, 2).map((p) => (
                <Chip key={p.id} icon={<ArrowPathIcon className="w-3 h-3" />} label={p.title} color="indigo" />
              ))}
              {linkedWork.threads.slice(0, 1).map((t) => (
                <Chip key={t.id} icon={<ChatBubbleLeftRightIcon className="w-3 h-3" />} label={t.title} color="blue" />
              ))}
              {linkedWork.files.slice(0, 1).map((f) => (
                <Chip key={f.id} icon={<DocumentTextIcon className="w-3 h-3" />} label={f.filename} color="neutral" />
              ))}
              {linkedWork.priorMeetings.slice(0, 1).map((m) => (
                <Chip key={m.id} icon={<CalendarDaysIcon className="w-3 h-3" />} label={m.title} color="violet" />
              ))}
            </div>
          )}

          {!linkedWork && (
            <div className="flex gap-1.5 mt-1.5">
              {[1, 2].map((i) => <div key={i} className="h-4 w-20 bg-neutral-100 animate-pulse" />)}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function Chip({
  icon,
  label,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  color: 'indigo' | 'blue' | 'neutral' | 'violet';
}) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    neutral: 'bg-neutral-50 text-neutral-600 border-neutral-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border ${colors[color]} max-w-[160px]`}>
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}
