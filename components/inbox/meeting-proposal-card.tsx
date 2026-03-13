'use client';

import { useState } from 'react';
import { CalendarIcon, ClockIcon, UserGroupIcon, CheckIcon } from '@heroicons/react/24/outline';

interface MeetingSuggestion {
  title: string;
  duration_minutes: number;
  attendees: string[];
  proposed_times: string[];
  notes?: string;
}

interface MeetingProposalCardProps {
  suggestion: MeetingSuggestion;
}

type CardState = 'idle' | 'sending' | 'sent' | 'error';

function formatProposedTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function addMinutes(isoString: string, minutes: number): string {
  try {
    return new Date(new Date(isoString).getTime() + minutes * 60 * 1000).toISOString();
  } catch {
    return isoString;
  }
}

export default function MeetingProposalCard({ suggestion }: MeetingProposalCardProps) {
  const [selectedTime, setSelectedTime] = useState(suggestion.proposed_times[0] ?? '');
  const [state, setState] = useState<CardState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scopeProvider, setScopeProvider] = useState<string | null>(null);

  const handleSend = async () => {
    if (!selectedTime) return;
    setState('sending');
    setErrorMsg(null);
    setScopeProvider(null);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const endTime = addMinutes(selectedTime, suggestion.duration_minutes);

      const res = await fetch('/api/meetings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: suggestion.title,
          startTime: selectedTime,
          endTime,
          timezone,
          attendees: suggestion.attendees,
          notes: suggestion.notes,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data?.error === 'calendar_scope_required') {
          setScopeProvider(data.provider ?? 'calendar');
          setState('error');
          return;
        }
        throw new Error(data?.error ?? 'Unknown error');
      }

      setState('sent');
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to send invitation');
      setState('error');
    }
  };

  return (
    <div className="mt-3 border border-indigo-200 bg-indigo-50 p-4 space-y-3 text-[13px]">
      <div className="flex items-start gap-2">
        <CalendarIcon className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-indigo-900">{suggestion.title}</p>
          {suggestion.notes && (
            <p className="text-indigo-700 mt-0.5">{suggestion.notes}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-indigo-700">
        <ClockIcon className="w-4 h-4 flex-shrink-0" />
        <span>{suggestion.duration_minutes} min</span>
      </div>

      {suggestion.attendees.length > 0 && (
        <div className="flex items-start gap-2 text-indigo-700">
          <UserGroupIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{suggestion.attendees.join(', ')}</span>
        </div>
      )}

      {/* Proposed time chips */}
      {suggestion.proposed_times.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-indigo-600 uppercase tracking-wide font-medium">Proposed times</p>
          <div className="flex flex-wrap gap-2">
            {suggestion.proposed_times.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedTime(t)}
                disabled={state === 'sending' || state === 'sent'}
                className={`px-3 py-1.5 text-[12px] border transition-colors ${
                  selectedTime === t
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'
                }`}
              >
                {formatProposedTime(t)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action area */}
      {state === 'sent' ? (
        <div className="flex items-center gap-1.5 text-green-700 font-medium">
          <CheckIcon className="w-4 h-4" />
          Invitation sent
        </div>
      ) : scopeProvider ? (
        <p className="text-orange-600 text-[12px]">
          Calendar write access needed.{' '}
          <a href="/settings/connections" className="underline hover:text-orange-800">
            Reconnect {scopeProvider === 'gmail' ? 'Google' : 'Outlook'}
          </a>
        </p>
      ) : (
        <div className="space-y-1">
          {state === 'error' && errorMsg && (
            <p className="text-red-600 text-[12px]">{errorMsg}</p>
          )}
          <button
            onClick={handleSend}
            disabled={!selectedTime || state === 'sending'}
            className="px-4 py-1.5 bg-indigo-600 text-white text-[12px] font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {state === 'sending' ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
      )}
    </div>
  );
}
