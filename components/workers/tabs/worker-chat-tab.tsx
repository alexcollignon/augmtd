'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { IconButton } from '@/components/ui';
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

function ResizeHandle({ panelRef, onResizeEnd, disabled }: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  onResizeEnd: (width: number) => void;
  disabled?: boolean;
}) {
  function handleMouseDown(e: React.MouseEvent) {
    if (disabled || !panelRef.current) return;
    e.preventDefault();
    const panel = panelRef.current;
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;
    panel.style.transition = 'none';

    function onMove(ev: MouseEvent) {
      const next = Math.min(540, Math.max(280, startWidth - (ev.clientX - startX)));
      panel.style.width = `${next}px`;
    }
    function onUp(ev: MouseEvent) {
      const finalWidth = Math.min(540, Math.max(280, startWidth - (ev.clientX - startX)));
      panel.style.transition = '';
      onResizeEnd(finalWidth);
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
import { WorkerMentionInput, type WorkerMention } from '@/components/workers/worker-mention-input';
import { WorkerHomeView } from '@/components/workers/worker-home-view';
import type { Worker, WorkerThread } from '@/app/workers/workers-page-client';

interface WorkerChatTabProps {
  worker: Worker;
  initialThreads: WorkerThread[];
  initialMessages?: ChatMessage[];
  initialThreadId?: string | null;
  jumpThreadId?: string | null;
  onJumpConsumed?: () => void;
  onActiveThreadChange?: (threadId: string | null) => void;
  onThreadCreated?: (thread: WorkerThread) => void;
  onThreadDeleted?: (threadId: string) => void;
  initialInputValue?: string | null;
  onInitialInputConsumed?: () => void;
}

export function WorkerChatTab({ worker, initialThreads, initialMessages, initialThreadId, jumpThreadId, onJumpConsumed, onActiveThreadChange, onThreadCreated, onThreadDeleted, initialInputValue, onInitialInputConsumed }: WorkerChatTabProps) {
  const [threads, setThreads] = useState<WorkerThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId ?? null
  );
  const [showHome, setShowHome] = useState<boolean>(!initialThreadId);
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
    setShowHome(false);
    setPendingMessage(null);
    // If the thread isn't in the list (it's a routine output thread), add a placeholder
    setThreads(prev => {
      if (prev.some(t => t.id === jumpThreadId)) return prev;
      return [{ id: jumpThreadId, title: 'Routine output', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), agent_id: worker.id }, ...prev];
    });
    onJumpConsumed?.();
  }, [jumpThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when active thread changes so it can update the URL
  useEffect(() => {
    onActiveThreadChange?.(activeThreadId);
  }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeThread = threads.find(t => t.id === activeThreadId) ?? null;

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
      setShowHome(false);
      onThreadCreated?.(newThread);
      return thread.id;
    } catch {
      return null;
    }
  }

  async function handleDeleteThread(id: string) {
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(null);
    onThreadDeleted?.(id);
    await fetch(`/api/work/threads/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  function handleUpdateThreadTitle(id: string, title: string) {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, title } : t));
  }

  async function handleStarterClick(starter: string, briefingText?: string) {
    const threadId = await handleCreateThread(starter);
    if (!threadId) return;

    // If the reply came from the home screen, save the briefing as the first assistant
    // message so it's visible in the thread and the AI has it as context.
    if (briefingText?.trim()) {
      // Timestamp the briefing clearly before the first user message so DB
      // ordering stays correct on reload (the user-message insert and this seed
      // race; a buffer beats clock skew + insert latency).
      const briefingCreatedAt = new Date(Date.now() - 5000).toISOString();
      const briefingMsg = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: briefingText.trim(),
        created_at: briefingCreatedAt,
      };
      // Seed local cache immediately so it renders without waiting for DB
      threadCacheRef.current.set(threadId, {
        messages: [briefingMsg],
        artifacts: [],
        artifactThreadMap: new Map(),
      });
      // Persist to DB in background (with the same timestamp for stable ordering)
      fetch(`/api/work/threads/${threadId}/seed-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: briefingText.trim(), created_at: briefingCreatedAt }),
      }).catch(() => {});
    }

    setPendingMessage(starter);
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
            <IconButton size="sm" onClick={() => handleCreateThread()} title="New conversation">
              <PlusIcon className="w-3.5 h-3.5" />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto">
            <WorkerThreadList
              threads={threads}
              activeThreadId={showHome ? null : activeThreadId}
              onSelect={(id) => { setActiveThreadId(id); setShowHome(false); setPendingMessage(null); }}
              onDelete={handleDeleteThread}
            />
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {showHome ? (
          <WorkerHomeView
            worker={worker}
            onSend={(text, briefing) => { handleStarterClick(text, briefing); }}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(v => !v)}
          />
        ) : activeThread ? (
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
            onGoHome={() => setShowHome(true)}
            threadCache={threadCacheRef}
          />
        ) : null}
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
  onGoHome?: () => void;
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
  onGoHome,
  threadCache,
}: ActiveWorkerChatProps) {
  const cached = threadCache.current.get(thread.id);
  const [messages, setMessages] = useState<ChatMessage[]>(cached?.messages ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolStatus[]>([]);
  const [streamingThinking, setStreamingThinking] = useState('');
  const [thinkingDone, setThinkingDone] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // Artifact panel state
  const [openArtifact, setOpenArtifact] = useState<{ artifactId: string; threadId: string } | null>(null);
  const [panelWidth, setPanelWidth] = useState(360);
  const panelRef = useRef<HTMLDivElement>(null);
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
        // Merge, don't clobber: this mount GET races an in-flight first-message
        // send (home → new thread). If the just-sent user message (or the seeded
        // briefing) isn't persisted server-side yet, preserve the optimistic copy
        // instead of overwriting it away. Ordered by created_at.
        setMessages(prev => {
          if (prev.length === 0) return msgs;
          const serverKeys = new Set(msgs.map(m => `${m.role}:${m.content}`));
          const pending = prev.filter(m => !serverKeys.has(`${m.role}:${m.content}`));
          if (pending.length === 0) return msgs;
          return [...msgs, ...pending].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        });

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

  const handleSubmit = useCallback(async (message: string, mentions?: WorkerMention[]) => {
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
    setStreamingThinking('');
    setThinkingDone(false);

    const ac = new AbortController();
    streamAbortRef.current = ac;

    try {
      const res = await fetch(`/api/work/threads/${thread.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message, agentId: worker.id, ...(mentions && mentions.length ? { mentions } : {}) }),
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

            if (event.type === 'thinking_delta') {
              setStreamingThinking(prev => prev + event.delta);

            } else if (event.type === 'thinking_done') {
              setThinkingDone(true);

            } else if (event.type === 'text_clear') {
              accText = '';
              setStreamingText('');

            } else if (event.type === 'text') {
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
              if (mountedRef.current) {
                // Turn off streaming in the same batch as adding the message so there is
                // never a frame where both the settled bubble and StreamingMessage are visible.
                setIsStreaming(false);
                setStreamingText('');
                setStreamingTools([]);
                setStreamingThinking('');
                setThinkingDone(false);
                setMessages(prev => {
                  const next = [...prev, assistantMsg];
                  // Keep cache fresh so switching threads and back shows latest
                  const existing = threadCache.current.get(thread.id);
                  if (existing) threadCache.current.set(thread.id, { ...existing, messages: next });
                  return next;
                });
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

  const avatarSrc = worker.worker_role ? (ROLE_AVATARS[worker.worker_role] ?? null) : null;
  const roleLabel = worker.worker_role ? (ROLE_LABELS[worker.worker_role] ?? null) : null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Chat column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Chat header */}
        <div className="flex-shrink-0 flex items-center gap-2.5 px-3 py-3 border-b border-neutral-100">
          <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
          <button
            onClick={onGoHome}
            className="flex items-center gap-2 min-w-0 hover:opacity-70 transition-opacity"
            title="Back to home"
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt={worker.name} className="w-7 h-7 rounded-lg object-cover object-top flex-shrink-0" />
            ) : null}
            <div className="min-w-0 text-left">
              <p className="text-[13px] font-semibold text-neutral-800 leading-tight">{worker.name}</p>
              {roleLabel && <p className="text-[10.5px] text-neutral-400 leading-tight">{roleLabel}</p>}
            </div>
          </button>
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

            {isStreaming && <StreamingMessage text={streamingText} tools={streamingTools} thinking={streamingThinking || undefined} thinkingDone={thinkingDone} />}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-4 pb-4 pt-2">
          <div className="max-w-[660px] mx-auto">
            <WorkerMentionInput
              onSubmit={(text, mentions) => handleSubmit(text, mentions)}
              disabled={isStreaming}
              placeholder={`Message ${worker.name}…  (@ to mention a coworker, task, or document)`}
              prefill={inputValue || null}
              onPrefillConsumed={() => setInputValue('')}
            />
            <p className="mt-1.5 text-center text-[11px] text-neutral-400">
              Enter to send · Shift+Enter for new line · @ to mention
            </p>
          </div>
        </div>
      </div>

      {/* Artifact panel resize handle */}
      {openArtifact && <ResizeHandle panelRef={panelRef} onResizeEnd={setPanelWidth} />}

      {/* Artifact side panel — slides in/out smoothly */}
      <div
        ref={panelRef}
        className="flex-shrink-0 overflow-x-hidden transition-[width] duration-300 ease-in-out"
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
