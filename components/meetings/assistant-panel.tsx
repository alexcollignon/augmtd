'use client';

import { useState } from 'react';
import {
  ChevronRightIcon,
  ComputerDesktopIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';

interface AssistantPanelProps {
  meetings: CalendarEvent[];
  userEmail: string;
  botStateMap: Map<string, string>;
  onScheduled: (eventId: string) => void;
  onCancelled: (eventId: string) => void;
  onRefresh?: () => void;
  onClose: () => void;
  onSwitchPanel?: () => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getBotStateInfo(state?: string | null): { label: string; className: string; action?: 'schedule' | 'cancel' } | null {
  if (!state) return { label: 'Not scheduled', className: 'text-neutral-400 bg-neutral-50', action: 'schedule' };
  if (state === 'scheduled') return { label: 'Scheduled', className: 'text-emerald-600 bg-emerald-50', action: 'cancel' };
  if (state === 'cancelled') return { label: 'Cancelled', className: 'text-neutral-400 bg-neutral-50', action: 'schedule' };
  if (state === 'joining') return { label: 'Joining…', className: 'text-blue-600 bg-blue-50' };
  if (state === 'recording') return { label: 'Recording', className: 'text-red-600 bg-red-50' };
  if (state === 'processing') return { label: 'Transcribing', className: 'text-amber-600 bg-amber-50' };
  if (state === 'done') return { label: 'Done', className: 'text-emerald-600 bg-emerald-50' };
  if (state === 'failed') return { label: 'Failed', className: 'text-red-600 bg-red-50', action: 'schedule' };
  return null;
}

function groupByDate(meetings: CalendarEvent[]): Array<{ label: string; meetings: CalendarEvent[] }> {
  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();

  const groups = new Map<string, CalendarEvent[]>();
  const order: string[] = [];

  for (const m of meetings) {
    const dateStr = new Date(m.start_time).toDateString();
    if (!groups.has(dateStr)) {
      groups.set(dateStr, []);
      order.push(dateStr);
    }
    groups.get(dateStr)!.push(m);
  }

  return order.map((dateStr) => {
    const d = new Date(dateStr);
    const label = dateStr === todayStr ? 'Today'
      : dateStr === tomorrowStr ? 'Tomorrow'
      : d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    return { label, meetings: groups.get(dateStr)! };
  });
}

export default function AssistantPanel({
  meetings,
  userEmail,
  botStateMap,
  onScheduled,
  onCancelled,
  onRefresh,
  onClose,
  onSwitchPanel,
}: AssistantPanelProps) {
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // Filter to upcoming meetings with Google Meet links (next 7 days)
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const eligible = meetings.filter((m) => {
    const start = new Date(m.start_time);
    if (start < now || start > weekAhead) return false;
    const meetLink = m.meeting_link ?? '';
    return meetLink.includes('meet.google.com');
  });

  const groups = groupByDate(eligible);

  const handleSchedule = async (eventId: string) => {
    setLoadingIds((prev) => new Set(prev).add(eventId));
    try {
      const res = await fetch(`/api/meetings/${eventId}/schedule-bot`, { method: 'POST' });
      if (res.ok) onScheduled(eventId);
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(eventId); return next; });
      onRefresh?.();
    }
  };

  const handleCancel = async (eventId: string) => {
    setLoadingIds((prev) => new Set(prev).add(eventId));
    try {
      const res = await fetch(`/api/meetings/${eventId}/cancel-bot`, { method: 'DELETE' });
      if (res.ok) onCancelled(eventId);
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(eventId); return next; });
      onRefresh?.();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-neutral-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ComputerDesktopIcon className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-[12px] font-semibold text-neutral-700">Meeting Assistants</span>
        </div>
        <div className="flex items-center gap-1">
          {onSwitchPanel && (
            <button onClick={onSwitchPanel} title="AI Chat" className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
              <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {eligible.length === 0 ? (
          <div className="text-center py-8">
            <ComputerDesktopIcon className="w-6 h-6 text-neutral-300 mx-auto mb-2" />
            <p className="text-[12px] text-neutral-400">No Google Meet calls in the next 7 days</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 px-1">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.meetings.map((m) => {
                    const effectiveState = botStateMap.get(m.id) ?? m.attendee_bot_state ?? null;
                    const info = getBotStateInfo(effectiveState);
                    const isLoading = loadingIds.has(m.id);

                    return (
                      <div
                        key={m.id}
                        className="px-2 py-2 rounded-lg hover:bg-neutral-50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-neutral-800 truncate leading-tight">
                              {m.title}
                            </p>
                            <p className="text-[10px] text-neutral-400 mt-0.5">
                              {formatTime(m.start_time)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {info && (
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${info.className}`}>
                                {info.label}
                              </span>
                            )}
                          </div>
                        </div>
                        {info?.action && (
                          <button
                            onClick={() => info.action === 'schedule' ? handleSchedule(m.id) : handleCancel(m.id)}
                            disabled={isLoading}
                            className={`mt-1.5 w-full py-1 text-[11px] font-medium rounded transition-colors disabled:opacity-50 ${
                              info.action === 'schedule'
                                ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                : 'text-neutral-500 bg-neutral-50 hover:bg-neutral-100'
                            }`}
                          >
                            {isLoading
                              ? 'Working…'
                              : info.action === 'schedule'
                              ? 'Send assistant'
                              : 'Cancel assistant'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
