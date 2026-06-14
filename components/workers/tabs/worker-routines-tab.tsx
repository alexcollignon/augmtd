'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BoltIcon,
  PlusIcon,
  PlayIcon,
  PauseIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';

interface Routine {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
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
  if (routine.trigger.type === 'manual') return 'Manual';
  if (routine.trigger.label) return routine.trigger.label;
  if (routine.trigger.cron) return routine.trigger.cron;
  return 'Scheduled';
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
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
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

interface WorkerRoutinesTabProps {
  workerId: string;
  workerName: string;
}

export function WorkerRoutinesTab({ workerId, workerName }: WorkerRoutinesTabProps) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    fetch(`/api/workflows?agent_id=${workerId}`)
      .then(r => r.json())
      .then(data => {
        setRoutines(data.workflows ?? []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [workerId]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(routine: Routine) {
    if (togglingId) return;
    const next = routine.status === 'active' ? 'paused' : 'active';

    // Optimistic update
    setRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, status: next } : r));
    setTogglingId(routine.id);

    try {
      await fetch(`/api/workflows/${routine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      // Revert on failure
      setRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, status: routine.status } : r));
    } finally {
      setTogglingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 p-6 space-y-3 animate-pulse">
        {[1, 2].map(i => (
          <div key={i} className="h-16 bg-neutral-100 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-6 py-8">

        {/* Header row */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[13px] font-semibold text-neutral-800">Routines</h2>
            <p className="text-[11.5px] text-neutral-400 mt-0.5">
              Scheduled tasks {workerName} runs on your behalf
            </p>
          </div>
          <Link
            href={`/studio?assign_worker=${workerId}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 text-[12px] font-medium hover:bg-indigo-100 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add routine
          </Link>
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
                onToggle={() => handleToggle(routine)}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Routine row ──────────────────────────────────────────────────────────────

interface RoutineRowProps {
  routine: Routine;
  isToggling: boolean;
  onToggle: () => void;
}

function RoutineRow({ routine, isToggling, onToggle }: RoutineRowProps) {
  const isActive = routine.status === 'active';
  const isDraft = routine.status === 'draft';

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50 transition-colors group">
      {/* Icon */}
      <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
        <BoltIcon className="w-4 h-4 text-neutral-400" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/studio/${routine.id}`}
            className="text-[13px] font-medium text-neutral-700 hover:text-indigo-600 truncate transition-colors"
          >
            {routine.name}
          </Link>
          {/* Status pill */}
          {isActive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10.5px] font-medium flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
          )}
          {isDraft && (
            <span className="px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-500 text-[10.5px] font-medium flex-shrink-0">
              Draft
            </span>
          )}
        </div>

        {/* Schedule + run info */}
        <div className="flex items-center gap-3 mt-0.5">
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
            <span className="flex items-center gap-1 text-[11px] text-neutral-400">
              <ExclamationCircleIcon className="w-3 h-3" />
              {upcomingTime(routine.next_run_at)}
            </span>
          )}
        </div>
      </div>

      {/* Toggle button */}
      {!isDraft && (
        <button
          onClick={onToggle}
          disabled={isToggling}
          title={isActive ? 'Pause routine' : 'Activate routine'}
          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 ${
            isActive
              ? 'text-neutral-400 hover:text-amber-500 hover:bg-amber-50'
              : 'text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50'
          } ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isActive
            ? <PauseIcon className="w-4 h-4" />
            : <PlayIcon className="w-4 h-4" />
          }
        </button>
      )}

      {/* Edit link */}
      <Link
        href={`/studio/${routine.id}/edit`}
        className="text-[11.5px] text-neutral-400 hover:text-indigo-600 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
      >
        Edit
      </Link>
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
      <p className="text-[13px] font-medium text-neutral-600 mb-1">No routines yet</p>
      <p className="text-[12px] text-neutral-400 mb-5 max-w-[320px] mx-auto">
        Routines are scheduled tasks {workerName} runs automatically — briefings, digests, reports.
      </p>
      <Link
        href={`/studio?assign_worker=${workerId}`}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-[13px] font-medium hover:bg-indigo-100 transition-colors"
      >
        <PlusIcon className="w-4 h-4" />
        Create a routine
      </Link>
    </div>
  );
}
