'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChatBubbleLeftIcon, BoltIcon, ArrowRightIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon, ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatEntry {
  kind: 'chat';
  threadId: string;
  title: string;
  timestamp: string;
}

interface RoutineEntry {
  kind: 'routine';
  routineId: string;
  routineName: string;
  runStatus: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  triggeredBy: string;
  threadId: string | null;
  timestamp: string;
}

type HeartbeatEntry = ChatEntry | RoutineEntry;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function RunStatusChip({ status }: { status: RoutineEntry['runStatus'] }) {
  if (status === 'succeeded') return (
    <span className="flex items-center gap-1 text-[10.5px] text-emerald-600">
      <CheckCircleIcon className="w-3 h-3" /> Completed
    </span>
  );
  if (status === 'failed') return (
    <span className="flex items-center gap-1 text-[10.5px] text-red-500">
      <ExclamationCircleIcon className="w-3 h-3" /> Failed
    </span>
  );
  if (status === 'running' || status === 'queued') return (
    <span className="flex items-center gap-1 text-[10.5px] text-indigo-500">
      <ClockIcon className="w-3 h-3" /> Running
    </span>
  );
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface WorkerActivityTabProps {
  workerId: string;
  workerName: string;
  onOpenInChat: (threadId: string) => void;
}

export function WorkerActivityTab({ workerId, workerName, onOpenInChat }: WorkerActivityTabProps) {
  const [entries, setEntries] = useState<HeartbeatEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch chat threads and routines in parallel
      const [threadsRes, routinesRes] = await Promise.all([
        fetch(`/api/work/threads?agent_id=${workerId}`),
        fetch(`/api/workflows?agent_id=${workerId}`),
      ]);

      const [threadsData, routinesData] = await Promise.all([
        threadsRes.ok ? threadsRes.json() : { threads: [] },
        routinesRes.ok ? routinesRes.json() : { workflows: [] },
      ]);

      const chatThreads: ChatEntry[] = (threadsData.threads ?? []).map((t: { id: string; title: string; updated_at: string }) => ({
        kind: 'chat' as const,
        threadId: t.id,
        title: t.title,
        timestamp: t.updated_at,
      }));

      // Fetch recent runs for each routine (up to 5 routines, 3 runs each)
      const routines: Array<{ id: string; name: string }> = (routinesData.workflows ?? []).slice(0, 5);
      const routineEntries: RoutineEntry[] = [];

      if (routines.length > 0) {
        const runResults = await Promise.all(
          routines.map(r =>
            fetch(`/api/workflows/${r.id}/runs?limit=3`)
              .then(res => res.ok ? res.json() : { runs: [] })
              .then(data => ({ routineId: r.id, routineName: r.name, runs: data.runs ?? [] }))
              .catch(() => ({ routineId: r.id, routineName: r.name, runs: [] }))
          )
        );

        for (const { routineId, routineName, runs } of runResults) {
          for (const run of runs) {
            routineEntries.push({
              kind: 'routine',
              routineId,
              routineName,
              runStatus: run.status,
              triggeredBy: run.triggered_by,
              threadId: run.thread_id ?? null,
              timestamp: run.completed_at ?? run.started_at ?? run.created_at,
            });
          }
        }
      }

      // Merge and sort by timestamp descending
      const all: HeartbeatEntry[] = [...chatThreads, ...routineEntries].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setEntries(all);
    } finally {
      setIsLoading(false);
    }
  }, [workerId]);

  useEffect(() => { load(); }, [load]);

  async function handleClear() {
    if (clearing) return;
    setClearing(true);
    setConfirmingClear(false);
    try {
      await fetch(`/api/workers/${workerId}/activity`, { method: 'DELETE' });
      await load();
    } finally { setClearing(false); }
  }

  if (isLoading) {
    return (
      <div className="flex-1 px-8 py-8 space-y-4 animate-pulse">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex gap-3 items-start">
            <div className="w-7 h-7 rounded-lg bg-neutral-100 flex-shrink-0" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <div className="h-3 bg-neutral-100 rounded w-2/3" />
              <div className="h-2.5 bg-neutral-100 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <p className="text-[13px] text-neutral-500 font-medium">Nothing yet</p>
        <p className="text-[12px] text-neutral-400 text-center max-w-[280px]">
          {workerName}&apos;s activity — conversations, routine runs, and actions — will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Activity
          </h2>
          {confirmingClear ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11.5px] text-neutral-500">Clear run history?</span>
              <button onClick={handleClear} disabled={clearing}
                className="px-2 py-1 rounded-lg text-[11.5px] font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40">
                {clearing ? 'Clearing…' : 'Clear'}
              </button>
              <button onClick={() => setConfirmingClear(false)}
                className="px-2 py-1 rounded-lg text-[11.5px] text-neutral-500 hover:bg-neutral-100 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={load} title="Refresh"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors">
                <ArrowPathIcon className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setConfirmingClear(true)} title="Clear activity"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[13px] top-0 bottom-0 w-px bg-neutral-100" />

          <div className="space-y-1 rise-in-stagger">
            {entries.map((entry, i) => (
              entry.kind === 'chat'
                ? <ChatEntryRow key={`chat-${entry.threadId}-${i}`} entry={entry} onOpen={() => onOpenInChat(entry.threadId)} />
                : <RoutineEntryRow key={`routine-${entry.routineId}-${i}`} entry={entry} onOpen={entry.threadId ? () => onOpenInChat(entry.threadId!) : undefined} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Chat entry row ───────────────────────────────────────────────────────────

function ChatEntryRow({ entry, onOpen }: { entry: ChatEntry; onOpen: () => void }) {
  return (
    <div className="group flex items-start gap-3 py-3 pl-1 pr-0">
      {/* Icon dot */}
      <div className="w-6 h-6 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0 mt-0.5 z-10">
        <ChatBubbleLeftIcon className="w-3 h-3 text-neutral-400" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-neutral-700 leading-snug truncate">{entry.title}</p>
        <p className="text-[11px] text-neutral-400 mt-0.5">{relativeTime(entry.timestamp)}</p>
      </div>

      {/* Open button */}
      <button
        onClick={onOpen}
        className="flex items-center gap-1 text-[11.5px] text-neutral-400 hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5"
      >
        Open <ArrowRightIcon className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Routine entry row ────────────────────────────────────────────────────────

function RoutineEntryRow({ entry, onOpen }: { entry: RoutineEntry; onOpen?: () => void }) {
  const canOpen = !!onOpen;

  return (
    <div className="group flex items-start gap-3 py-3 pl-1 pr-0">
      {/* Icon dot */}
      <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 z-10 ${
        entry.runStatus === 'succeeded' ? 'bg-emerald-50' :
        entry.runStatus === 'failed' ? 'bg-red-50' :
        'bg-indigo-50'
      }`}>
        <BoltIcon className={`w-3 h-3 ${
          entry.runStatus === 'succeeded' ? 'text-emerald-500' :
          entry.runStatus === 'failed' ? 'text-red-400' :
          'text-indigo-400'
        }`} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] text-neutral-700 leading-snug truncate">{entry.routineName}</p>
          <RunStatusChip status={entry.runStatus} />
        </div>
        <p className="text-[11px] text-neutral-400 mt-0.5">
          {entry.triggeredBy === 'schedule' ? 'Scheduled run' : 'Manual run'} · {relativeTime(entry.timestamp)}
        </p>
      </div>

      {/* Open output button */}
      {canOpen && (
        <button
          onClick={onOpen}
          className="flex items-center gap-1 text-[11.5px] text-neutral-400 hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5"
        >
          Open output <ArrowRightIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
