'use client';

import { useState, useEffect, useRef } from 'react';
import { WorkerActivityTrace } from './worker-activity-trace';
import { WorkerMentionInput, type WorkerMention } from './worker-mention-input';
import type { Worker } from '@/app/workers/workers-page-client';

const ROLE_AVATARS: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager:    '/workers/sofia.png',
  linkedin_drafter:   '/workers/luca.png',
  research_analyst:   '/workers/max.png',
};

interface HomeData {
  recentRuns: {
    runId: string;
    workflowId: string;
    workflowName: string;
    status: string;
    triggeredBy: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    stepOutputs: { label: string; output: string; error?: string }[];
    artifacts: { id: string; title: string }[];
  }[];
  upcomingRuns: {
    workflowId: string;
    workflowName: string;
    nextRunAt: string;
  }[];
  threadCount: number;
  recentThreadTitles: string[];
}

interface WorkerHomeViewProps {
  worker: Worker;
  onSend: (message: string, briefingText: string, mentions?: WorkerMention[]) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={open ? 'Collapse conversations' : 'Expand conversations'}
      className="flex-shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
    >
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.25" />
        <line x1="5" y1="1.5" x2="5" y2="13.5" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    </button>
  );
}

export function WorkerHomeView({ worker, onSend, sidebarOpen, onToggleSidebar }: WorkerHomeViewProps) {
  const [homeData, setHomeData] = useState<HomeData | null>(null);
  const [briefingText, setBriefingText] = useState('');
  const [briefingDone, setBriefingDone] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(true);
  const mountedRef = useRef(true);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch home data then stream briefing
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    fetch(`/api/workers/${worker.id}/home`)
      .then(r => r.json())
      .then(async (data: HomeData) => {
        if (!mountedRef.current) return;
        setHomeData(data);

        // Stream briefing
        const res = await fetch(`/api/workers/${worker.id}/briefing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ homeData: data }),
        });

        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'text_delta' && mountedRef.current) {
                setBriefingText(prev => prev + event.text);
              } else if (event.type === 'done' && mountedRef.current) {
                setBriefingDone(true);
              }
            } catch { /* skip */ }
          }
        }
      })
      .catch(() => {
        if (mountedRef.current) setBriefingDone(true);
      });
  }, [worker.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const avatarSrc = worker.worker_role ? (ROLE_AVATARS[worker.worker_role] ?? null) : null;

  const hasActivity = homeData && (homeData.recentRuns.length > 0 || homeData.upcomingRuns.length > 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sidebar toggle */}
      <div className="flex-shrink-0 flex items-center px-3 pt-2">
        <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-8 pt-8 pb-4 max-w-[640px] mx-auto w-full space-y-5">

          {/* Activity trace — always at top when available */}
          {hasActivity && (
            <div className="w-full">
              <WorkerActivityTrace
                recentRuns={homeData.recentRuns}
                upcomingRuns={homeData.upcomingRuns}
                expanded={traceExpanded}
                onToggle={() => setTraceExpanded(v => !v)}
              />
            </div>
          )}

          {/* Worker briefing */}
          <div className="w-full flex gap-3">
            {avatarSrc && (
              <img
                src={avatarSrc}
                alt={worker.name}
                className="w-8 h-8 rounded-xl object-cover object-top flex-shrink-0 mt-0.5 shadow-sm"
              />
            )}
            <div className="flex-1 min-w-0">
              {briefingText ? (
                <p className="text-[13.5px] text-neutral-700 leading-relaxed">
                  {briefingText}
                  {!briefingDone && (
                    <span className="inline-flex gap-0.5 ml-1 align-middle">
                      <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                  )}
                </p>
              ) : (
                <div className="space-y-1.5 animate-pulse pt-0.5">
                  <div className="h-3 bg-neutral-100 rounded-full w-3/4" />
                  <div className="h-3 bg-neutral-100 rounded-full w-1/2" />
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Reply input — same composer as in-thread (@ to mention). Attach lives in-thread
          once a conversation exists, since uploads attach to a thread. */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <div className="max-w-[640px] mx-auto">
          <WorkerMentionInput
            onSubmit={(text, mentions) => onSend(text, briefingText, mentions)}
            placeholder={`Reply to ${worker.name}…  (@ to mention a coworker, task, or document)`}
          />
          <p className="mt-1.5 text-center text-[11px] text-neutral-400">
            Enter to send · Shift+Enter for new line · @ to mention
          </p>
        </div>
      </div>
    </div>
  );
}
