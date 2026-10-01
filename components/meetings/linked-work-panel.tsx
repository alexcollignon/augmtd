'use client';

import { useEffect, useState } from 'react';
import { useUserZone } from '@/context/user-zone-context';
import { dateIn } from '@/lib/core/user-zone';
import Link from 'next/link';
import {
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';

interface LinkedWork {
  // W39 · the words each row shares with the meeting's title (said in plain words — never a bare %).
  threads: Array<{ id: string; title: string; shared?: string[] }>;
  files: Array<{ id: string; filename: string; shared?: string[] }>;
  priorMeetings: Array<{ id: string; title: string; start_time: string; calendarEventId: string | null; shared?: string[] }>;
}

interface LinkedWorkPanelProps {
  calendarEventId: string;
}

export default function LinkedWorkPanel({ calendarEventId }: LinkedWorkPanelProps) {
  const zone = useUserZone();
  const [data, setData] = useState<LinkedWork | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/meetings/${calendarEventId}/linked-work`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ threads: [], files: [], priorMeetings: [] }))
      .finally(() => setLoading(false));
  }, [calendarEventId]);

  const hasAny =
    data &&
    (data.threads.length > 0 || data.files.length > 0 || data.priorMeetings.length > 0);

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
          {data.threads.length > 0 && (
            <Section title="Inbox threads" icon={<ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />}>
              {data.threads.map((t) => (
                <LinkedItem
                  key={t.id}
                  href={`/work?thread=${t.id}`}
                  title={t.title}
                  shared={t.shared}
                />
              ))}
            </Section>
          )}

          {data.files.length > 0 && (
            <Section title="Drive files" icon={<DocumentTextIcon className="w-3.5 h-3.5" />}>
              {data.files.map((f) => (
                <LinkedItem
                  key={f.id}
                  href="/documents"
                  title={f.filename}
                  shared={f.shared}
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
                  meta={dateIn(m.start_time, zone, { day: 'numeric', month: 'short' }, 'en-GB')}
                  shared={m.shared}
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

/** WHY THIS ROW IS HERE, in plain words (W39 — the walk's unexplained "33%"): the words its name
 *  shares with the meeting's title. Exported pure for the gate. */
export function sharedWordsLine(shared: string[] | null | undefined): string | null {
  const w = (shared ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (!w.length) return null;
  const quoted = w.map((x) => `“${x.toLowerCase()}”`);
  const list = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  return `Shares ${list} with this meeting’s title`;
}

function LinkedItem({ href, title, meta, shared }: { href: string; title: string; meta?: string; shared?: string[] }) {
  const why = sharedWordsLine(shared);
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
        {why && <p className="text-[10px] text-neutral-400 truncate">{why}</p>}
      </div>
    </Link>
  );
}
