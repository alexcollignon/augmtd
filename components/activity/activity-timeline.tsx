'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClockIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
  BellAlertIcon,
  ClipboardDocumentCheckIcon,
  ArchiveBoxXMarkIcon,
  SpeakerXMarkIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { EmptyState, Button } from '@/components/ui';

export interface ActivityEvent {
  id: string;
  type: string;
  title: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── Type → icon + accent ─────────────────────────────────────────────────────
const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; ring: string; text: string }> = {
  reply_sent:            { icon: PaperAirplaneIcon,           ring: 'bg-indigo-50 ring-indigo-100',   text: 'text-indigo-500' },
  marked_done:           { icon: CheckCircleIcon,             ring: 'bg-emerald-50 ring-emerald-100', text: 'text-emerald-500' },
  dismissed:             { icon: XCircleIcon,                 ring: 'bg-neutral-100 ring-neutral-200', text: 'text-neutral-400' },
  nudge_sent:            { icon: BellAlertIcon,               ring: 'bg-amber-50 ring-amber-100',     text: 'text-amber-500' },
  commitment_done:       { icon: ClipboardDocumentCheckIcon,  ring: 'bg-emerald-50 ring-emerald-100', text: 'text-emerald-500' },
  commitment_dismissed:  { icon: ArchiveBoxXMarkIcon,         ring: 'bg-neutral-100 ring-neutral-200', text: 'text-neutral-400' },
  sender_muted:          { icon: SpeakerXMarkIcon,            ring: 'bg-neutral-100 ring-neutral-200', text: 'text-neutral-400' },
};
const DEFAULT_META = { icon: BoltIcon, ring: 'bg-indigo-50 ring-indigo-100', text: 'text-indigo-500' };

// ─── Date grouping ────────────────────────────────────────────────────────────
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ─── ActivityTimeline ─────────────────────────────────────────────────────────
// The chronological activity log (grouped by date), reusable across surfaces.
// Fetches its own data from GET /api/activity on mount — mount it only when it's
// shown (e.g. keyed to the drawer's open state) to keep the fetch lazy.
export default function ActivityTimeline() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Initial load — happens on mount (when the caller mounts the component only
  // on first open, `lazy` naturally defers the fetch to that first render).
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/activity?limit=100')
      .then((r) => (r.ok ? r.json() : { events: [], hasMore: false }))
      .then((json) => {
        if (cancelled) return;
        setEvents(json.events || []);
        setHasMore(!!json.hasMore);
      })
      .catch(() => { if (!cancelled) { setEvents([]); setHasMore(false); } })
      .finally(() => { if (!cancelled) { setLoading(false); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [loaded]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || events.length === 0) return;
    setLoading(true);
    try {
      const cursor = events[events.length - 1].created_at;
      const res = await fetch(`/api/activity?before=${encodeURIComponent(cursor)}&limit=100`);
      if (res.ok) {
        const json = await res.json();
        setEvents((prev) => [...prev, ...(json.events || [])]);
        setHasMore(!!json.hasMore);
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, events]);

  // Group into ordered date buckets (events already sorted most-recent first).
  const groups = useMemo(() => {
    const out: { label: string; items: ActivityEvent[] }[] = [];
    for (const ev of events) {
      const label = dateLabel(ev.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(ev);
      else out.push({ label, items: [ev] });
    }
    return out;
  }, [events]);

  // First load — small loading state.
  if (!loaded && loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-2 text-neutral-400">
          <ClockIcon className="w-5 h-5 animate-pulse" />
          <span className="text-[12px]">Loading activity…</span>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="No activity yet"
        description="As you reply, mark items done, dismiss, or nudge, your actions will show up here."
        bordered
      />
    );
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-3">
            {group.label}
          </h2>
          {/* Timeline: a left rail with dots */}
          <ol className="relative border-l border-neutral-200 ml-2">
            {group.items.map((ev) => {
              const meta = TYPE_META[ev.type] || DEFAULT_META;
              const Icon = meta.icon;
              return (
                <li key={ev.id} className="relative pl-6 pb-5 last:pb-0">
                  <span
                    className={`absolute -left-[13px] top-0 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white ${meta.ring} ring-inset`}
                    aria-hidden
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full ${meta.ring}`}>
                      <Icon className={`h-3.5 w-3.5 ${meta.text}`} />
                    </span>
                  </span>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] text-neutral-800 leading-snug">{ev.title}</p>
                    <time
                      className="text-[11px] text-neutral-400 tabular-nums whitespace-nowrap pt-0.5"
                      dateTime={ev.created_at}
                      title={new Date(ev.created_at).toLocaleString()}
                    >
                      {clockTime(ev.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
