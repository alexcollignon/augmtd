'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';

interface LinkedWork {
  processes: Array<{ id: string; title: string; status: string; score: number }>;
  threads: Array<{ id: string; title: string; score: number }>;
  files: Array<{ id: string; filename: string; score: number }>;
  priorMeetings: Array<{ id: string; title: string; start_time: string; calendarEventId: string | null; score: number }>;
}

interface LinkedWorkPanelProps {
  calendarEventId: string;
}

export default function LinkedWorkPanel({ calendarEventId }: LinkedWorkPanelProps) {
  const [data, setData] = useState<LinkedWork | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/meetings/${calendarEventId}/linked-work`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ processes: [], threads: [], files: [], priorMeetings: [] }))
      .finally(() => setLoading(false));
  }, [calendarEventId]);

  const hasAny =
    data &&
    (data.processes.length > 0 || data.threads.length > 0 || data.files.length > 0 || data.priorMeetings.length > 0);

  return (
    <div className="space-y-5">
      <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Linked Work</h3>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-neutral-100 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && !hasAny && (
        <p className="text-[12px] text-neutral-400 italic">No linked work found based on meeting title.</p>
      )}

      {!loading && data && (
        <div className="space-y-4">
          {data.processes.length > 0 && (
            <Section title="Processes" icon={<ArrowPathIcon className="w-3.5 h-3.5" />}>
              {data.processes.map((p) => (
                <LinkedItem
                  key={p.id}
                  href={`/processes/${p.id}`}
                  title={p.title}
                  meta={p.status}
                  score={p.score}
                />
              ))}
            </Section>
          )}

          {data.threads.length > 0 && (
            <Section title="Inbox threads" icon={<ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />}>
              {data.threads.map((t) => (
                <LinkedItem
                  key={t.id}
                  href={`/work?thread=${t.id}`}
                  title={t.title}
                  score={t.score}
                />
              ))}
            </Section>
          )}

          {data.files.length > 0 && (
            <Section title="Drive files" icon={<DocumentTextIcon className="w-3.5 h-3.5" />}>
              {data.files.map((f) => (
                <LinkedItem
                  key={f.id}
                  href={`/drive`}
                  title={f.filename}
                  score={f.score}
                />
              ))}
            </Section>
          )}

          {data.priorMeetings.length > 0 && (
            <Section title="Prior meetings" icon={<CalendarDaysIcon className="w-3.5 h-3.5" />}>
              {data.priorMeetings.map((m) => (
                <LinkedItem
                  key={m.id}
                  href={m.calendarEventId ? `/meetings/${m.calendarEventId}` : `/meetings`}
                  title={m.title}
                  meta={new Date(m.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  score={m.score}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function LinkedItem({ href, title, meta, score }: { href: string; title: string; meta?: string; score: number }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 px-3 py-2 bg-neutral-50 hover:bg-neutral-100 transition-colors group"
    >
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-neutral-800 truncate group-hover:text-indigo-700 transition-colors">
          {title}
        </p>
        {meta && <p className="text-[10px] text-neutral-400 capitalize">{meta}</p>}
      </div>
      <span className="flex-shrink-0 text-[10px] font-semibold text-neutral-400">{score}%</span>
    </Link>
  );
}
