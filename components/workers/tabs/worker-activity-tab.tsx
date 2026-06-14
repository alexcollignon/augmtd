'use client';

import { useState, useEffect } from 'react';
import { ChatBubbleLeftIcon, WrenchIcon } from '@heroicons/react/24/outline';
import type { WorkerThread } from '@/app/workers/workers-page-client';

interface MessageSummary {
  thread_id: string;
  thread_title: string;
  tool_names: string[];
  updated_at: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_emails: 'Read emails',
  get_meeting_context: 'Checked calendar',
  web_search: 'Searched the web',
  fetch_url: 'Fetched a page',
  deep_research: 'Deep research',
  create_draft: 'Drafted email',
  send_email: 'Sent email',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface WorkerActivityTabProps {
  workerId: string;
  workerName: string;
}

export function WorkerActivityTab({ workerId, workerName }: WorkerActivityTabProps) {
  const [threads, setThreads] = useState<WorkerThread[]>([]);
  const [toolActivity, setToolActivity] = useState<MessageSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/work/threads?agent_id=${workerId}`)
      .then(r => r.json())
      .then(data => {
        const t: WorkerThread[] = data.threads ?? [];
        setThreads(t);

        // Fetch messages with tool calls for recent threads (up to 10)
        const recent = t.slice(0, 10);
        if (recent.length === 0) { setIsLoading(false); return; }

        Promise.all(
          recent.map(thread =>
            fetch(`/api/work/threads/${thread.id}/chat`)
              .then(r => r.json())
              .then(d => {
                const msgs: Array<{ role: string; metadata?: Record<string, unknown> | null }> = d.messages ?? [];
                const toolNames = msgs
                  .filter(m => m.role === 'assistant' && Array.isArray((m.metadata as Record<string, unknown>)?.tool_calls))
                  .flatMap(m => ((m.metadata as Record<string, unknown>).tool_calls as Array<{ name: string }>).map(tc => tc.name));
                const unique = [...new Set(toolNames)];
                return unique.length > 0
                  ? { thread_id: thread.id, thread_title: thread.title, tool_names: unique, updated_at: thread.updated_at }
                  : null;
              })
              .catch(() => null)
          )
        ).then(results => {
          setToolActivity(results.filter((r): r is MessageSummary => r !== null));
          setIsLoading(false);
        });
      })
      .catch(() => setIsLoading(false));
  }, [workerId]);

  if (isLoading) {
    return (
      <div className="flex-1 p-6 space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <div className="w-8 h-8 bg-neutral-100 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 bg-neutral-100 rounded w-2/3" />
              <div className="h-3 bg-neutral-100 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[13px] text-neutral-400">
          {workerName}&apos;s activity will appear here after your first conversation
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-6 py-8 space-y-10">

        {/* Tool actions */}
        {toolActivity.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 mb-4">
              <WrenchIcon className="w-3.5 h-3.5 text-neutral-400" />
              <h2 className="text-[13px] font-semibold text-neutral-800">Actions taken</h2>
            </div>
            <div className="rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
              {toolActivity.map(item => (
                <div key={item.thread_id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-neutral-700 truncate">
                      {item.thread_title}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {item.tool_names.map(name => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 text-[11px] text-neutral-500"
                        >
                          {toolLabel(name)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-[11px] text-neutral-400 flex-shrink-0 pt-0.5">
                    {relativeTime(item.updated_at)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent conversations */}
        <section>
          <div className="flex items-center gap-1.5 mb-4">
            <ChatBubbleLeftIcon className="w-3.5 h-3.5 text-neutral-400" />
            <h2 className="text-[13px] font-semibold text-neutral-800">Recent conversations</h2>
          </div>
          <div className="rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
            {threads.map(thread => (
              <div key={thread.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-neutral-700 truncate">{thread.title}</p>
                </div>
                <span className="text-[11px] text-neutral-400 flex-shrink-0">
                  {relativeTime(thread.updated_at)}
                </span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
