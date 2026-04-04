'use client';

// ─── Phase 2: Chat engine + message streaming ──────────────────────────────
// Phase 3 adds: KB citation chips
// Phase 4 adds: artifact panel
// Phase 5 adds: @ mentions + file attachments
// Phase 6 adds: process integration + polish

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRightIcon, PlusIcon, RectangleStackIcon, Square2StackIcon } from '@heroicons/react/24/outline';
import SidebarNav from '@/components/sidebar-nav';
import { ChatThreadSidebar, ChatThread } from '@/components/work/chat-thread-sidebar';
import { ChatEmptyState } from '@/components/work/chat-empty-state';
import { ChatInputBar, SourceId, AttachmentChip, MentionChip, MENTION_ICONS, MENTION_COLORS } from '@/components/work/chat-input-bar';
import { ChatMessageBubble, StreamingMessage, ChatMessage, ToolStatus } from '@/components/work/chat-message';
import { ClarificationData } from '@/components/work/clarification-widget';
import OnboardingModal from '@/components/onboarding-modal';
import { DocumentArtifact, ExecutionPlan } from '@/lib/types/inbox';
import { ChatArtifactPanel } from '@/components/work/chat-artifact-panel';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkThread extends ChatThread {
  plan: ExecutionPlan | null;
  artifact: DocumentArtifact | null;
  artifacts?: DocumentArtifact[];
  status: string;
  created_at: string;
  auto_generated?: boolean;
  saved_workflow_id?: string;
  is_generating?: boolean;
  process_id?: string | null;
  process_step_index?: number | null;
}

export interface WorkPageClientProps {
  userId?: string;
  userEmail?: string;
  userFullName?: string;
  hasCompletedOnboarding: boolean;
  initialThreads: WorkThread[];
  initialActiveThreadId?: string | null;
  initialChatInput?: string | null;
  initialSavedWorkflows?: Array<{ id: string; name: string; prompt: string }>;
  processStepContext?: {
    processStep?: string;
    processId?: string;
    stepTitle?: string;
    stepDesc?: string;
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkPageClient({
  userId,
  userEmail,
  userFullName,
  hasCompletedOnboarding,
  initialThreads,
  initialActiveThreadId,
  initialChatInput,
  initialSavedWorkflows,
  processStepContext,
}: WorkPageClientProps) {
  const router = useRouter();

  const [threads, setThreads] = useState<WorkThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId || null
  );
  const [pendingInput, setPendingInput] = useState<string | null>(initialChatInput || null);
  const [pendingMentions, setPendingMentions] = useState<MentionChip[]>([]);
  const [pendingFiles, setPendingFiles] = useState<Array<{ id: string; file: File }>>([]);
  const [pendingAttachmentMeta, setPendingAttachmentMeta] = useState<Array<{ id: string; name: string }>>([]);
  const [isAttachUploading, setIsAttachUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // ── Realtime: keep thread list in sync ───────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`work_threads:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'work_threads',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const t = payload.new as any;
          const newThread: WorkThread = {
            id: t.id, title: t.title, plan: t.plan ?? null,
            artifact: t.artifact ?? null, artifacts: t.artifacts ?? [],
            status: t.status, created_at: t.created_at, updated_at: t.updated_at,
            auto_generated: t.auto_generated, saved_workflow_id: t.saved_workflow_id,
            is_generating: t.is_generating, process_id: t.process_id ?? null,
            process_step_index: t.process_step_index ?? null, process_title: null,
          };
          setThreads(prev => prev.some(x => x.id === t.id) ? prev : [newThread, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          const t = payload.new as any;
          setThreads(prev => prev.map(x => x.id === t.id
            ? { ...x, title: t.title, artifacts: t.artifacts ?? x.artifacts,
                artifact: t.artifact ?? x.artifact, updated_at: t.updated_at,
                is_generating: t.is_generating, status: t.status }
            : x
          ));
        } else if (payload.eventType === 'DELETE') {
          const id = (payload.old as any).id;
          setThreads(prev => prev.filter(x => x.id !== id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // ── Thread CRUD ──────────────────────────────────────────────────────────

  function handlePreAttach(files: File[]) {
    setPendingFiles(prev => [...prev, ...files.map(f => ({ id: crypto.randomUUID(), file: f }))]);
  }

  function handlePreRemoveAttachment(chipId: string) {
    setPendingFiles(prev => prev.filter(p => p.id !== chipId));
  }

  async function handleCreateThread(message?: string, _sources?: SourceId[], mentions?: MentionChip[]) {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const title = message
        ? message.slice(0, 60) + (message.length > 60 ? '…' : '')
        : 'New chat';

      const res = await fetch('/api/work/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          processId: processStepContext?.processId ?? undefined,
          processStepIndex: processStepContext?.processStep
            ? Number(processStepContext.processStep)
            : undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to create thread');
      const { thread: createdThread } = await res.json();
      const id = createdThread?.id;

      const newThread: WorkThread = {
        id,
        title,
        plan: null,
        artifact: null,
        artifacts: [],
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        process_title: null,
      };

      // Switch UI immediately — don't wait for upload
      const filesToUpload = pendingFiles;
      setPendingFiles([]);
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(id);
      if (message) setPendingInput(message);
      if (mentions?.length) setPendingMentions(mentions);

      if (filesToUpload.length > 0 && id) {
        // Upload in background; block auto-send until metadata is ready
        setIsAttachUploading(true);
        const formData = new FormData();
        for (const { file } of filesToUpload) formData.append('file', file);
        fetch(`/api/work/threads/${id}/chat-attach`, { method: 'POST', body: formData })
          .then(async (uploadRes) => {
            if (uploadRes.ok) {
              const { attachments } = await uploadRes.json();
              const meta = (attachments as Array<{ chatAttachId: string; filename: string }>).map(a => ({ id: a.chatAttachId, name: a.filename }));
              setPendingAttachmentMeta(meta);
            }
            setIsAttachUploading(false);
          })
          .catch(() => { setIsAttachUploading(false); });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRename(id: string, title: string) {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    await fetch(`/api/work/threads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }

  async function handleDelete(id: string) {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) {
      setActiveThreadId(null);
      setPendingInput(null);
      setPendingMentions([]);
    }
    await fetch(`/api/work/threads/${id}`, { method: 'DELETE' });
  }

  function handleSelectThread(id: string) {
    setActiveThreadId(id);
    setPendingInput(null);
    setPendingMentions([]);
    setPendingFiles([]);
    setPendingAttachmentMeta([]);
    setIsAttachUploading(false);
    setArtifactPanelOpen(false);
    setActiveArtifactId(null);
  }

  function handleViewArtifact(id: string) {
    setActiveArtifactId(id);
    setArtifactPanelOpen(true);
  }

  function handleThreadTitleUpdate(id: string, title: string) {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  function handleThreadArtifactsUpdate(id: string, artifacts: DocumentArtifact[]) {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, artifacts } : t)));
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-neutral-50 overflow-hidden">
      <SidebarNav userEmail={userEmail} />

      {/* Thread sidebar — floating card */}
      <div className="w-[220px] flex-shrink-0 flex flex-col bg-neutral-50 p-2">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {/* Sidebar header: nav tabs */}
          <div className="flex items-center gap-1 px-3 py-2.5 border-b border-neutral-100 flex-shrink-0">
            <Link
              href="/work"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-indigo-50 text-indigo-700"
            >
              <Square2StackIcon className="w-3 h-3" />
              Chat
            </Link>
            <Link
              href="/processes"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
            >
              <RectangleStackIcon className="w-3 h-3" />
              Processes
            </Link>
          </div>

          {/* New chat — pinned above thread list */}
          <div className="px-2 pt-2 flex-shrink-0">
            <button
              onClick={() => { setActiveThreadId(null); setPendingInput(null); setPendingMentions([]); setPendingFiles([]); setPendingAttachmentMeta([]); setIsAttachUploading(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5 flex-shrink-0" />
              New chat
            </button>
          </div>

          {/* Thread list */}
          <ChatThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={handleSelectThread}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
      </div>

      {/* Chat column — floating card */}
      <div className="flex-1 min-w-0 flex flex-col bg-neutral-50 pl-2 pt-2 pb-2 overflow-hidden">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {activeThread ? (
            <ActiveChatView
              thread={activeThread}
              pendingInput={pendingInput}
              pendingMentions={pendingMentions}
              pendingAttachmentMeta={pendingAttachmentMeta}
              isAttachUploading={isAttachUploading}
              onPendingInputConsumed={() => { setPendingInput(null); setPendingMentions([]); setPendingAttachmentMeta([]); }}
              onTitleUpdate={handleThreadTitleUpdate}
              onArtifactsUpdate={handleThreadArtifactsUpdate}
              onViewArtifact={handleViewArtifact}
              onArtifactReady={handleViewArtifact}
            />
          ) : (
            <ChatEmptyState
              onStart={handleCreateThread}
              userFirstName={userFullName}
              savedWorkflows={initialSavedWorkflows}
              onAttach={handlePreAttach}
              onRemoveAttachment={handlePreRemoveAttachment}
              attachments={pendingFiles.map(({ id, file }) => ({ id, name: file.name, size: file.size }))}
            />
          )}
        </div>
      </div>

      {/* Artifact panel */}
      <div
        className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ${
          artifactPanelOpen && activeThread ? 'w-[440px]' : 'w-0'
        }`}
      >
        {activeThread && activeThread.artifacts && activeThread.artifacts.length > 0 && (
          <ChatArtifactPanel
            threadId={activeThread.id}
            artifacts={activeThread.artifacts}
            activeArtifactId={activeArtifactId}
            onClose={() => { setArtifactPanelOpen(false); setActiveArtifactId(null); }}
            onArtifactsChange={(updated) => handleThreadArtifactsUpdate(activeThread.id, updated)}
          />
        )}
      </div>

      {!hasCompletedOnboarding && (
        <OnboardingModal isOpen onClose={() => router.refresh()} />
      )}
    </div>
  );
}

// ─── Active chat view ─────────────────────────────────────────────────────────

interface ActiveChatViewProps {
  thread: WorkThread;
  pendingInput: string | null;
  pendingMentions?: MentionChip[];
  pendingAttachmentMeta?: Array<{ id: string; name: string }>;
  isAttachUploading?: boolean;
  onPendingInputConsumed: () => void;
  onTitleUpdate: (id: string, title: string) => void;
  onArtifactsUpdate: (id: string, artifacts: DocumentArtifact[]) => void;
  onViewArtifact: (id: string) => void;
  onArtifactReady?: (artifactId: string) => void;
}

function ActiveChatView({
  thread,
  pendingInput,
  pendingMentions = [],
  pendingAttachmentMeta = [],
  isAttachUploading = false,
  onPendingInputConsumed,
  onTitleUpdate,
  onArtifactsUpdate,
  onViewArtifact,
  onArtifactReady,
}: ActiveChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolStatus[]>([]);
  const [streamingClarification, setStreamingClarification] = useState<ClarificationData | null>(null);
  const [chatAttachments, setChatAttachments] = useState<AttachmentChip[]>([]);
  const [stepCompleted, setStepCompleted] = useState(false);
  const [stepCompleting, setStepCompleting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasSentPending = useRef(false);
  const lastUserInputRef = useRef<{ content: string; mentions: MentionChip[] } | null>(null);

  const isProcessThread = !!(thread.process_id && thread.process_step_index != null);
  const hasArtifacts = (thread.artifacts?.length ?? 0) > 0;
  const showCompleteStep = isProcessThread && hasArtifacts && !stepCompleted;

  // Load messages when thread changes
  useEffect(() => {
    hasSentPending.current = false;
    setMessages([]);
    setIsLoading(true);
    setIsStreaming(false);
    setStreamingText('');
    setStreamingTools([]);
    setStreamingClarification(null);

    const controller = new AbortController();

    fetch(`/api/work/threads/${thread.id}/chat`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        setMessages(data.messages || []);
        setIsLoading(false);
      })
      .catch((err) => { if (err.name !== 'AbortError') setIsLoading(false); });

    return () => controller.abort();
  }, [thread.id]);

  // Attachment handlers
  async function handleAttach(files: File[]) {
    const formData = new FormData();
    for (const f of files) formData.append('file', f);
    try {
      const res = await fetch(`/api/work/threads/${thread.id}/chat-attach`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) return;
      const { attachments } = await res.json();
      setChatAttachments(prev => [
        ...prev,
        ...attachments.map((a: { chatAttachId: string; filename: string; size: number }) => ({
          id: a.chatAttachId,
          name: a.filename,
          size: a.size,
        })),
      ]);
    } catch { /* ignore */ }
  }

  async function handleRemoveAttachment(id: string) {
    setChatAttachments(prev => prev.filter(a => a.id !== id));
    await fetch(`/api/work/threads/${thread.id}/chat-attach?chatAttachId=${id}`, { method: 'DELETE' });
  }

  // Auto-send pendingInput once messages are loaded and it hasn't been sent yet
  useEffect(() => {
    if (!pendingInput || isLoading || isStreaming || isAttachUploading || hasSentPending.current) return;
    hasSentPending.current = true;
    onPendingInputConsumed();
    handleSubmit(pendingInput, ['kb', 'inbox', 'calendar', 'processes', 'desk'], pendingMentions, pendingAttachmentMeta);
  }, [pendingInput, isLoading, isAttachUploading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingTools]);

  function handleRetry() {
    if (!lastUserInputRef.current || isStreaming) return;
    const { content, mentions } = lastUserInputRef.current;
    setMessages(prev => {
      const last = prev[prev.length - 1];
      const isError = last?.metadata?.error;
      const isGenerationFailure = last?.role === 'assistant' &&
        last?.metadata?.tool_calls?.some(t => t.summary?.toLowerCase().includes('failed')) &&
        (!last?.metadata?.artifact_ids || last.metadata.artifact_ids.length === 0);
      if (isError || isGenerationFailure) {
        const secondLast = prev[prev.length - 2];
        if (secondLast?.role === 'user') return prev.slice(0, -2);
        return prev.slice(0, -1);
      }
      return prev;
    });
    handleSubmit(content, ['kb', 'inbox', 'calendar', 'processes', 'desk'], mentions);
  }

  async function handleSubmit(message: string, sources: SourceId[], mentions: MentionChip[], extraAttachments?: Array<{ id: string; name: string }>) {
    if (isStreaming || !message.trim()) return;
    lastUserInputRef.current = { content: message, mentions };

    const currentAttachments = [
      ...chatAttachments.map(a => ({ id: a.id, name: a.name })),
      ...(extraAttachments ?? []),
    ];

    // Optimistic user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
      mentions: mentions.length > 0 ? mentions : undefined,
      metadata: currentAttachments.length > 0 ? { attachments: currentAttachments } : undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    setChatAttachments([]);
    setIsStreaming(true);
    setStreamingText('');
    setStreamingTools([]);

    try {
      const res = await fetch(`/api/work/threads/${thread.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message, sources, mentions, attachments: currentAttachments }),
      });

      if (!res.ok || !res.body) throw new Error('Stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accText = '';
      let accTools: ToolStatus[] = [];
      const accArtifactIds: string[] = [];
      const accCitations: string[] = [];
      let accClarification: ClarificationData | null = null;
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? ''; // keep any incomplete trailing line

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
                // Same tool firing again — update in place (merge into one chip)
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
              if (event.citations?.length) {
                for (const c of event.citations) {
                  if (!accCitations.includes(c)) accCitations.push(c);
                }
              }

            } else if (event.type === 'clarification_request') {
              accClarification = {
                question: event.question,
                sources: event.sources ?? [],
                options: event.options ?? [],
              };
              setStreamingClarification(accClarification);

            } else if (event.type === 'artifact_ready') {
              accArtifactIds.push(event.artifact.id);
              onArtifactReady?.(event.artifact.id);

            } else if (event.type === 'text_set') {
              // Server stripped XML tool call leak — replace accumulated text
              accText = event.content ?? '';
              setStreamingText(accText);

            } else if (event.type === 'title_update') {
              // Auto-rename arrives asynchronously (fire-and-forget on server)
              if (event.title) onTitleUpdate(thread.id, event.title);

            } else if (event.type === 'error') {
              throw new Error('stream_error');

            } else if (event.type === 'done') {
              // Finalise assistant message
              const assistantMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: accText,
                created_at: new Date().toISOString(),
                metadata: {
                  tool_calls: accTools.map(t => ({ name: t.name, summary: t.summary })),
                  artifact_ids: accArtifactIds,
                  citations: accCitations.length > 0 ? accCitations : undefined,
                  clarification: accClarification ?? undefined,
                },
              };
              setMessages(prev => [...prev, assistantMsg]);
              setStreamingText('');
              setStreamingTools([]);

              // Auto-rename: update sidebar title if the server sent a new one
              if (event.title) {
                onTitleUpdate(thread.id, event.title);
              }

              // Refresh thread artifacts if documents were generated
              if (accArtifactIds.length > 0) {
                fetch(`/api/work/threads/${thread.id}/chat`)
                  .then(r => r.json())
                  .then(data => {
                    if (data.thread?.artifacts) {
                      onArtifactsUpdate(thread.id, data.thread.artifacts);
                    }
                  })
                  .catch(() => {});
              }
            }
          } catch {
            // skip malformed event line
          }
        }
      }
    } catch (err) {
      console.error('[ActiveChatView] stream error:', err);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        created_at: new Date().toISOString(),
        metadata: { error: true },
      }]);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      setStreamingTools([]);
      setStreamingClarification(null);
    }
  }

  function handleClarificationConfirm(choices: { sources: string[]; options: Record<string, string> }) {
    const sourceList = choices.sources.length > 0
      ? `Sources to use: ${choices.sources.join(', ')}`
      : null;
    const optionList = Object.entries(choices.options).length > 0
      ? Object.entries(choices.options).map(([k, v]) => `${k}: ${v}`).join(', ')
      : null;
    const details = [sourceList, optionList].filter(Boolean).join('\n');
    const confirmMessage = `[CLARIFICATION CONFIRMED]\n${details}\nPlease proceed and generate the document now.`;
    handleSubmit(confirmMessage, ['kb', 'inbox', 'calendar', 'processes'], []);
  }

  async function handleCompleteStep() {
    if (!thread.process_id || thread.process_step_index == null || stepCompleting) return;
    const artifact = thread.artifacts?.[0];
    setStepCompleting(true);
    try {
      await fetch(`/api/processes/${thread.process_id}/steps/${thread.process_step_index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact: artifact?.content ?? null }),
      });
      setStepCompleted(true);
    } catch { /* non-fatal */ } finally {
      setStepCompleting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Process breadcrumb */}
      {isProcessThread && (
        <div className="flex items-center gap-2 px-6 py-2 bg-violet-50 border-b border-violet-100 flex-shrink-0">
          <Link
            href={`/processes/${thread.process_id}`}
            className="text-[12px] text-violet-600 hover:text-violet-800 transition-colors"
          >
            {thread.process_title || 'Process'}
          </Link>
          <ChevronRightIcon className="w-3 h-3 text-violet-400" />
          <span className="text-[12px] text-violet-700">
            Step {(thread.process_step_index ?? 0) + 1}
          </span>
          {stepCompleted && (
            <span className="ml-auto text-[12px] text-emerald-600 font-medium">✓ Step completed</span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[680px] mx-auto px-6 py-8 space-y-6">
          {isLoading && !pendingInput && (
            <div className="space-y-6 animate-pulse">
              {/* Assistant skeleton */}
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-neutral-100 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className="h-3 bg-neutral-100 rounded-full w-3/4" />
                  <div className="h-3 bg-neutral-100 rounded-full w-1/2" />
                </div>
              </div>
              {/* User skeleton */}
              <div className="flex justify-end">
                <div className="h-9 bg-neutral-100 rounded-2xl rounded-br-sm w-2/5" />
              </div>
              {/* Assistant skeleton */}
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-neutral-100 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className="h-3 bg-neutral-100 rounded-full w-5/6" />
                  <div className="h-3 bg-neutral-100 rounded-full w-2/3" />
                  <div className="h-3 bg-neutral-100 rounded-full w-2/5" />
                </div>
              </div>
            </div>
          )}

          {isLoading && pendingInput && (
            <div className="space-y-6">
              <div className="space-y-1.5">
                {(pendingMentions.length > 0 || pendingAttachmentMeta.length > 0) && (
                  <div className="flex justify-end">
                    <div className="flex flex-wrap justify-end gap-1 max-w-[75%]">
                      {pendingMentions.map((m) => {
                        const Icon = MENTION_ICONS[m.type];
                        const colors = MENTION_COLORS[m.type] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
                        return (
                          <span key={`${m.type}:${m.id}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11.5px] ${colors}`}>
                            {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}{m.label}
                          </span>
                        );
                      })}
                      {pendingAttachmentMeta.map((a) => (
                        <span key={`attach:${a.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11.5px] bg-neutral-50 text-neutral-600 border-neutral-200">
                          {a.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <div className="max-w-[75%] bg-neutral-100 rounded-2xl rounded-br-sm px-4 py-2.5">
                    <p className="text-[13.5px] text-neutral-800 leading-relaxed whitespace-pre-wrap">{pendingInput}</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-1 pt-1">
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {!isLoading && (
            <div key={thread.id} className="space-y-6 animate-prompt-in">
              {messages.length === 0 && !isStreaming && !pendingInput && (
                <div className="flex items-center justify-center h-24">
                  <p className="text-[13px] text-neutral-400">Start the conversation below</p>
                </div>
              )}

              {/* Show pending message in the gap between isLoading→false and the optimistic setMessages firing */}
              {pendingInput && messages.length === 0 && !isStreaming && (
                <div className="space-y-1.5">
                  {(pendingMentions.length > 0 || pendingAttachmentMeta.length > 0) && (
                    <div className="flex justify-end">
                      <div className="flex flex-wrap justify-end gap-1 max-w-[75%]">
                        {pendingMentions.map((m) => {
                          const Icon = MENTION_ICONS[m.type];
                          const colors = MENTION_COLORS[m.type] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
                          return (
                            <span key={`${m.type}:${m.id}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11.5px] ${colors}`}>
                              {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}{m.label}
                            </span>
                          );
                        })}
                        {pendingAttachmentMeta.map((a) => (
                          <span key={`attach:${a.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11.5px] bg-neutral-50 text-neutral-600 border-neutral-200">
                            {a.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <div className="max-w-[75%] bg-neutral-100 rounded-2xl rounded-br-sm px-4 py-2.5">
                      <p className="text-[13.5px] text-neutral-800 leading-relaxed whitespace-pre-wrap">{pendingInput}</p>
                    </div>
                  </div>
                </div>
              )}

              {messages.filter(msg =>
                !(msg.role === 'user' && msg.content.startsWith('[CLARIFICATION CONFIRMED]'))
              ).map((msg, idx, filtered) => {
            const isLastAssistant = msg.role === 'assistant' &&
              !isStreaming &&
              idx === filtered.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).at(-1);
            return (
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                isLastAssistantMessage={isLastAssistant}
                onViewArtifact={onViewArtifact}
                onClarificationConfirm={handleClarificationConfirm}
                onRetry={handleRetry}
              />
            );
          })}

              {isStreaming && (
                <StreamingMessage
                  text={streamingText}
                  tools={streamingTools}
                  clarification={streamingClarification ?? undefined}
                  onClarificationConfirm={handleClarificationConfirm}
                />
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Complete step CTA */}
      {showCompleteStep && (
        <div className="flex-shrink-0 px-6 pt-3">
          <div className="max-w-[680px] mx-auto">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-50 border border-violet-200">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-violet-800 font-medium">Document ready</p>
                <p className="text-[12px] text-violet-600">Mark this step as complete in your process</p>
              </div>
              <button
                onClick={handleCompleteStep}
                disabled={stepCompleting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-[12.5px] font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors flex-shrink-0"
              >
                {stepCompleting ? 'Completing…' : 'Complete step →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="flex-shrink-0 px-6 pb-6 pt-2">
        <div className="max-w-[680px] mx-auto">
          <ChatInputBar
            onSubmit={handleSubmit}
            onAttach={handleAttach}
            onRemoveAttachment={handleRemoveAttachment}
            attachments={chatAttachments}
            loading={isStreaming}
            placeholder="Ask anything..."
            threadId={thread.id}
          />
        </div>
      </div>
    </div>
  );
}
