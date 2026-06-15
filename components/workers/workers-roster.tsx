'use client';

import {
  Cog6ToothIcon,
  UserIcon,
  PencilSquareIcon,
  PencilIcon,
  BoltIcon,
  SparklesIcon,
  BriefcaseIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import type { Worker } from '@/app/workers/workers-page-client';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  user:              UserIcon,
  pencil:            PencilIcon,
  'pencil-square':   PencilSquareIcon,
  'magnifying-glass': MagnifyingGlassIcon,
  bolt:              BoltIcon,
  sparkles:          SparklesIcon,
  briefcase:         BriefcaseIcon,
  'chart-bar':       ChartBarIcon,
};

const ROLE_AVATARS: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager:    '/workers/sofia.png',
  linkedin_drafter:   '/workers/luca.png',
  research_analyst:   '/workers/max.png',
};

const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Personal Assistant',
  content_manager:    'Content Strategist',
  linkedin_drafter:   'LinkedIn Wizard',
  research_analyst:   'Research Analyst',
};

const COLOR_MAP: Record<string, { bg: string; activeBg: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-100',  activeBg: 'bg-indigo-500',  text: 'text-indigo-600' },
  violet:  { bg: 'bg-violet-100',  activeBg: 'bg-violet-500',  text: 'text-violet-600' },
  blue:    { bg: 'bg-blue-100',    activeBg: 'bg-blue-500',    text: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-100', activeBg: 'bg-emerald-500', text: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-100',   activeBg: 'bg-amber-500',   text: 'text-amber-600' },
  rose:    { bg: 'bg-rose-100',    activeBg: 'bg-rose-500',    text: 'text-rose-600' },
  neutral: { bg: 'bg-neutral-100', activeBg: 'bg-neutral-500', text: 'text-neutral-600' },
};

interface WorkersRosterProps {
  workers: Worker[];
  activeWorkerId: string | null;
  onSelect: (id: string) => void;
  onManage: () => void;
}

export function WorkersRoster({ workers, activeWorkerId, onSelect, onManage }: WorkersRosterProps) {
  return (
    <div className="h-full rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 pt-4 pb-3 flex-shrink-0">
        <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider">
          Your team
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {workers.map(worker => {
          const isActive   = worker.id === activeWorkerId;
          const colors     = COLOR_MAP[worker.color] ?? COLOR_MAP.neutral;
          const WorkerIcon = ICON_MAP[worker.icon] ?? SparklesIcon;
          const avatarSrc  = worker.worker_role ? (ROLE_AVATARS[worker.worker_role] ?? null) : null;

          return (
            <button
              key={worker.id}
              onClick={() => onSelect(worker.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                isActive ? 'bg-indigo-50' : 'hover:bg-neutral-50'
              }`}
            >
              {/* Avatar */}
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={worker.name}
                  className="w-8 h-8 rounded-lg object-cover object-top flex-shrink-0"
                />
              ) : (
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isActive ? colors.activeBg : colors.bg
                }`}>
                  <WorkerIcon className={`w-4 h-4 ${isActive ? 'text-white' : colors.text}`} />
                </div>
              )}

              {/* Name + role */}
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-medium truncate leading-tight ${
                  isActive ? 'text-indigo-700' : 'text-neutral-700'
                }`}>
                  {worker.name}
                </p>
                {worker.worker_role && ROLE_LABELS[worker.worker_role] && (
                  <p className="text-[10.5px] text-neutral-400 truncate leading-tight mt-0.5">
                    {ROLE_LABELS[worker.worker_role]}
                  </p>
                )}
              </div>

              {/* Active dot */}
              {isActive && (
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Manage link */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-neutral-100">
        <button
          onClick={onManage}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11.5px] text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <Cog6ToothIcon className="w-3.5 h-3.5" />
          Manage workers
        </button>
      </div>
    </div>
  );
}
