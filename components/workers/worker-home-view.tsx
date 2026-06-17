'use client';

import { useState, useEffect, useRef } from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { WorkerActivityTrace } from './worker-activity-trace';
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
  onSend: (message: string, briefingText: string) => void;
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
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputValue]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim()) { onSend(inputValue.trim(), briefingText); setInputValue(''); }
    }
  }

  function handleSubmit() {
    if (inputValue.trim()) { onSend(inputValue.trim(), briefingText); setInputValue(''); }
  }

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

      {/* Reply input */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <div className="max-w-[640px] mx-auto">
          <div className="rounded-2xl bg-neutral-50 border border-neutral-200 overflow-hidden focus-within:border-neutral-300 focus-within:bg-white focus-within:shadow-sm transition-all duration-150">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Reply to ${worker.name}…`}
              rows={1}
              className="w-full resize-none px-4 pt-3 pb-2 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 bg-transparent outline-none leading-relaxed"
              style={{ minHeight: '44px', maxHeight: '180px' }}
            />
            <div className="flex items-center justify-end px-3 pb-2.5">
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim()}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors"
              >
                <PaperAirplaneIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-neutral-400">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
