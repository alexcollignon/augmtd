'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PlusIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { ChatMessageBubble, StreamingMessage, ToolStatus } from '@/components/work/chat-message';
import type { ChatMessage } from '@/components/work/chat-message';
import { WorkerThreadList } from '@/components/workers/worker-thread-list';
import type { Worker, WorkerThread } from '@/app/workers/workers-page-client';

interface WorkerChatTabProps {
  worker: Worker;
  initialThreads: WorkerThread[];
}

export function WorkerChatTab({ worker, initialThreads }: WorkerChatTabProps) {
  const [threads, setThreads] = useState<WorkerThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const activeThread = threads.find(t => t.id === activeThreadId) ?? null;
  const starters = (worker.conversation_starters ?? []).filter(Boolean);

  async function handleCreateThread(message?: string): Promise<string | null> {
    const title = message
      ? message.slice(0, 60) + (message.length > 60 ? '…' : '')
      : 'New conversation';
    try {
      const res = await fetch('/api/work/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, agentId: worker.id }),
      });
      if (!res.ok) return null;
      const { thread } = await res.json();
      const newThread: WorkerThread = {
        id: thread.id,
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        agent_id: worker.id,
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

  async function handleStarterClick(starter: string) {
    const threadId = await handleCreateThread(starter);
    if (threadId) setPendingMessage(starter);
  }

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden">
      {/* Thread list */}
      <div className="w-[220px] flex-shrink-0 border-r border-neutral-100 flex flex-col">
        <div className="px-3.5 py-2.5 flex items-center justify-between flex-shrink-0 border-b border-neutral-100">
          <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider">
            Conversations
          </span>
          <button
            onClick={() => handleCreateThread()}
            className="p-1 rounded-md text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            title="New conversation"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <WorkerThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={(id) => { setActiveThreadId(id); setPendingMessage(null); }}
            onDelete={handleDeleteThread}
          />
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activeThread ? (
          <ActiveWorkerChat
            key={activeThread.id}
            thread={activeThread}
            worker={worker}
            pendingMessage={pendingMessage}
            onPendingConsumed={() => setPendingMessage(null)}
            onTitleUpdate={handleUpdateThreadTitle}
          />
        ) : (
          <WorkerChatHome
            worker={worker}
            starters={starters}
            onStarterClick={handleStarterClick}
            onNewThread={() => handleCreateThread()}
          />
        )}
      </div>
    </div>
  );
}

// ─── Worker chat home (no thread selected) ────────────────────────────────────

interface WorkerChatHomeProps {
  worker: Worker;
  starters: string[];
  onStarterClick: (s: string) => void;
  onNewThread: () => void;
}

function WorkerChatHome({ worker, starters, onStarterClick, onNewThread }: WorkerChatHomeProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-16">
      <p className="text-[13px] text-neutral-500 mb-6 text-center">
        {worker.description ?? `Start a conversation with ${worker.name}`}
      </p>

      {starters.length > 0 ? (
        <div className="w-full max-w-[480px] rounded-2xl border border-neutral-100 overflow-hidden shadow-sm">
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

// ─── Active chat ──────────────────────────────────────────────────────────────

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingTools]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputValue]);

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
        body: JSON.stringify({ content: message, agentId: worker.id }),
        signal: ac.signal,
      });

      if (!mountedRef.current) return;
      if (!res.ok || !res.body) throw new Error('Stream failed');

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
              const idx = accTools.findIndex(t => t.name === event.name);
              if (idx >= 0) {
                accTools = accTools.map((t, i) =>
                  i === idx ? { ...t, id: event.id, status: 'loading' as const, label: event.label } : t
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
                fetch(`/api/work/threads/${thread.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: event.title }),
                }).catch(() => {});
              }

            } else if (event.type === 'done') {
              const assistantMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: accText,
                created_at: new Date().toISOString(),
                metadata: { tool_calls: accTools.map(t => ({ name: t.name, summary: t.summary })) },
              };
              if (mountedRef.current) setMessages(prev => [...prev, assistantMsg]);
              if (event.title) {
                onTitleUpdate(thread.id, event.title);
                fetch(`/api/work/threads/${thread.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: event.title }),
                }).catch(() => {});
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if (!mountedRef.current || (err instanceof Error && err.name === 'AbortError')) return;
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim()) handleSubmit(inputValue);
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
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
            </div>
          )}

          {!isLoading && messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-24">
              <p className="text-[13px] text-neutral-400">Start the conversation below</p>
            </div>
          )}

          {!isLoading && messages.map((msg, idx, arr) => {
            const isLastAssistant = msg.role === 'assistant' && !isStreaming &&
              idx === arr.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).at(-1);
            return (
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                isLastAssistantMessage={isLastAssistant}
              />
            );
          })}

          {isStreaming && <StreamingMessage text={streamingText} tools={streamingTools} />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <div className="max-w-[660px] mx-auto">
          <div className="rounded-2xl bg-neutral-50 border border-neutral-200 overflow-hidden focus-within:border-neutral-300 focus-within:bg-white focus-within:shadow-sm transition-all duration-150">
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
