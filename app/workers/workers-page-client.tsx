'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessageBubble, StreamingMessage, ChatMessage, ToolStatus } from '@/components/work/chat-message';
import { WorkersRoster } from '@/components/workers/workers-roster';
import { WorkerThreadList } from '@/components/workers/worker-thread-list';
import { PaperAirplaneIcon } from '@heroicons/react/24/solid';
import { PlusIcon } from '@heroicons/react/24/outline';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Worker {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  worker_role: string | null;
  conversation_starters: string[] | null;
}

export interface WorkerThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  agent_id: string | null;
}

export interface WorkersPageClientProps {
  userId?: string;
  userFullName?: string;
  initialWorkers: Worker[];
  initialActiveWorkerId: string | null;
  initialThreads: WorkerThread[];
}

// ─── Worker color map ─────────────────────────────────────────────────────────

const WORKER_COLOR_MAP: Record<string, { bg: string; dot: string }> = {
  indigo:  { bg: 'bg-indigo-500',  dot: 'bg-indigo-400' },
  violet:  { bg: 'bg-violet-500',  dot: 'bg-violet-400' },
  blue:    { bg: 'bg-blue-500',    dot: 'bg-blue-400' },
  emerald: { bg: 'bg-emerald-500', dot: 'bg-emerald-400' },
  amber:   { bg: 'bg-amber-500',   dot: 'bg-amber-400' },
  rose:    { bg: 'bg-rose-500',    dot: 'bg-rose-400' },
  neutral: { bg: 'bg-neutral-500', dot: 'bg-neutral-400' },
};

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkersPageClient({
  userId: _userId,
  userFullName: _userFullName,
  initialWorkers,
  initialActiveWorkerId,
  initialThreads,
}: WorkersPageClientProps) {
  const [workers] = useState<Worker[]>(initialWorkers);
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(initialActiveWorkerId);
  const [threads, setThreads] = useState<WorkerThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);

  const activeWorker = workers.find(w => w.id === activeWorkerId) ?? null;
  const activeThread = threads.find(t => t.id === activeThreadId) ?? null;

  // ── Worker selection ──────────────────────────────────────────────────────

  async function handleSelectWorker(id: string) {
    if (id === activeWorkerId) return;
    setActiveWorkerId(id);
    setActiveThreadId(null);
    setIsLoadingThreads(true);
    try {
      const res = await fetch(`/api/work/threads?agent_id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads ?? []);
      }
    } catch {
      // silently ignore
    } finally {
      setIsLoadingThreads(false);
    }
  }

  // ── Thread CRUD ───────────────────────────────────────────────────────────

  async function handleCreateThread(message?: string): Promise<string | null> {
    if (!activeWorkerId) return null;
    const title = message
      ? message.slice(0, 60) + (message.length > 60 ? '…' : '')
      : 'New conversation';
    try {
      const res = await fetch('/api/work/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, agentId: activeWorkerId }),
      });
      if (!res.ok) return null;
      const { thread } = await res.json();
      const newThread: WorkerThread = {
        id: thread.id,
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        agent_id: activeWorkerId,
      };
      setThreads(prev => [newThread, ...prev]);
      setActiveThreadId(thread.id);
      return thread.id;
    } catch {
      return null;
    }
  }

  async function handleDeleteThread(id: string) {
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(null);
    await fetch(`/api/work/threads/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  function handleUpdateThreadTitle(id: string, title: string) {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, title } : t));
  }

  // ── Conversation starter ──────────────────────────────────────────────────

  async function handleStarterClick(starter: string) {
    const threadId = await handleCreateThread(starter);
    // ActiveWorkerChat will receive the pending message via state
    if (threadId) setPendingMessage(starter);
  }

  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  // ── Empty state ───────────────────────────────────────────────────────────

  if (workers.length === 0) {
    return (
      <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50 items-center justify-center">
        <p className="text-[13px] text-neutral-400">Your workers are being set up…</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50">

      {/* Left: roster */}
      <div className="w-[200px] flex-shrink-0 p-2">
        <WorkersRoster
          workers={workers}
          activeWorkerId={activeWorkerId}
          onSelect={handleSelectWorker}
        />
      </div>

      {/* Center: thread list */}
      <div className="w-[240px] flex-shrink-0 p-2 pl-0 flex flex-col">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-3.5 pt-3 pb-2 flex items-center justify-between flex-shrink-0 border-b border-neutral-100">
            <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider truncate">
              {activeWorker ? activeWorker.name : 'Threads'}
            </span>
            {activeWorkerId && (
              <button
                onClick={() => handleCreateThread()}
                className="p-1 rounded-md text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors flex-shrink-0"
                title="New conversation"
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Thread list body */}
          <div className="flex-1 overflow-y-auto">
            {!activeWorkerId ? (
              <div className="flex items-center justify-center h-24">
                <p className="text-[12px] text-neutral-400">Select a worker</p>
              </div>
            ) : isLoadingThreads ? (
              <div className="p-3 space-y-2 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-8 bg-neutral-100 rounded-lg" />
                ))}
              </div>
            ) : (
              <WorkerThreadList
                threads={threads}
                activeThreadId={activeThreadId}
                onSelect={(id) => {
                  setActiveThreadId(id);
                  setPendingMessage(null);
                }}
                onDelete={handleDeleteThread}
              />
            )}
          </div>
        </div>
      </div>

      {/* Right: chat or worker home */}
      <div className="flex-1 min-w-0 p-2 pl-0 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {!activeWorker ? (
            /* No worker selected */
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[13px] text-neutral-400">Select a worker to get started</p>
            </div>
          ) : activeThread ? (
            /* Active chat */
            <ActiveWorkerChat
              key={activeThread.id}
              thread={activeThread}
              worker={activeWorker}
              pendingMessage={pendingMessage}
              onPendingConsumed={() => setPendingMessage(null)}
              onTitleUpdate={handleUpdateThreadTitle}
            />
          ) : (
            /* Worker home: conversation starters */
            <WorkerHomeScreen
              worker={activeWorker}
              onStarterClick={handleStarterClick}
              onNewThread={() => handleCreateThread()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Worker home screen ───────────────────────────────────────────────────────

interface WorkerHomeScreenProps {
  worker: Worker;
  onStarterClick: (starter: string) => void;
  onNewThread: () => void;
}

function WorkerHomeScreen({ worker, onStarterClick, onNewThread }: WorkerHomeScreenProps) {
  const colors = WORKER_COLOR_MAP[worker.color] ?? WORKER_COLOR_MAP.indigo;
  const starters = (worker.conversation_starters ?? []).filter(Boolean);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-16">
      {/* Worker identity */}
      <div className="flex flex-col items-center mb-8">
        <div className={`w-14 h-14 rounded-2xl ${colors.bg} flex items-center justify-center mb-4 shadow-sm`}>
          <span className="text-white text-[22px] select-none">{worker.icon}</span>
        </div>
        <h1 className="text-[20px] font-semibold text-neutral-800 tracking-tight">{worker.name}</h1>
        {worker.description && (
          <p className="mt-1.5 text-[13px] text-neutral-500 text-center max-w-[380px] leading-snug">
            {worker.description}
          </p>
        )}
        {worker.worker_role && (
          <span className="mt-2 text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
            {worker.worker_role}
          </span>
        )}
      </div>

      {/* Conversation starters */}
      {starters.length > 0 ? (
        <div className="w-full max-w-[500px] rounded-2xl border border-neutral-100 overflow-hidden shadow-sm">
          {starters.map((starter, i) => (
            <div key={i}>
              <button
                onClick={() => onStarterClick(starter)}
                className="w-full text-left px-4 py-3 text-[13px] text-neutral-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
              >
                {starter}
              </button>
              {i < starters.length - 1 && <div className="border-t border-neutral-100" />}
            </div>
          ))}
        </div>
      ) : (
        <button
          onClick={onNewThread}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-[13px] font-medium hover:bg-indigo-100 transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Start a conversation
        </button>
      )}
    </div>
  );
}

// ─── Active worker chat ───────────────────────────────────────────────────────

interface ActiveWorkerChatProps {
  thread: WorkerThread;
  worker: Worker;
  pendingMessage: string | null;
  onPendingConsumed: () => void;
  onTitleUpdate: (id: string, title: string) => void;
}

function ActiveWorkerChat({
  thread,
  worker,
  pendingMessage,
  onPendingConsumed,
  onTitleUpdate,
}: ActiveWorkerChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolStatus[]>([]);
  const [inputValue, setInputValue] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const hasSentPending = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamAbortRef.current?.abort();
    };
  }, []);

  // Load messages on mount / thread change
  useEffect(() => {
    hasSentPending.current = false;
    setMessages([]);
    setIsLoading(true);
    setIsStreaming(false);
    setStreamingText('');
    setStreamingTools([]);

    const controller = new AbortController();
    fetch(`/api/work/threads/${thread.id}/chat`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (!mountedRef.current) return;
        setMessages(data.messages ?? []);
        setIsLoading(false);
      })
      .catch(err => {
        if (err.name !== 'AbortError' && mountedRef.current) setIsLoading(false);
      });

    return () => controller.abort();
  }, [thread.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingTools]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputValue]);

  // Send pending message once loaded
  useEffect(() => {
    if (!pendingMessage || isLoading || isStreaming || hasSentPending.current) return;
    hasSentPending.current = true;
    onPendingConsumed();
    handleSubmit(pendingMessage);
  }, [pendingMessage, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async (message: string) => {
    if (isStreaming || !message.trim()) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsStreaming(true);
    setStreamingText('');
    setStreamingTools([]);

    const ac = new AbortController();
    streamAbortRef.current = ac;

    try {
      const res = await fetch(`/api/work/threads/${thread.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: message,
          agentId: worker.id,
          sources: ['kb', 'inbox', 'calendar'],
        }),
        signal: ac.signal,
      });

      if (!mountedRef.current) return;

      if (!res.ok || !res.body) {
        throw new Error('Stream failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accText = '';
      let accTools: ToolStatus[] = [];
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

            if (event.type === 'text') {
              accText += event.delta;
              setStreamingText(accText);

            } else if (event.type === 'tool_start') {
              const existingIdx = accTools.findIndex(t => t.name === event.name);
              if (existingIdx >= 0) {
                accTools = accTools.map((t, i) =>
                  i === existingIdx ? { ...t, id: event.id, status: 'loading' as const, label: event.label } : t
                );
              } else {
                accTools = [...accTools, { id: event.id, name: event.name, status: 'loading' as const, label: event.label }];
              }
              setStreamingTools([...accTools]);

            } else if (event.type === 'tool_result') {
              accTools = accTools.map(t =>
                t.id === event.id ? { ...t, status: 'done' as const, summary: event.summary } : t
              );
              setStreamingTools([...accTools]);

            } else if (event.type === 'title_update') {
              if (event.title) {
                onTitleUpdate(thread.id, event.title);
                // Persist to server
                fetch(`/api/work/threads/${thread.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: event.title }),
                }).catch(() => {});
              }

            } else if (event.type === 'error') {
              throw new Error('stream_error');

            } else if (event.type === 'done') {
              const assistantMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: accText,
                created_at: new Date().toISOString(),
                metadata: {
                  tool_calls: accTools.map(t => ({ name: t.name, summary: t.summary })),
                },
              };
              if (mountedRef.current) {
                setMessages(prev => [...prev, assistantMsg]);
              }
              if (event.title) {
                onTitleUpdate(thread.id, event.title);
                fetch(`/api/work/threads/${thread.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: event.title }),
                }).catch(() => {});
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      if (!mountedRef.current || (err instanceof Error && err.name === 'AbortError')) return;
      console.error('[ActiveWorkerChat] stream error:', err);
      if (mountedRef.current) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          created_at: new Date().toISOString(),
          metadata: { error: true },
        }]);
      }
    } finally {
      if (mountedRef.current) {
        setIsStreaming(false);
        setStreamingText('');
        setStreamingTools([]);
      }
    }
  }, [thread.id, worker.id, isStreaming, onTitleUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  const colors = WORKER_COLOR_MAP[worker.color] ?? WORKER_COLOR_MAP.indigo;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim()) handleSubmit(inputValue);
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 h-11 border-b border-neutral-100 flex-shrink-0">
        <div className={`w-4 h-4 rounded flex-shrink-0 ${colors.bg} flex items-center justify-center`}>
          <span className="text-white text-[10px] leading-none select-none">{worker.icon}</span>
        </div>
        <span className="text-[12.5px] font-medium text-neutral-700 truncate flex-1 min-w-0">
          {thread.title}
        </span>
        <span className="text-[11px] text-neutral-400 flex-shrink-0">{worker.name}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[660px] mx-auto px-6 py-8 space-y-6">
          {isLoading && (
            <div className="space-y-6 animate-pulse">
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-neutral-100 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className="h-3 bg-neutral-100 rounded-full w-3/4" />
                  <div className="h-3 bg-neutral-100 rounded-full w-1/2" />
                </div>
              </div>
              <div className="flex justify-end">
                <div className="h-9 bg-neutral-100 rounded-2xl rounded-br-sm w-2/5" />
              </div>
            </div>
          )}

          {!isLoading && messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-24">
              <p className="text-[13px] text-neutral-400">Start the conversation below</p>
            </div>
          )}

          {!isLoading && messages.map((msg, idx, arr) => {
            const isLastAssistant = msg.role === 'assistant' &&
              !isStreaming &&
              idx === arr.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).at(-1);
            return (
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                isLastAssistantMessage={isLastAssistant}
              />
            );
          })}

          {isStreaming && (
            <StreamingMessage
              text={streamingText}
              tools={streamingTools}
            />
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <div className="max-w-[660px] mx-auto">
          <div className="rounded-2xl bg-white shadow-sm border border-neutral-200 overflow-hidden focus-within:border-neutral-300 focus-within:shadow-md transition-all duration-150">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${worker.name}…`}
              rows={1}
              disabled={isStreaming}
              className="w-full resize-none px-4 pt-3 pb-2 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 bg-transparent outline-none leading-relaxed disabled:opacity-50"
              style={{ minHeight: '44px', maxHeight: '180px' }}
            />
            <div className="flex items-center justify-end px-3 pb-2.5">
              <button
                onClick={() => { if (inputValue.trim()) handleSubmit(inputValue); }}
                disabled={isStreaming || !inputValue.trim()}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors"
                title="Send"
              >
                <PaperAirplaneIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-neutral-400">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
