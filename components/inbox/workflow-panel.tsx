'use client';

import { useState, useEffect, useRef } from 'react';
import { SparklesIcon, ChevronRightIcon, BookmarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import type { SavedWorkflow } from '@/lib/types/work-blueprints';
import { toast } from 'sonner';

interface WorkflowPanelProps {
  item: InboxItem | null;
  onClose: () => void;
}

export default function WorkflowPanel({ item, onClose }: WorkflowPanelProps) {
  const [suggestedWorkflows, setSuggestedWorkflows] = useState<Array<Pick<SavedWorkflow, 'id' | 'name' | 'deliverable_types'> & { score: number }>>([]);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [freshPrompt, setFreshPrompt] = useState('');
  const [isOpening, setIsOpening] = useState(false);

  const fetchedForRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!item?.id) return;
    if (fetchedForRef.current === item.id) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsSuggesting(true);
    setAiSuggestion(null);
    setSuggestedWorkflows([]);
    setFreshPrompt('');
    fetch(`/api/inbox/${item.id}/suggest-workflows`, { method: 'POST', signal: ctrl.signal })
      .then(r => r.json())
      .then(({ rankedWorkflows, aiSuggestion: suggestion }) => {
        fetchedForRef.current = item.id;
        setSuggestedWorkflows(rankedWorkflows ?? []);
        setAiSuggestion(suggestion ?? null);
      })
      .catch(e => { if (e?.name !== 'AbortError') console.error('[suggest-workflows]', e); })
      .finally(() => setIsSuggesting(false));
    return () => ctrl.abort();
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunWithWorkflow = async (workflowId: string) => {
    if (!item) return;
    setIsOpening(true);
    try {
      const res = await fetch(`/api/work/saved-workflows/${workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxItemId: item.id }),
      });
      if (res.ok) {
        const { threadId } = await res.json();
        window.location.href = `/work?thread=${threadId}`;
      } else {
        toast.error('Failed to run workflow. Please try again.');
      }
    } catch {
      toast.error('Failed to run workflow. Please try again.');
    } finally {
      setIsOpening(false);
    }
  };

  const handleOpenInWorkflows = async (prompt?: string) => {
    if (!item) return;
    setIsOpening(true);
    try {
      const response = await fetch(`/api/inbox/${item.id}/open-workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prompt ? { prompt } : {}),
      });
      if (response.ok) {
        const { threadId } = await response.json();
        const view = item.execution_status === 'ready' ? '&view=document' : '';
        window.location.href = `/work?thread=${threadId}${view}`;
      } else {
        toast.error('Failed to open workflow. Please try again.');
      }
    } catch {
      toast.error('Failed to open workflow. Please try again.');
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex-shrink-0 h-10 flex items-center justify-between px-3 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-3.5 h-3.5 text-indigo-500" />
          <span className="text-[12px] font-semibold text-neutral-700">Workflows</span>
        </div>
        <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {/* Existing thread */}
        {item?.work_thread_id && (
          <button
            onClick={() => { window.location.href = `/work?thread=${item.work_thread_id}`; }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-md bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              <span className="text-[12.5px] font-medium text-emerald-900 truncate">Continue in Workflows</span>
            </div>
            <ChevronRightIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 ml-2" />
          </button>
        )}

        {isSuggesting ? (
          <>
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded bg-indigo-200 animate-pulse flex-shrink-0" />
                <div className="h-3 bg-indigo-200 animate-pulse rounded flex-1" />
              </div>
              <div className="h-3 bg-indigo-100 animate-pulse rounded w-3/4 ml-5" />
            </div>
            {[1, 2].map(i => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-neutral-100 bg-neutral-50">
                <div className="w-3.5 h-3.5 rounded bg-neutral-200 animate-pulse flex-shrink-0" />
                <div className="h-3 bg-neutral-200 animate-pulse rounded flex-1" />
              </div>
            ))}
          </>
        ) : (
          <>
            {/* AI suggestion */}
            {aiSuggestion && (
              <div className="rounded-lg bg-indigo-50 border border-indigo-100 overflow-hidden">
                <div className="flex items-start gap-2 px-3 pt-3 pb-2.5">
                  <SparklesIcon className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-indigo-900 leading-snug">{aiSuggestion}</p>
                </div>
                <button
                  onClick={() => handleOpenInWorkflows()}
                  disabled={isOpening}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold disabled:opacity-50 transition-colors rounded-b-lg"
                >
                  {isOpening
                    ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <>Run this <ChevronRightIcon className="w-3.5 h-3.5" /></>
                  }
                </button>
              </div>
            )}

            {/* Saved workflows */}
            {suggestedWorkflows.map(wf => (
              <button
                key={wf.id}
                onClick={() => handleRunWithWorkflow(wf.id)}
                disabled={isOpening}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-md bg-neutral-50 border border-neutral-100 hover:bg-neutral-100 hover:border-neutral-200 transition-colors group disabled:opacity-50 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <BookmarkIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                  <span className="text-[12.5px] font-medium text-neutral-900 group-hover:text-indigo-700 truncate">{wf.name}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  {wf.deliverable_types.length > 0 && (
                    <span className="text-[11px] text-neutral-400">{wf.deliverable_types.join('+')}</span>
                  )}
                  {wf.score >= 0.3 && (
                    <span className="text-[11px] text-neutral-400">{Math.round(wf.score * 100)}%</span>
                  )}
                  <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-400 transition-colors" />
                </div>
              </button>
            ))}

            {/* Custom prompt */}
            <div className="rounded-lg border border-neutral-200 overflow-hidden">
              <textarea
                rows={2}
                value={freshPrompt}
                onChange={e => setFreshPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && freshPrompt.trim()) {
                    e.preventDefault();
                    handleOpenInWorkflows(freshPrompt.trim());
                  }
                }}
                placeholder="What do you want to do with this email?"
                className="w-full px-3 py-2.5 text-[12.5px] text-neutral-700 placeholder:text-neutral-400 bg-transparent outline-none resize-none leading-snug"
              />
              {freshPrompt.trim() && (
                <div className="px-3 pb-2.5 flex justify-end">
                  <button
                    onClick={() => handleOpenInWorkflows(freshPrompt.trim())}
                    disabled={isOpening}
                    className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex items-center gap-0.5 transition-colors"
                  >
                    Open
                    <ArrowTopRightOnSquareIcon className="w-3 h-3 ml-0.5" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
