'use client';

import { useEffect, useState } from 'react';
import { MicrophoneIcon } from '@heroicons/react/24/outline';
import type { CalendarEvent } from '@/lib/types/meetings';
import UpcomingMeetingCard from '@/components/meetings/upcoming-meeting-card';
import TranscriptListCard from '@/components/meetings/transcript-list-card';
import CaptureModal from '@/components/meetings/capture-modal';
import MonthCalendar from '@/components/meetings/month-calendar';

interface Transcript {
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
}

function mapTranscripts(raw: any[]): Transcript[] {
  return raw.map((t) => ({
    id: t.id,
    calendarEventId: t.calendar_event_id,
    title: t.title,
    startTime: t.start_time,
    durationMinutes: t.duration_minutes,
    workItemsGenerated: t.work_items_generated,
    processed: t.processed,
    botState: t.bot_state ?? null,
    source: t.source,
    summary: t.summary,
  }));
}

export default function MeetingsPageClient({ userEmail }: { userEmail: string }) {
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCapture, setShowCapture] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState(() => new Date().toDateString());

  useEffect(() => {
    Promise.all([
      fetch('/api/meetings').then((r) => r.json()),
      fetch('/api/meetings/transcripts').then((r) => r.json()),
    ])
      .then(([meetingsData, transcriptsData]) => {
        const upcomingEvents = (meetingsData.meetings ?? []).filter(
          (m: CalendarEvent) => m.meeting_status !== 'completed'
        );
        setUpcoming(upcomingEvents);
        setTranscripts(mapTranscripts(transcriptsData.transcripts ?? []));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const processingList = transcripts.filter((t) => !t.processed);
  const failedList = transcripts.filter((t) => t.processed && t.botState === 'failed');
  const needsReviewList = transcripts.filter((t) => t.processed && t.botState !== 'failed' && t.workItemsGenerated === 0);
  const recentList = transcripts.filter((t) => t.processed && t.botState !== 'failed' && t.workItemsGenerated > 0).slice(0, 10);

  // Always poll every 10s so new recordings appear without a manual reload
  useEffect(() => {
    const fetchTranscripts = () => {
      fetch('/api/meetings/transcripts')
        .then((r) => r.json())
        .then((data) => setTranscripts(mapTranscripts(data.transcripts ?? [])))
        .catch(() => {});
    };
    const interval = setInterval(fetchTranscripts, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Meetings</h1>
          <p className="text-[13px] text-neutral-500 mt-0.5">Capture, search, and turn conversations into actions and processes</p>
        </div>
        <button
          onClick={() => setShowCapture(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
        >
          <MicrophoneIcon className="w-4 h-4" />
          Capture meeting
        </button>
      </div>


      {/* Upcoming meetings — 2-column: calendar left, day list right */}
      <section className="mb-8">
        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">
          Upcoming meetings
        </h2>
        {loading ? (
          <div className="grid grid-cols-[260px_1fr] gap-6">
            <div className="space-y-1">{[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-neutral-100 animate-pulse rounded" />)}</div>
            <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-20 bg-neutral-100 animate-pulse" />)}</div>
          </div>
        ) : (
          <div className="grid grid-cols-[260px_1fr] gap-6 items-start">
            {/* Left: month calendar */}
            <div className="bg-white border border-neutral-100 px-4 py-4">
              <MonthCalendar
                meetings={upcoming}
                userEmail={userEmail}
                selectedDateStr={selectedDateStr}
                onSelectDate={setSelectedDateStr}
              />
            </div>

            {/* Right: meetings for selected day */}
            <div>
              <p className="text-[12px] font-semibold text-neutral-600 mb-3">
                {new Date(selectedDateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              {(() => {
                const dayMeetings = upcoming.filter(
                  (e) => new Date(e.start_time).toDateString() === selectedDateStr
                );
                if (dayMeetings.length === 0) {
                  return <p className="text-[13px] text-neutral-400 italic py-4">No upcoming meetings this day.</p>;
                }
                return (
                  <div className="space-y-2">
                    {dayMeetings.map((event) => (
                      <UpcomingMeetingCard key={event.id} event={event} />
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </section>

      {/* Processing */}
      {processingList.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
            Transcribing ({processingList.length})
          </h2>
          <div className="space-y-1.5">
            {processingList.map((t) => (
              <TranscriptListCard key={t.id} {...t} />
            ))}
          </div>
        </section>
      )}

      {/* Failed */}
      {failedList.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-3">
            Transcription failed ({failedList.length})
          </h2>
          <div className="space-y-1.5">
            {failedList.map((t) => (
              <TranscriptListCard key={t.id} {...t} />
            ))}
          </div>
        </section>
      )}

      {/* Needs review */}
      {needsReviewList.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-3">
            Needs review ({needsReviewList.length})
          </h2>
          <div className="space-y-1.5">
            {needsReviewList.map((t) => (
              <TranscriptListCard key={t.id} {...t} />
            ))}
          </div>
        </section>
      )}

      {/* Recent meetings */}
      <section>
        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">
          Recent meetings
        </h2>
        {loading && (
          <div className="space-y-1.5">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-neutral-100 animate-pulse" />)}
          </div>
        )}
        {!loading && recentList.length === 0 && (
          <div className="py-8 text-center border border-dashed border-neutral-200">
            <MicrophoneIcon className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
            <p className="text-[13px] text-neutral-500 font-medium">No recordings yet</p>
            <p className="text-[12px] text-neutral-400 mt-1">
              Use the Capture button to record your first in-person meeting.
            </p>
            <button
              onClick={() => setShowCapture(true)}
              className="inline-block mt-3 px-4 py-1.5 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors"
            >
              Start recording
            </button>
          </div>
        )}
        {!loading && recentList.length > 0 && (
          <div className="space-y-1.5">
            {recentList.map((t) => (
              <TranscriptListCard key={t.id} {...t} />
            ))}
          </div>
        )}
      </section>

      <CaptureModal isOpen={showCapture} onClose={() => setShowCapture(false)} />
    </div>
  );
}

