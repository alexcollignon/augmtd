'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PlusIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { ArtifactPanel } from '@/components/workers/artifact-panel';
import type { DocumentArtifact } from '@/lib/types/inbox';

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
// ─── Resize handle ───────────────────────────────────────────────────────────

function ResizeHandle({ onResize, disabled }: { onResize: (delta: number) => void; disabled?: boolean }) {
  const isResizingRef = useRef(false);

  function handleMouseDown(e: React.MouseEvent) {
    if (disabled) return;
    e.preventDefault();
    isResizingRef.current = true;
    let lastX = e.clientX;

    function onMove(ev: MouseEvent) {
      if (!isResizingRef.current) return;
      onResize(ev.clientX - lastX);
      lastX = ev.clientX;
    }
    function onUp() {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`flex-shrink-0 w-1 relative group ${disabled ? 'cursor-default' : 'cursor-col-resize'}`}
    >
      <div className="absolute inset-y-0 -left-0.5 -right-0.5 group-hover:bg-indigo-300/40 transition-colors rounded-full" />
    </div>
  );
}

// ─── Sidebar toggle button ────────────────────────────────────────────────────

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

import { ChatMessageBubble, StreamingMessage, ToolStatus } from '@/components/work/chat-message';
import type { ChatMessage } from '@/components/work/chat-message';
import { WorkerThreadList } from '@/components/workers/worker-thread-list';
import type { Worker, WorkerThread } from '@/app/workers/workers-page-client';

interface WorkerChatTabProps {
  worker: Worker;
  initialThreads: WorkerThread[];
  initialMessages?: ChatMessage[];
  jumpThreadId?: string | null;
  onJumpConsumed?: () => void;
  onThreadCreated?: (thread: WorkerThread) => void;
  initialInputValue?: string | null;
  onInitialInputConsumed?: () => void;
}

export function WorkerChatTab({ worker, initialThreads, initialMessages, jumpThreadId, onJumpConsumed, onThreadCreated, initialInputValue, onInitialInputConsumed }: WorkerChatTabProps) {
  const [threads, setThreads] = useState<WorkerThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreads[0]?.id ?? null
  );
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  // Always fetch fresh on mount — initialThreads from parent can be stale if threads
  // were created in a previous session or before the parent's fetch completed.
  useEffect(() => {
    fetch(`/api/work/threads?agent_id=${worker.id}`)
      .then(r => r.json())
      .then(data => {
        const serverThreads: WorkerThread[] = data.threads ?? [];
        setThreads(prev => {
          // Keep optimistic (locally-created) threads not yet in server response
          const serverIds = new Set(serverThreads.map(t => t.id));
          const optimistic = prev.filter(t => !serverIds.has(t.id));
          return [...optimistic, ...serverThreads];
        });
      })
      .catch(() => {});
  }, [worker.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a jump is requested from outside (e.g. Activity tab "Open in chat"),
  // open that thread — even if it's not in the sidebar list (routine output threads).
  useEffect(() => {
    if (!jumpThreadId) return;
    setActiveThreadId(jumpThreadId);
    setPendingMessage(null);
    // If the thread isn't in the list (it's a routine output thread), add a placeholder
    setThreads(prev => {
      if (prev.some(t => t.id === jumpThreadId)) return prev;
      return [{ id: jumpThreadId, title: 'Routine output', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), agent_id: worker.id }, ...prev];
    });
    onJumpConsumed?.();
  }, [jumpThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      onThreadCreated?.(newThread);
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

  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Cache thread data so switching back to a thread is instant.
  // Pre-populate with SSR messages for the first thread to eliminate the loading skeleton entirely.
  const initialCacheMap = useMemo(() => {
    const map = new Map<string, { messages: ChatMessage[]; artifacts: DocumentArtifact[]; artifactThreadMap: Map<string, string> }>();
    if (initialMessages && initialThreads[0]) {
      const tid = initialThreads[0].id;
      const arts: DocumentArtifact[] = [];
      const artMap = new Map<string, string>();
      initialMessages.forEach(msg => {
        const meta = msg.metadata as Record<string, unknown> | null;
        const ids = meta?.artifact_ids as string[] | undefined;
        const artifactMeta = meta?.artifact_meta as Record<string, { title: string; type: string }> | undefined;
        const completionThreadId = meta?.completion_thread_id as string | undefined;
        if (ids) {
          ids.forEach(id => {
            if (completionThreadId) artMap.set(id, completionThreadId);
            if (artifactMeta?.[id] && !arts.some(a => a.id === id)) {
              arts.push({ id, title: artifactMeta[id].title, type: artifactMeta[id].type as import('@/lib/types/inbox').DeliverableType, generated_at: msg.created_at ?? '' });
            }
          });
        }
      });
      map.set(tid, { messages: initialMessages, artifacts: arts, artifactThreadMap: artMap });
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const threadCacheRef = useRef(initialCacheMap);

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden">
      {/* Thread list — collapsible */}
      <div
        className="flex-shrink-0 border-r border-neutral-100 flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out"
        style={{ width: sidebarOpen ? 200 : 0 }}
      >
        {/* Inner wrapper keeps content full-width so it slides cleanly */}
        <div className="w-[200px] flex flex-col flex-1 overflow-hidden">
          <div className="px-3.5 py-2.5 flex items-center justify-between flex-shrink-0 border-b border-neutral-100">
            <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider whitespace-nowrap">
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
            initialInputValue={initialInputValue}
            onInitialInputConsumed={onInitialInputConsumed}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(v => !v)}
            onArtifactOpen={() => setSidebarOpen(false)}
            threadCache={threadCacheRef}
          />
        ) : (
          <WorkerChatHome
            worker={worker}
            starters={starters}
            onSend={handleStarterClick}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(v => !v)}
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
  onSend: (message: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

function WorkerChatHome({ worker, starters, onSend, sidebarOpen, onToggleSidebar }: WorkerChatHomeProps) {
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputValue]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim()) { onSend(inputValue.trim()); setInputValue(''); }
    }
  }

  function handleSubmit() {
    if (inputValue.trim()) { onSend(inputValue.trim()); setInputValue(''); }
  }

  const avatarSrc = worker.worker_role ? (ROLE_AVATARS[worker.worker_role] ?? null) : null;
  const roleLabel = worker.worker_role ? (ROLE_LABELS[worker.worker_role] ?? null) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sidebar toggle */}
      <div className="flex-shrink-0 flex items-center px-3 pt-2">
        <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
      </div>
      {/* Centered starters */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {/* Avatar */}
        <div className="mb-4 flex flex-col items-center gap-2">
          {avatarSrc ? (
            <img src={avatarSrc} alt={worker.name} className="w-16 h-16 rounded-2xl object-cover object-top shadow-sm" />
          ) : null}
          <div className="text-center">
            <p className="text-[15px] font-semibold text-neutral-800">{worker.name}</p>
            {roleLabel && <p className="text-[11.5px] text-neutral-400">{roleLabel}</p>}
          </div>
        </div>
        <p className="text-[13px] text-neutral-500 mb-6 text-center max-w-[360px]">
          {worker.description ?? `Start a conversation with ${worker.name}`}
        </p>

        {starters.length > 0 && (
          <div className="w-full max-w-[480px] rounded-2xl border border-neutral-100 overflow-hidden shadow-sm">
            {starters.map((starter, i) => (
              <div key={i}>
                <button
                  onClick={() => onSend(starter)}
                  className="w-full text-left px-4 py-3 text-[13px] text-neutral-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                >
                  {starter}
                </button>
                {i < starters.length - 1 && <div className="border-t border-neutral-100" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input bar — same as ActiveWorkerChat */}
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

// ─── Active chat ──────────────────────────────────────────────────────────────

interface ThreadCacheEntry {
  messages: ChatMessage[];
  artifacts: DocumentArtifact[];
  artifactThreadMap: Map<string, string>;
}

interface ActiveWorkerChatProps {
  thread: WorkerThread;
  worker: Worker;
  pendingMessage: string | null;
  onPendingConsumed: () => void;
  onTitleUpdate: (id: string, title: string) => void;
  initialInputValue?: string | null;
  onInitialInputConsumed?: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onArtifactOpen?: () => void;
  threadCache: React.MutableRefObject<Map<string, ThreadCacheEntry>>;
}

function ActiveWorkerChat({
  thread,
  worker,
  pendingMessage,
  onPendingConsumed,
  onTitleUpdate,
  initialInputValue,
  onInitialInputConsumed,
  sidebarOpen,
  onToggleSidebar,
  onArtifactOpen,
  threadCache,
}: ActiveWorkerChatProps) {
  const cached = threadCache.current.get(thread.id);
  const [messages, setMessages] = useState<ChatMessage[]>(cached?.messages ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolStatus[]>([]);
  const [inputValue, setInputValue] = useState('');

  // Artifact panel state
  const [openArtifact, setOpenArtifact] = useState<{ artifactId: string; threadId: string } | null>(null);
  const [panelWidth, setPanelWidth] = useState(360);

  function handlePanelResize(delta: number) {
    setPanelWidth(prev => Math.min(540, Math.max(280, prev - delta)));
  }
  const [artifactThreadMap, setArtifactThreadMap] = useState<Map<string, string>>(cached?.artifactThreadMap ?? new Map());
  const [threadArtifacts, setThreadArtifacts] = useState<DocumentArtifact[]>(cached?.artifacts ?? []);
  // Ref tracks extra artifact metadata from streaming (artifact_ready events) synchronously,
  // bypassing render timing so chips always show correct titles without waiting for state flush.
  const streamedArtifactMetaRef = useRef<Map<string, { title: string; type: string }>>(new Map());

  const artifactVersionMap = useMemo(() => {
    const map = new Map<string, { title: string; versionLabel: string; type?: string }>();
    threadArtifacts.forEach((a, i) => {
      if (a.id) map.set(a.id, { title: a.title, versionLabel: `v${i + 1}`, type: a.type });
    });
    // Merge streamed metadata — overrides missing entries from state
    streamedArtifactMetaRef.current.forEach((meta, id) => {
      if (!map.has(id)) map.set(id, { title: meta.title, versionLabel: '', type: meta.type });
    });
    return map;
  }, [threadArtifacts]);

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
    const isCached = threadCache.current.has(thread.id);
    if (!isCached) {
      setMessages([]);
      setIsLoading(true);
    }
    setIsStreaming(false);
    setStreamingText('');
    setStreamingTools([]);
    setOpenArtifact(null);
    streamedArtifactMetaRef.current = new Map();

    const controller = new AbortController();
    fetch(`/api/work/threads/${thread.id}/chat`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (!mountedRef.current) return;
        const msgs: ChatMessage[] = data.messages ?? [];
        const arts: DocumentArtifact[] = data.thread?.artifacts ?? [];
        setMessages(msgs);

        // Hydrate artifact metadata from historical message metadata so chips show correct titles
        const historicalArtifacts: DocumentArtifact[] = [...arts];
        msgs.forEach(msg => {
          const meta = msg.metadata as Record<string, unknown> | null;
          const ids = meta?.artifact_ids as string[] | undefined;
          const artifactMeta = meta?.artifact_meta as Record<string, { title: string; type: string }> | undefined;
          if (ids && artifactMeta) {
            ids.forEach(id => {
              if (!historicalArtifacts.some(a => a.id === id) && artifactMeta[id]) {
                historicalArtifacts.push({
                  id,
                  title: artifactMeta[id].title,
                  type: artifactMeta[id].type as import('@/lib/types/inbox').DeliverableType,
                  generated_at: msg.created_at ?? new Date().toISOString(),
                });
              }
            });
          }
        });
        setThreadArtifacts(historicalArtifacts);

        // Build artifactThreadMap: default threadId, override with completion_thread_id
        const map = new Map<string, string>();
        arts.forEach(a => { if (a.id) map.set(a.id, thread.id); });
        msgs.forEach(msg => {
          const meta = msg.metadata as Record<string, unknown> | null;
          const completionThreadId = meta?.completion_thread_id as string | undefined;
          const artifactIds = meta?.artifact_ids as string[] | undefined;
          if (completionThreadId && artifactIds) {
            artifactIds.forEach(id => map.set(id, completionThreadId));
          }
        });
        setArtifactThreadMap(map);
        setIsLoading(false);
        // Save to cache for instant re-display on thread switch
        threadCache.current.set(thread.id, { messages: msgs, artifacts: historicalArtifacts, artifactThreadMap: map });
      })
      .catch(err => {
        if (err.name !== 'AbortError' && mountedRef.current) setIsLoading(false);
      });
    return () => controller.abort();
  }, [thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleViewArtifact(artifactId: string) {
    const mapped = artifactThreadMap.get(artifactId);
    // '__worker_lookup__' sentinel means artifact is from a worker task thread — use worker-level lookup
    const tid = (!mapped || mapped === '__worker_lookup__') ? thread.id : mapped;
    setOpenArtifact({ artifactId, threadId: tid });
    // Collapse conversation list to give space to the artifact panel
    if (sidebarOpen) onArtifactOpen?.();
  }

  function handleNewVersion(title: string) {
    setOpenArtifact(null);
    const prefix = `Revise "${title}": `;
    setInputValue(prefix);
    setTimeout(() => {
      textareaRef.current?.focus();
      const el = textareaRef.current;
      if (el) { el.selectionStart = el.selectionEnd = el.value.length; }
    }, 50);
  }

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

  // Consume prefill from "New version" button in documents tab
  useEffect(() => {
    if (!initialInputValue) return;
    setInputValue(initialInputValue);
    onInitialInputConsumed?.();
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    }, 50);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      let accArtifactIds: string[] = [];
      // Extra metadata for artifact chips that came via get_worker_document
      const accArtifactMeta: Map<string, { title: string; versionLabel: string; type?: string }> = new Map();
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

            } else if (event.type === 'text_set') {
              accText = event.content ?? accText;
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

            } else if (event.type === 'artifact_ready') {
              // Worker retrieved a document — accumulate ID + metadata for chip rendering
              const art = event.artifact as { id: string; title: string; type: string } | undefined;
              if (art?.id) {
                accArtifactIds = [...accArtifactIds, art.id];
                // Write to ref synchronously — no render timing issues
                streamedArtifactMetaRef.current.set(art.id, { title: art.title, type: art.type });
                // Force artifactVersionMap to rebuild by nudging threadArtifacts
                setThreadArtifacts(prev => {
                  if (prev.some(a => a.id === art.id)) return prev;
                  return [...prev, { id: art.id, title: art.title, type: art.type as import('@/lib/types/inbox').DeliverableType, generated_at: new Date().toISOString() }];
                });
                setArtifactThreadMap(prev => {
                  if (prev.has(art.id)) return prev;
                  const next = new Map(prev);
                  next.set(art.id, '__worker_lookup__');
                  return next;
                });
              }

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
              // Collect artifact metadata from ref so chips render correctly on future loads
              const artifactMeta: Record<string, { title: string; type: string }> = {};
              accArtifactIds.forEach(id => {
                const m = streamedArtifactMetaRef.current.get(id);
                if (m) artifactMeta[id] = m;
              });
              const assistantMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: accText,
                created_at: new Date().toISOString(),
                metadata: {
                  tool_calls: accTools.map(t => ({ name: t.name, summary: t.summary })),
                  ...(accArtifactIds.length > 0 ? {
                    artifact_ids: accArtifactIds,
                    ...(Object.keys(artifactMeta).length > 0 ? { artifact_meta: artifactMeta } : {}),
                  } : {}),
                },
              };
              if (mountedRef.current) setMessages(prev => {
                const next = [...prev, assistantMsg];
                // Keep cache fresh so switching threads and back shows latest
                const existing = threadCache.current.get(thread.id);
                if (existing) threadCache.current.set(thread.id, { ...existing, messages: next });
                return next;
              });
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

  const avatarSrc = worker.worker_role ? (ROLE_AVATARS[worker.worker_role] ?? null) : null;
  const roleLabel = worker.worker_role ? (ROLE_LABELS[worker.worker_role] ?? null) : null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Chat column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Chat header */}
        <div className="flex-shrink-0 flex items-center gap-2.5 px-3 py-3 border-b border-neutral-100">
          <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
          {avatarSrc ? (
            <img src={avatarSrc} alt={worker.name} className="w-7 h-7 rounded-lg object-cover object-top flex-shrink-0" />
          ) : null}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-neutral-800 leading-tight">{worker.name}</p>
            {roleLabel && <p className="text-[10.5px] text-neutral-400 leading-tight">{roleLabel}</p>}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[660px] mx-auto px-6 py-8 space-y-6">
            {/* Show pending message immediately — don't wait for history load */}
            {isLoading && pendingMessage && (
              <ChatMessageBubble
                message={{ id: 'pending-optimistic', role: 'user', content: pendingMessage, created_at: new Date().toISOString() }}
                isLastAssistantMessage={false}
              />
            )}

            {isLoading && !pendingMessage && (
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
                  onViewArtifact={handleViewArtifact}
                  artifactVersionMap={artifactVersionMap}
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

      {/* Artifact panel resize handle */}
      {openArtifact && <ResizeHandle onResize={handlePanelResize} />}

      {/* Artifact side panel — slides in/out smoothly */}
      <div
        className="flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
        style={{ width: openArtifact ? panelWidth : 0 }}
      >
        {openArtifact && (
          <ArtifactPanel
            key={openArtifact.artifactId}
            artifactId={openArtifact.artifactId}
            threadId={openArtifact.threadId}
            onClose={() => setOpenArtifact(null)}
            onNewVersion={handleNewVersion}
          />
        )}
      </div>
    </div>
  );
}
