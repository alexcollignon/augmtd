'use client';

import { useState } from 'react';
import { ChevronDownIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface RecentRun {
  runId: string;
  workflowName: string;
  status: string;
  triggeredBy: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  stepOutputs: { label: string; output: string; error?: string }[];
  artifacts: { id: string; title: string }[];
}

interface UpcomingRun {
  workflowId: string;
  workflowName: string;
  nextRunAt: string;
}

interface WorkerActivityTraceProps {
  recentRuns: RecentRun[];
  upcomingRuns: UpcomingRun[];
  expanded: boolean;
  onToggle: () => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

export function WorkerActivityTrace({ recentRuns, upcomingRuns, expanded, onToggle }: WorkerActivityTraceProps) {
  const hasContent = recentRuns.length > 0 || upcomingRuns.length > 0;
  if (!hasContent) return null;

  return (
    <div className="w-full max-w-[580px] mx-auto rounded-xl border border-neutral-100 bg-neutral-50 overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-neutral-100/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] font-medium text-neutral-400">
            Activity
          </span>
          <span className="text-[11px] text-neutral-300">·</span>
          <span className="text-[11px] text-neutral-400">
            {recentRuns.length} recent{upcomingRuns.length > 0 ? `, ${upcomingRuns.length} upcoming` : ''}
          </span>
        </div>
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-neutral-400 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-neutral-100 divide-y divide-neutral-100">
          {/* Recent runs */}
          {recentRuns.map(run => (
            <TraceRunRow key={run.runId} run={run} />
          ))}

          {/* Upcoming runs */}
          {upcomingRuns.map(r => (
            <div key={r.workflowId} className="px-4 py-2.5 flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full border border-neutral-300 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-[12px] text-neutral-500">{r.workflowName}</span>
              </div>
              <span className="text-[11px] text-neutral-400 flex-shrink-0">{timeUntil(r.nextRunAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TraceRunRow({ run }: { run: RecentRun }) {
  const [open, setOpen] = useState(false);
  const succeeded = run.status === 'succeeded';
  const time = relativeTime(run.completedAt);
  const triggerLabel = run.triggeredBy === 'schedule' ? 'Scheduled' : 'Run in chat';

  const steps = run.stepOutputs.filter(s => s.label);

  return (
    <div className="px-4 py-2.5">
      <button
        onClick={() => steps.length > 0 && setOpen(v => !v)}
        className={`w-full flex items-start gap-2.5 text-left ${steps.length > 0 ? 'cursor-pointer group' : 'cursor-default'}`}
      >
        <div className="flex-shrink-0 mt-0.5">
          {succeeded ? (
            <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <XCircleIcon className="w-3.5 h-3.5 text-red-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-medium text-neutral-700">{run.workflowName}</span>
            <span className="text-[11px] text-neutral-300">·</span>
            <span className="text-[11px] text-neutral-400">{triggerLabel}</span>
            {time && (
              <>
                <span className="text-[11px] text-neutral-300">·</span>
                <span className="text-[11px] text-neutral-400">{time}</span>
              </>
            )}
          </div>
          {!open && steps.length > 0 && (
            <p className="mt-0.5 text-[11px] text-neutral-400 truncate">
              {steps.at(-1)?.label}
            </p>
          )}
        </div>
        {steps.length > 0 && (
          <ChevronDownIcon
            className={`w-3 h-3 text-neutral-300 flex-shrink-0 mt-0.5 transition-transform duration-100 opacity-0 group-hover:opacity-100 ${open ? 'rotate-180 opacity-100' : ''}`}
          />
        )}
      </button>

      {open && steps.length > 0 && (
        <div className="mt-1.5 ml-6 space-y-0.5">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-[10px] text-neutral-300 mt-px flex-shrink-0">›</span>
              <span className="text-[11px] text-neutral-400 leading-relaxed">
                {step.label}
                {step.output && (
                  <span className="text-neutral-300"> — {step.output.slice(0, 80)}</span>
                )}
                {step.error && (
                  <span className="text-red-400"> {step.error}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
