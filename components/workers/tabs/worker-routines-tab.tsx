'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BoltIcon,
  PlayIcon,
  PauseIcon,
  ClockIcon,
  CheckCircleIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';

interface Routine {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused';
  trigger: {
    type: 'schedule' | 'manual';
    cron?: string;
    timezone?: string;
    label?: string;
  };
  last_run_at: string | null;
  next_run_at: string | null;
  agent_id: string | null;
}

function scheduleLabel(routine: Routine): string {
  if (routine.trigger.type === 'manual') return 'Manual trigger';
  if (routine.trigger.label) return routine.trigger.label;
  if (routine.trigger.cron) return routine.trigger.cron;
  return 'Scheduled';
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never run';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function upcomingTime(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'Overdue';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `next in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `next in ${hours}h`;
  return `next in ${Math.floor(hours / 24)}d`;
}

interface WorkerRoutinesTabProps {
  workerId: string;
  workerName: string;
  onOpenInChat: (threadId: string) => void;
}

export function WorkerRoutinesTab({ workerId, workerName, onOpenInChat }: WorkerRoutinesTabProps) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    fetch(`/api/workflows?agent_id=${workerId}`)
      .then(r => r.json())
      .then(data => { setRoutines(data.workflows ?? []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, [workerId]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(routine: Routine) {
    if (togglingId) return;
    const next = routine.status === 'active' ? 'paused' : 'active';
    setRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, status: next } : r));
    setTogglingId(routine.id);
    try {
      await fetch(`/api/workflows/${routine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      setRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, status: routine.status } : r));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleOpenLatestRun(routineId: string) {
    if (openingId) return;
    setOpeningId(routineId);
    try {
      const res = await fetch(`/api/workflows/${routineId}/runs?limit=1`);
      if (!res.ok) return;
      const { runs } = await res.json();
      const threadId = runs?.[0]?.thread_id;
      if (threadId) onOpenInChat(threadId);
    } finally {
      setOpeningId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 p-6 space-y-3 animate-pulse">
        {[1, 2].map(i => <div key={i} className="h-16 bg-neutral-100 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-[13px] font-semibold text-neutral-800">Routines</h2>
            <p className="text-[11.5px] text-neutral-400 mt-0.5">
              Scheduled tasks {workerName} runs automatically
            </p>
          </div>
        </div>

        {routines.length === 0 ? (
          <EmptyRoutines workerName={workerName} workerId={workerId} />
        ) : (
          <div className="rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
            {routines.map(routine => (
              <RoutineRow
                key={routine.id}
                routine={routine}
                isToggling={togglingId === routine.id}
                isOpening={openingId === routine.id}
                onToggle={() => handleToggle(routine)}
                onOpenLatestRun={() => handleOpenLatestRun(routine.id)}
              />
            ))}
          </div>
        )}

        {/* Power-user escape hatch */}
        <p className="mt-5 text-center text-[11px] text-neutral-400">
          Want to configure a routine manually?{' '}
          <Link href={`/studio?assign_worker=${workerId}`} className="text-neutral-500 hover:text-indigo-600 underline underline-offset-2 transition-colors">
            Open in Studio
          </Link>
        </p>

      </div>
    </div>
  );
}

// ─── Routine row ──────────────────────────────────────────────────────────────

interface RoutineRowProps {
  routine: Routine;
  isToggling: boolean;
  isOpening: boolean;
  onToggle: () => void;
  onOpenLatestRun: () => void;
}

function RoutineRow({ routine, isToggling, isOpening, onToggle, onOpenLatestRun }: RoutineRowProps) {
  const isActive = routine.status === 'active';
  const isDraft = routine.status === 'draft';
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50 transition-colors group relative">
      {/* Status dot */}
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
        isActive ? 'bg-emerald-400' : 'bg-neutral-300'
      }`} />

      {/* Info — clicking opens latest run output */}
      <button
        className="min-w-0 flex-1 text-left"
        onClick={onOpenLatestRun}
        disabled={isOpening}
      >
        <p className={`text-[13px] font-medium truncate transition-colors ${
          isOpening ? 'text-neutral-400' : 'text-neutral-700 group-hover:text-indigo-600'
        }`}>
          {isOpening ? 'Opening…' : routine.name}
        </p>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="flex items-center gap-1 text-[11px] text-neutral-400">
            <ClockIcon className="w-3 h-3" />
            {scheduleLabel(routine)}
          </span>
          {routine.last_run_at && (
            <span className="flex items-center gap-1 text-[11px] text-neutral-400">
              <CheckCircleIcon className="w-3 h-3" />
              {relativeTime(routine.last_run_at)}
            </span>
          )}
          {isActive && routine.next_run_at && (
            <span className="text-[11px] text-neutral-400">
              {upcomingTime(routine.next_run_at)}
            </span>
          )}
          {isDraft && (
            <span className="text-[10.5px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded-full">
              Draft
            </span>
          )}
        </div>
      </button>

      {/* Controls — visible on hover */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {/* Pause / resume */}
        {!isDraft && (
          <button
            onClick={onToggle}
            disabled={isToggling}
            title={isActive ? 'Pause' : 'Resume'}
            className={`p-1.5 rounded-lg transition-colors ${
              isActive
                ? 'text-neutral-400 hover:text-amber-500 hover:bg-amber-50'
                : 'text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50'
            } disabled:opacity-40`}
          >
            {isActive ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* ··· overflow → Studio links */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(v => !v)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            title="More options"
          >
            <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-lg border border-neutral-200 py-1 z-20 text-[12.5px]">
                <Link
                  href={`/studio/${routine.id}`}
                  className="flex items-center px-3 py-2 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
                  onClick={() => setShowMenu(false)}
                >
                  View in Studio
                </Link>
                <Link
                  href={`/studio/${routine.id}/edit`}
                  className="flex items-center px-3 py-2 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
                  onClick={() => setShowMenu(false)}
                >
                  Edit pipeline
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyRoutines({ workerName, workerId }: { workerName: string; workerId: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-200 px-6 py-12 text-center">
      <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-4">
        <BoltIcon className="w-5 h-5 text-neutral-400" />
      </div>
      <p className="text-[13px] font-medium text-neutral-700 mb-2">No routines running yet</p>
      <p className="text-[12.5px] text-neutral-400 max-w-[320px] mx-auto leading-relaxed">
        Tell {workerName} what you want done automatically — a morning briefing, a weekly digest, a report before every client meeting. {workerName} will set it up.
      </p>
      <p className="mt-5 text-[11px] text-neutral-400">
        Prefer to configure it manually?{' '}
        <Link href={`/studio?assign_worker=${workerId}`} className="text-neutral-500 hover:text-indigo-600 underline underline-offset-2 transition-colors">
          Open Studio
        </Link>
      </p>
    </div>
  );
}
