'use client';

import { useState } from 'react';
import { WorkerChatTab } from '@/components/workers/tabs/worker-chat-tab';
import { WorkerKnowledgeTab } from '@/components/workers/tabs/worker-knowledge-tab';
import { WorkerActivityTab } from '@/components/workers/tabs/worker-activity-tab';
import type { Worker, WorkerThread } from '@/app/workers/workers-page-client';

type Tab = 'chat' | 'knowledge' | 'activity';

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-500',  text: 'text-indigo-600' },
  violet:  { bg: 'bg-violet-500',  text: 'text-violet-600' },
  blue:    { bg: 'bg-blue-500',    text: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-500',   text: 'text-amber-600' },
  rose:    { bg: 'bg-rose-500',    text: 'text-rose-600' },
  neutral: { bg: 'bg-neutral-400', text: 'text-neutral-600' },
};

const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Personal Assistant',
  content_manager: 'Content Manager',
  custom: 'Custom',
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat',      label: 'Chat' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'activity',  label: 'Activity' },
];

interface WorkerProfileProps {
  worker: Worker;
  initialThreads: WorkerThread[];
}

export function WorkerProfile({ worker, initialThreads }: WorkerProfileProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const colors = COLOR_MAP[worker.color] ?? COLOR_MAP.neutral;
  const roleLabel = worker.worker_role ? (ROLE_LABELS[worker.worker_role] ?? worker.worker_role) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm">

      {/* Profile header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-0 border-b border-neutral-100">
        <div className="flex items-start gap-4 mb-5">
          {/* Avatar */}
          <div className={`w-12 h-12 rounded-2xl ${colors.bg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <span className="text-white text-[20px] select-none leading-none">{worker.icon}</span>
          </div>

          {/* Name + meta */}
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[16px] font-semibold text-neutral-900 leading-tight">{worker.name}</h1>
              {roleLabel && (
                <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 ${colors.text}`}>
                  {roleLabel}
                </span>
              )}
            </div>
            {worker.description && (
              <p className="text-[12.5px] text-neutral-500 mt-1 leading-snug line-clamp-2">
                {worker.description}
              </p>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-neutral-400 hover:text-neutral-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'chat' && (
          <WorkerChatTab
            key={`chat-${worker.id}`}
            worker={worker}
            initialThreads={initialThreads}
          />
        )}
        {activeTab === 'knowledge' && (
          <WorkerKnowledgeTab
            key={`knowledge-${worker.id}`}
            workerId={worker.id}
            workerName={worker.name}
          />
        )}
        {activeTab === 'activity' && (
          <WorkerActivityTab
            key={`activity-${worker.id}`}
            workerId={worker.id}
            workerName={worker.name}
          />
        )}
      </div>
    </div>
  );
}
