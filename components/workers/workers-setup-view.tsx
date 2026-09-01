'use client';

import { useState } from 'react';
import {
  CheckIcon,
  UserIcon,
  PencilSquareIcon,
  PencilIcon,
  BoltIcon,
  SparklesIcon,
  BriefcaseIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';
import type { Worker } from '@/app/workers/workers-page-client';
import { ROLE_AVATARS, ROLE_LABELS } from '@/lib/workers/roles';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  user:               UserIcon,
  pencil:             PencilIcon,
  'pencil-square':    PencilSquareIcon,
  'magnifying-glass': MagnifyingGlassIcon,
  bolt:               BoltIcon,
  sparkles:           SparklesIcon,
  briefcase:          BriefcaseIcon,
  'chart-bar':        ChartBarIcon,
};

const COLOR_MAP: Record<string, { bg: string; light: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-500',  light: 'bg-indigo-50',  text: 'text-indigo-600' },
  violet:  { bg: 'bg-violet-500',  light: 'bg-violet-50',  text: 'text-violet-600' },
  blue:    { bg: 'bg-blue-500',    light: 'bg-blue-50',    text: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-500',   light: 'bg-amber-50',   text: 'text-amber-600' },
  rose:    { bg: 'bg-rose-500',    light: 'bg-rose-50',    text: 'text-rose-600' },
  neutral: { bg: 'bg-neutral-400', light: 'bg-neutral-50', text: 'text-neutral-600' },
};


// Display copy per role — owned here so the setup view is never stale relative to DB values
const ROLE_COPY: Record<string, { description: string; bullets: [string, string] }> = {
  personal_assistant: {
    description: 'Keeps you on top of what needs attention.',
    bullets: ['Flags emails that need a reply', 'Preps you for upcoming meetings'],
  },
  branding_expert: {
    description: 'Keeps your LinkedIn active and credible — posts, series, presence.',
    bullets: ['Posts and series sourced from your real work', 'A cadence and voice that stay yours'],
  },
  research_analyst: {
    description: 'Turns information into structured, actionable briefings.',
    bullets: ['Cited sources, clear structure, no fluff', 'Flags what needs immediate attention'],
  },
};

interface WorkersSetupViewProps {
  workers: Worker[];
  userFirstName?: string;
  onEnable: (workerId: string) => void;
  onDisable: (workerId: string) => void;
  onEnterWorkspace: () => void;
}

export function WorkersSetupView({
  workers,
  userFirstName,
  onEnable,
  onDisable,
  onEnterWorkspace,
}: WorkersSetupViewProps) {
  const [toggling, setToggling] = useState<string | null>(null);

  const enabledCount = workers.filter(w => w.is_enabled).length;

  async function handleToggle(worker: Worker) {
    if (toggling) return;
    setToggling(worker.id);
    try {
      const next = !worker.is_enabled;
      const res = await fetch(`/api/workers/${worker.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: next }),
      });
      if (res.ok) {
        if (next) onEnable(worker.id);
        else onDisable(worker.id);
      }
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center overflow-y-auto px-8 py-10 bg-neutral-50/40">
      <div className="w-full max-w-5xl flex flex-col gap-10">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-[22px] font-semibold text-neutral-700 tracking-tight mb-2">
            Meet your workers{userFirstName ? `, ${userFirstName}` : ''}.
          </h1>
          <p className="text-[13px] text-neutral-400">
            Add the ones that fit how you work. You can always change this later.
          </p>
        </div>

        {/* 1×4 grid */}
        <div className="grid grid-cols-4 gap-4">
          {workers.map(worker => {
            const colors     = COLOR_MAP[worker.color] ?? COLOR_MAP.neutral;
            const copy       = worker.worker_role ? (ROLE_COPY[worker.worker_role] ?? null) : null;
            const avatarSrc  = worker.worker_role ? (ROLE_AVATARS[worker.worker_role] ?? null) : null;
            const roleLabel  = worker.worker_role ? (ROLE_LABELS[worker.worker_role] ?? null) : null;
            const isEnabled  = worker.is_enabled;
            const isToggling = toggling === worker.id;
            const WorkerIcon = ICON_MAP[worker.icon] ?? SparklesIcon;

            return (
              <div
                key={worker.id}
                className={`rounded-2xl border bg-white flex flex-col overflow-hidden transition-all ${
                  isEnabled ? 'border-indigo-200 shadow-sm' : 'border-neutral-200'
                }`}
              >
                {/* Image fills top */}
                <div className="relative w-full aspect-[4/3] bg-neutral-100 overflow-hidden flex-shrink-0">
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt={worker.name}
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center ${colors.light}`}>
                      <WorkerIcon className={`w-10 h-10 ${colors.text}`} />
                    </div>
                  )}
                </div>

                {/* Name + role + info icon */}
                <div className="px-4 pt-3 pb-0 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold text-neutral-800 leading-snug truncate">
                      {worker.name}
                    </h2>
                    {roleLabel && (
                      <p className="text-[10.5px] font-medium text-neutral-400 uppercase tracking-wide leading-snug">
                        {roleLabel}
                      </p>
                    )}
                  </div>

                  {/* Info icon with hover tooltip */}
                  {copy?.bullets && (
                    <div className="relative group flex-shrink-0 mt-0.5">
                      <InformationCircleIcon className="w-4 h-4 text-neutral-300 hover:text-neutral-500 cursor-default transition-colors" />
                      {/* Tooltip */}
                      <div className="pointer-events-none absolute right-0 bottom-full mb-2 w-52 rounded-xl bg-neutral-800 px-3 py-2.5 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10">
                        <ul className="space-y-1.5">
                          {copy.bullets.map((b, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-neutral-200 leading-snug">
                              <span className="mt-[5px] w-1 h-1 rounded-full bg-neutral-500 flex-shrink-0" />
                              {b}
                            </li>
                          ))}
                        </ul>
                        {/* Arrow */}
                        <div className="absolute right-1.5 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-neutral-800" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Toggle button */}
                <div className="px-4 pb-4 pt-3 mt-auto">
                  <Button
                    variant={isEnabled ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => handleToggle(worker)}
                    disabled={isToggling}
                    className="w-full"
                  >
                    {isEnabled && <CheckIcon className="w-3.5 h-3.5" />}
                    {isToggling ? '…' : isEnabled ? 'Added' : 'Add'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        {enabledCount > 0 && (
          <div className="text-center">
            <Button onClick={onEnterWorkspace} className="px-6 py-2.5">
              Go to workspace →
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
