'use client';

import type { Worker } from '@/app/workers/workers-page-client';

const COLOR_MAP: Record<string, { bg: string; activeBg: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-100',  activeBg: 'bg-indigo-500',  text: 'text-indigo-600' },
  violet:  { bg: 'bg-violet-100',  activeBg: 'bg-violet-500',  text: 'text-violet-600' },
  blue:    { bg: 'bg-blue-100',    activeBg: 'bg-blue-500',    text: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-100', activeBg: 'bg-emerald-500', text: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-100',   activeBg: 'bg-amber-500',   text: 'text-amber-600' },
  rose:    { bg: 'bg-rose-100',    activeBg: 'bg-rose-500',    text: 'text-rose-600' },
  neutral: { bg: 'bg-neutral-100', activeBg: 'bg-neutral-500', text: 'text-neutral-600' },
};

const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Personal Assistant',
  content_manager: 'Content',
  custom: 'Custom',
};

interface WorkersRosterProps {
  workers: Worker[];
  activeWorkerId: string | null;
  onSelect: (id: string) => void;
}

export function WorkersRoster({ workers, activeWorkerId, onSelect }: WorkersRosterProps) {
  return (
    <div className="h-full rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="px-3.5 pt-3 pb-2 flex-shrink-0 border-b border-neutral-100">
        <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider">
          Workers
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {workers.map((worker) => {
          const isActive = worker.id === activeWorkerId;
          const colors = COLOR_MAP[worker.color] ?? COLOR_MAP.neutral;
          const roleLabel = worker.worker_role ? (ROLE_LABELS[worker.worker_role] ?? worker.worker_role) : null;

          return (
            <button
              key={worker.id}
              onClick={() => onSelect(worker.id)}
              className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors ${
                isActive
                  ? 'bg-indigo-50'
                  : 'hover:bg-neutral-50'
              }`}
            >
              {/* Avatar */}
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                isActive ? colors.activeBg : colors.bg
              }`}>
                <span className={`text-[13px] select-none leading-none ${isActive ? 'text-white' : colors.text}`}>
                  {worker.icon}
                </span>
              </div>

              {/* Name + role */}
              <div className="min-w-0 flex-1">
                <p className={`text-[12.5px] font-medium truncate leading-tight ${
                  isActive ? 'text-indigo-700' : 'text-neutral-700'
                }`}>
                  {worker.name}
                </p>
                {roleLabel && (
                  <p className="text-[10.5px] text-neutral-400 truncate leading-tight mt-0.5">
                    {roleLabel}
                  </p>
                )}
              </div>

              {/* Active indicator */}
              {isActive && (
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
