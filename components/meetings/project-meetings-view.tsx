'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FolderOpenIcon,
  SparklesIcon,
  ArrowTopRightOnSquareIcon,
  MicrophoneIcon,
  DocumentTextIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { Badge, Button, SegmentedControl, EmptyState } from '@/components/ui';
import type { Transcript } from '@/context/meetings-data-context';

interface ProjectMeetingsViewProps {
  // A tracked project (filter by project_id) OR a suggested initiative (filter by an explicit id set).
  project?: { id: string; name: string };
  suggestion?: { key: string; name: string; meetingIds: string[]; onTrack: () => void; tracking?: boolean };
  transcripts: Transcript[];
  isNew: (t: Transcript) => boolean;
}

type CaptureFilter = 'all' | 'recordings' | 'notes';

const ATTENDEE_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
];

function attendeeColor(key: string): string {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return ATTENDEE_COLORS[hash % ATTENDEE_COLORS.length];
}

function getInitialsFn(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

function AttendeeAvatars({ attendees }: { attendees: Array<{ email: string; name?: string }> }) {
  if (!attendees.length) return null;
  const shown = attendees.slice(0, 5);
  const extra = attendees.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((a, i) => (
        <div
          key={i}
          title={a.name ?? a.email}
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-2 ring-white ${attendeeColor(a.email ?? String(i))}`}
        >
          {getInitialsFn(a.name, a.email)}
        </div>
      ))}
      {extra > 0 && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-2 ring-white bg-neutral-100 text-neutral-500">
          +{extra}
        </div>
      )}
    </div>
  );
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'recording' || source === 'bot' || source === 'upload') {
    return <MicrophoneIcon className="w-4 h-4 text-red-400" />;
  }
  return <DocumentTextIcon className="w-4 h-4 text-blue-400" />;
}

function SourceBadge({ source }: { source: string }) {
  if (source === 'recording' || source === 'bot' || source === 'upload') {
    return (
      <Badge tone="emerald" className="flex-shrink-0">
        <MicrophoneIcon className="w-2.5 h-2.5" />
        Recorded
      </Badge>
    );
  }
  return (
    <Badge tone="blue" className="flex-shrink-0">
      <DocumentTextIcon className="w-2.5 h-2.5" />
      Note
    </Badge>
  );
}

function groupByDate(items: Transcript[]): Array<{ label: string; items: Transcript[] }> {
  const groups = new Map<string, Transcript[]>();
  const order: string[] = [];
  for (const item of items) {
    const label = new Date(item.startTime).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!groups.has(label)) { groups.set(label, []); order.push(label); }
    groups.get(label)!.push(item);
  }
  return order.map((label) => ({ label, items: groups.get(label)! }));
}

// The meetings-scoped lens onto a PROJECT — just the project's meetings (filing/browsing). The full
// cross-artifact project experience (goals, rules, tasks, AI) lives in ONE place: the Home Projects lens,
// reached via "Open project →". Same project identity + membership, so the two feel like one thing.
export default function ProjectMeetingsView({ project, suggestion, transcripts, isNew }: ProjectMeetingsViewProps) {
  const [captureFilter, setCaptureFilter] = useState<CaptureFilter>('all');

  const name = project?.name ?? suggestion?.name ?? '';
  const isSuggested = !!suggestion;
  const memberSet = useMemo(() => (suggestion ? new Set(suggestion.meetingIds) : null), [suggestion]);

  const allProjectTranscripts = useMemo(() =>
    transcripts
      .filter((t) => t.processed && t.botState !== 'failed' &&
        (memberSet ? memberSet.has(t.id) : t.projectId === project?.id))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [transcripts, project?.id, memberSet]
  );

  const projectTranscripts = useMemo(() => {
    if (captureFilter === 'recordings') return allProjectTranscripts.filter((t) => t.source === 'recording' || t.source === 'bot' || t.source === 'upload');
    if (captureFilter === 'notes') return allProjectTranscripts.filter((t) => t.source === 'text');
    return allProjectTranscripts;
  }, [allProjectTranscripts, captureFilter]);

  const dateGroups = groupByDate(projectTranscripts);

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            {isSuggested ? <SparklesIcon className="w-5 h-5 text-amber-500" /> : <FolderOpenIcon className="w-5 h-5 text-indigo-500" />}
            <h1 className="text-lg font-semibold text-neutral-900">{name}</h1>
            {isSuggested && <Badge tone="amber">Suggested</Badge>}
          </div>
          {isSuggested ? (
            <Button size="sm" onClick={suggestion!.onTrack} disabled={suggestion!.tracking}>
              <SparklesIcon className="w-3.5 h-3.5" />
              {suggestion!.tracking ? 'Tracking…' : 'Track as project'}
            </Button>
          ) : (
            <Link
              href={`/?view=projects&project=${project!.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-[12px] font-medium text-neutral-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              Open project
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
        <p className="text-[12px] text-neutral-500">
          {isSuggested
            ? `${allProjectTranscripts.length} meeting${allProjectTranscripts.length !== 1 ? 's' : ''} · track to group emails, tasks & notes together`
            : `${allProjectTranscripts.length} meeting${allProjectTranscripts.length !== 1 ? 's' : ''} in this project`}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex-shrink-0 px-6 mb-3">
        <SegmentedControl<CaptureFilter>
          className="inline-flex"
          items={[
            { value: 'all', label: 'All' },
            { value: 'recordings', label: 'Recordings' },
            { value: 'notes', label: 'Notes' },
          ]}
          value={captureFilter}
          onChange={setCaptureFilter}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {projectTranscripts.length === 0 && (
          <EmptyState
            icon={FolderOpenIcon}
            title="No meetings in this project yet"
            description="Drag meetings here from the home list, or add one from a meeting's project control."
          />
        )}
        {dateGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">{group.label}</p>
            {group.items.map((t) => {
              const href = t.calendarEventId ? `/meetings/${t.calendarEventId}` : `/meetings/recording/${t.id}`;
              return (
                <Link key={t.id} href={href}>
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer mb-0.5">
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <SourceIcon source={t.source} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-medium text-neutral-800 truncate">{t.title}</p>
                        {isNew(t) && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <SourceBadge source={t.source} />
                        {t.sharingMode && !t.isSharedWithMe && (
                          <Badge tone="indigo" className="flex-shrink-0"><UsersIcon className="w-2.5 h-2.5" />Shared</Badge>
                        )}
                        {t.isSharedWithMe && (
                          <Badge tone="neutral" className="flex-shrink-0"><UsersIcon className="w-2.5 h-2.5" />{t.sharedByName ? `from ${t.sharedByName.split(' ')[0]}` : 'Shared'}</Badge>
                        )}
                        {(t.attendees?.length ?? 0) > 0 && <AttendeeAvatars attendees={t.attendees!} />}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-[11px] text-neutral-400">
                        {new Date(t.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {t.workItemsGenerated > 0 && (
                        <p className="text-[10px] text-blue-500 font-medium">{t.workItemsGenerated} items</p>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
