'use client';

// ─── Phase 2: Chat engine + message streaming ──────────────────────────────
// Phase 3 adds: KB citation chips
// Phase 4 adds: artifact panel
// Phase 5 adds: @ mentions + file attachments
// Phase 6 adds: process integration + polish

import { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRightIcon, ChevronLeftIcon, PlusIcon, RectangleStackIcon, ClockIcon, DocumentArrowDownIcon, ArchiveBoxIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { WorkTabBar } from '@/components/work/work-tab-bar';
import { StudioSidebar } from '@/components/work/studio-sidebar';
import { StudioEmptyState, WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/components/work/studio-empty-state';
import { StudioDetailPanel } from '@/components/work/studio-detail-panel';
import { StudioBuilder } from '@/components/work/studio-builder';
import type { Workflow } from '@/lib/workflows/types';
import { ThreadArtifactsPanel, AllArtifactsPanel } from '@/components/work/chat-artifact-panel';
import { ChatThreadSidebar, ChatThread } from '@/components/work/chat-thread-sidebar';
import { ChatEmptyState } from '@/components/work/chat-empty-state';
import { ChatInputBar, SourceId, AttachmentChip, MentionChip, MENTION_ICONS, MENTION_COLORS } from '@/components/work/chat-input-bar';
import { ChatMessageBubble, StreamingMessage, ChatMessage, ToolStatus } from '@/components/work/chat-message';
import { computeVersionedArtifacts } from '@/lib/artifacts/version-utils';
import { ClarificationData } from '@/components/work/clarification-widget';
import { DocumentArtifact, ExecutionPlan } from '@/lib/types/inbox';
import { AgentsSidebarSection, SidebarAgent } from '@/components/agents/agents-sidebar-section';
import { AgentIcon } from '@/components/agents/agent-icons';
import { useWorkspace } from '@/context/workspace-context';

// ─── Shared constants ─────────────────────────────────────────────────────────

const AGENT_COLOR_MAP: Record<string, { bg: string; icon: string }> = {
  indigo:  { bg: 'bg-indigo-500',  icon: 'text-white' },
  violet:  { bg: 'bg-violet-500',  icon: 'text-white' },
  blue:    { bg: 'bg-blue-500',    icon: 'text-white' },
  emerald: { bg: 'bg-emerald-500', icon: 'text-white' },
  amber:   { bg: 'bg-amber-500',   icon: 'text-white' },
  rose:    { bg: 'bg-rose-500',    icon: 'text-white' },
  neutral: { bg: 'bg-neutral-500', icon: 'text-white' },
};

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
  agent_id?: string | null;
  is_temporary?: boolean;
  workflow_id?: string | null;
}


export interface WorkPageClientProps {
  userId?: string;
  userEmail?: string;
  userFullName?: string;
  initialThreads: WorkThread[];
  initialActiveThreadId?: string | null;
  initialChatInput?: string | null;
  initialSavedWorkflows?: Array<{ id: string; name: string; prompt: string }>;
  initialAgents?: SidebarAgent[];
  initialSection?: 'chat' | 'studio';
  initialWorkflowId?: string | null;
  initialAgentId?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkPageClient({
  userId,
  userEmail,
  userFullName,
  initialThreads,
  initialActiveThreadId,
  initialChatInput,
  initialSavedWorkflows,
  initialAgents = [],
  initialSection = 'chat',
  initialWorkflowId = null,
  initialAgentId = null,
}: WorkPageClientProps) {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const studioEnabled = workspace?.features.studio ?? true;
  const agentsEnabled = workspace?.features.agents ?? true;

  const [threads, setThreads] = useState<WorkThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId || null
  );
  const [pendingInput, setPendingInput] = useState<string | null>(initialChatInput || null);
  const [pendingMentions, setPendingMentions] = useState<MentionChip[]>([]);
  const [pendingSources, setPendingSources] = useState<SourceId[]>(['kb', 'inbox', 'calendar']);
  const [webEnabled, setWebEnabled] = useState(() =>
    initialAgentId ? (initialAgents.find(a => a.id === initialAgentId)?.web_enabled ?? false) : false
  );
  const [pendingFiles, setPendingFiles] = useState<Array<{ id: string; file: File }>>([]);
  const [pendingAttachmentMeta, setPendingAttachmentMeta] = useState<Array<{ id: string; name: string }>>([]);
  const [isAttachUploading, setIsAttachUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(initialAgentId);
  const [isTemporaryMode, setIsTemporaryMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [droppedSnippet, setDroppedSnippet] = useState<{ id: string; name: string; snippetContent: string } | null>(null);
  // Stable ref so the drag useEffect closure always sees the latest activeThreadId
  const activeThreadIdRef = useRef<string | null>(initialActiveThreadId ?? null);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // ── Studio section state ─────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<'chat' | 'studio'>(
    initialSection === 'studio' && studioEnabled ? 'studio' : 'chat'
  );
  const [studioWorkflows, setStudioWorkflows] = useState<Workflow[] | null>(null);
  const [studioLoading, setStudioLoading] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(initialWorkflowId);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);

  const selectedWorkflow = studioWorkflows?.find(w => w.id === selectedWorkflowId) ?? null;
  const isBuilding = activeSection === 'studio' && !!editingWorkflowId && editingWorkflowId === selectedWorkflow?.id;

  async function fetchStudioWorkflows(selectId?: string) {
    const res = await fetch('/api/workflows');
    if (res.ok) {
      const data = await res.json();
      setStudioWorkflows(data.workflows ?? []);
      if (selectId) setSelectedWorkflowId(selectId);
    }
  }

  async function switchToStudio() {
    setActiveSection('studio');
    if (studioWorkflows === null && !studioLoading) {
      setStudioLoading(true);
      try {
        await fetchStudioWorkflows(initialWorkflowId ?? undefined);
      } finally {
        setStudioLoading(false);
      }
    }
  }

  async function handleCreateWorkflow() {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Untitled workflow' }),
    });
    if (res.ok) {
      const { workflow } = await res.json();
      setStudioWorkflows(prev => prev ? [workflow, ...prev] : [workflow]);
      setSelectedWorkflowId(workflow.id);
      setEditingWorkflowId(workflow.id);
    }
  }

  async function handleUseTemplate(template: WorkflowTemplate) {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: template.workflow.name,
        description: template.workflow.description,
        trigger: template.workflow.trigger,
        steps: template.workflow.steps,
        output_config: template.workflow.output_config,
        status: template.workflow.status,
      }),
    });
    if (res.ok) {
      const { workflow } = await res.json();
      setStudioWorkflows(prev => prev ? [workflow, ...prev] : [workflow]);
      setSelectedWorkflowId(workflow.id);
      setEditingWorkflowId(workflow.id);
    }
  }

  async function handleGenerateWorkflow(description: string) {
    const res = await fetch('/api/workflows/generate-from-description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) throw new Error('Generation failed');
    const { workflow: generated } = await res.json();
    await handleUseTemplate({ workflow: generated } as WorkflowTemplate);
  }

  async function handleRenameWorkflow(id: string, name: string) {
    setStudioWorkflows(prev => prev?.map(w => w.id === id ? { ...w, name } : w) ?? null);
    await fetch(`/api/workflows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  async function handleDeleteWorkflow(id: string) {
    setStudioWorkflows(prev => prev?.filter(w => w.id !== id) ?? null);
    if (selectedWorkflowId === id) setSelectedWorkflowId(null);
    await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
  }

  async function handleCloneWorkflow(id: string) {
    const res = await fetch(`/api/workflows/${id}/clone`, { method: 'POST' });
    if (!res.ok) return;
    const { workflow_id } = await res.json();
    // Reload workflows list
    const listRes = await fetch('/api/workflows');
    if (listRes.ok) {
      const { workflows } = await listRes.json();
      setStudioWorkflows(workflows);
    }
    setSelectedWorkflowId(workflow_id);
  }

  function handleWorkflowUpdated(updated: Workflow) {
    setStudioWorkflows(prev => prev?.map(w => w.id === updated.id ? updated : w) ?? null);
  }

  async function handleOpenWorkflowThread(threadId: string) {
    // If already in state (e.g. loaded on page init), just switch to it
    const existing = threads.find(t => t.id === threadId);
    if (existing) {
      setActiveSection('chat');
      setActiveAgentId(null);
      setActiveThreadId(threadId);
      return;
    }
    // Workflow run threads are excluded from the main query — fetch individually
    const res = await fetch(`/api/work/threads/${threadId}`);
    if (res.ok) {
      const { thread } = await res.json();
      if (thread) setThreads(prev => [thread as WorkThread, ...prev.filter(t => t.id !== threadId)]);
    }
    setActiveSection('chat');
    setActiveAgentId(null);
    setActiveThreadId(threadId);
  }

  async function handleOpenWorkflowArtifact(threadId: string, artifactId: string) {
    const existing = threads.find(t => t.id === threadId);
    if (!existing) {
      const res = await fetch(`/api/work/threads/${threadId}`);
      if (res.ok) {
        const { thread } = await res.json();
        if (thread) setThreads(prev => [thread as WorkThread, ...prev.filter(t => t.id !== threadId)]);
      }
    }
    setActiveSection('chat');
    setActiveAgentId(null);
    setActiveThreadId(threadId);
    setActiveArtifactId(artifactId);
    setArtifactPanelOpen(true);
  }

  // Enrich threads with agent name/color for the sidebar tag.
  // Exclude workflow run threads — they live in Studio, not chat history.
  const visibleThreads = threads
    .filter(t => !t.workflow_id)
    .map((t) => {
      if (!t.agent_id) return t;
      const ag = initialAgents.find(a => a.id === t.agent_id);
      return ag ? { ...t, agent_name: ag.name, agent_color: ag.color } : t;
    });

  // ── One-time contact backfill — seeds relationship_graph if empty ────────
  useEffect(() => {
    fetch('/api/connections/backfill-contacts', { method: 'POST' }).catch(() => {});
  }, []);

  // If landing on Studio section (e.g. from back-link of workflow detail), fetch workflows
  useEffect(() => {
    if (initialSection === 'studio') {
      switchToStudio();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep activeThreadIdRef current so drag closure is never stale
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);


  // ── Window drag listeners — always active regardless of which view is showing ─
  useEffect(() => {
    function isFileDrag(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files');
    }
    function onDragEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setIsDragOver(true);
    }
    function onDragLeave(e: DragEvent) {
      if (e.relatedTarget == null) setIsDragOver(false);
    }
    function onDragOver(e: DragEvent) {
      if (isFileDrag(e)) e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      setIsDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const fileArray = Array.from(files);
      if (activeThreadIdRef.current) {
        // Active thread — route to ActiveChatView via prop
        setDroppedFiles(fileArray);
      } else {
        // No thread yet — stage as pending (same as clicking attach on empty state)
        setPendingFiles(prev => [...prev, ...fileArray.map(f => ({ id: crypto.randomUUID(), file: f }))]);
      }
    }
    function onPaste(e: ClipboardEvent) {
      const rawText = (e.clipboardData?.getData('text/plain') ?? '').trim();
      // Detect filesystem paths: single-line, contains path separators, ends with extension.
      // macOS screencaptureui puts both the temp-file path as text/plain AND the PNG image
      // in the clipboard. Block the entire paste when a path is detected — don't attach
      // the accompanying image either, as it's a screenshot artifact, not an intentional upload.
      const isFilePath = !rawText.includes('\n') &&
        (rawText.includes('/') || rawText.includes('\\')) &&
        /\.\w{2,6}$/.test(rawText);

      if (isFilePath) {
        e.preventDefault();
        return;
      }

      // If there's real text, let the browser paste it naturally into the focused input.
      // PPT/Keynote put both a PNG render and text/plain in the clipboard — we want the text.
      if (rawText) return;

      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;

      e.preventDefault();
      if (activeThreadIdRef.current) {
        setDroppedFiles(files);
      } else {
        setPendingFiles(prev => [...prev, ...files.map(f => ({ id: crypto.randomUUID(), file: f }))]);
      }
    }
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            is_generating: t.is_generating,
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

  async function handleCreateThread(message?: string, sources?: SourceId[], mentions?: MentionChip[]) {
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
          agentId: activeAgentId ?? undefined,
          isTemporary: isTemporaryMode,
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
        agent_id: activeAgentId,
        is_temporary: isTemporaryMode,
      };

      // Switch UI immediately — don't wait for upload
      const filesToUpload = pendingFiles;
      setPendingFiles([]);
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(id);
      if (message) setPendingInput(message);
      if (mentions?.length) setPendingMentions(mentions);
      if (sources?.length) {
        setPendingSources(sources);
        setWebEnabled(sources.includes('web'));
      }

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
    setActiveAgentId(null);
    const thread = threads.find(t => t.id === id);
    const threadAgent = thread?.agent_id ? initialAgents.find(a => a.id === thread.agent_id) : null;
    setWebEnabled(threadAgent?.web_enabled ?? false);
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
    // Don't change activeThreadId — user stays in current thread, panel shows globally
  }

  function handleThreadTitleUpdate(id: string, title: string, persist = false) {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    if (persist) {
      fetch(`/api/work/threads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }).catch(() => {});
    }
  }

  function handleThreadArtifactsUpdate(id: string, artifacts: DocumentArtifact[]) {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, artifacts } : t)));
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50">

      {/* Drop overlay — fixed full-window, always available regardless of which view is active */}
      {isDragOver && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 px-10 py-8 rounded-2xl border-2 border-dashed border-indigo-300 bg-white shadow-lg">
            <DocumentArrowDownIcon className="w-10 h-10 text-indigo-400" />
            <p className="text-[15px] font-medium text-indigo-600">Drop to attach</p>
          </div>
        </div>
      )}

      {/* Thread sidebar — hidden when studio builder is open */}
      <div className={`w-[220px] flex-shrink-0 flex flex-col bg-neutral-50 p-2 ${isBuilding ? 'hidden' : ''}`}>
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {/* Sidebar header: Chat / Studio tab toggle — hidden when studio is disabled for workspace */}
          {studioEnabled && (
            <WorkTabBar
              activeSection={activeSection}
              onSwitch={(s) => s === 'studio' ? switchToStudio() : setActiveSection('chat')}
            />
          )}

          {activeSection === 'studio' && (
            <StudioSidebar
              workflows={studioWorkflows ?? []}
              selectedId={selectedWorkflowId}
              onSelect={(id) => { setSelectedWorkflowId(id); setEditingWorkflowId(null); }}
              onCreate={() => { setSelectedWorkflowId(null); setEditingWorkflowId(null); }}
              onRename={handleRenameWorkflow}
              onDelete={handleDeleteWorkflow}
              onClone={handleCloneWorkflow}
            />
          )}

          {activeSection === 'chat' && (
            <>
              {/* Agents section — hidden when agents feature is disabled for workspace */}
              {agentsEnabled && (
                <AgentsSidebarSection
                  agents={initialAgents}
                  activeAgentId={activeAgentId}
                  onSelect={(id) => {
                    setActiveAgentId(id);
                    setActiveThreadId(null);
                    setPendingInput(null);
                    setPendingMentions([]);
                    setPendingFiles([]);
                    setPendingAttachmentMeta([]);
                    // Seed web toggle from agent's default
                    const agent = initialAgents.find(a => a.id === id);
                    setWebEnabled(agent?.web_enabled ?? false);
                  }}
                />
              )}

              {/* Chat history label */}
              <div className="px-3.5 pt-2 pb-1 flex items-center justify-between flex-shrink-0">
                <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider">Chat history</span>
                <button
                  onClick={() => { setActiveThreadId(null); setActiveAgentId(null); setWebEnabled(false); setPendingInput(null); setPendingMentions([]); setPendingFiles([]); setPendingAttachmentMeta([]); setIsAttachUploading(false); }}
                  className="p-0.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
                  title="New chat"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Thread list — filtered by active agent */}
              <ChatThreadSidebar
                threads={visibleThreads}
                activeThreadId={activeThreadId}
                onSelect={handleSelectThread}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            </>
          )}
        </div>
      </div>

      {/* Main column — floating card */}
      <div className="flex-1 min-w-0 flex flex-col bg-neutral-50 pl-2 pt-2 pb-2 overflow-hidden">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">

          {/* Studio section */}
          {activeSection === 'studio' && (
            editingWorkflowId && selectedWorkflow && editingWorkflowId === selectedWorkflow.id ? (
              <StudioBuilder
                key={editingWorkflowId}
                workflow={selectedWorkflow}
                agents={initialAgents}
                onClose={(updated) => { handleWorkflowUpdated(updated); setEditingWorkflowId(null); }}
                onBack={() => {
                  const w = selectedWorkflow;
                  if (w && w.name === 'Untitled workflow' && (!w.steps || w.steps.length === 0) && !w.description) {
                    handleDeleteWorkflow(w.id);
                  }
                  setEditingWorkflowId(null);
                }}
              />
            ) : selectedWorkflow ? (
              <StudioDetailPanel
                key={selectedWorkflow.id}
                workflow={selectedWorkflow}
                onEdit={() => setEditingWorkflowId(selectedWorkflow.id)}
                onWorkflowUpdated={handleWorkflowUpdated}
                onWorkflowDeleted={handleDeleteWorkflow}
                onOpenThread={handleOpenWorkflowThread}
                onOpenArtifact={handleOpenWorkflowArtifact}
                onClone={handleCloneWorkflow}
              />
            ) : selectedWorkflowId && (studioLoading || studioWorkflows === null) ? (
              // Workflow selected but list not loaded yet (e.g. back-nav before fetch completes)
              <div className="flex items-center justify-center flex-1">
                <div className="w-5 h-5 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            ) : (
              <StudioEmptyState
                onCreate={handleCreateWorkflow}
                onUseTemplate={handleUseTemplate}
                onGenerateFromDescription={handleGenerateWorkflow}
              />
            )
          )}

          {activeSection === 'chat' && (<>

          {/* New chat screen bar: clock toggle (left) + global artifacts button (right) */}
          {!activeThread && (
            <div className={`flex items-center justify-between px-3 h-11 border-b flex-shrink-0 transition-colors duration-300 ${
              isTemporaryMode ? 'bg-amber-50 border-amber-100' : 'border-neutral-100'
            }`}>
              <button
                onClick={() => setIsTemporaryMode(v => !v)}
                title={isTemporaryMode ? 'Temporary mode on — chat deleted on exit' : 'Enable temporary chat (no history)'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12px] transition-colors duration-200 focus:outline-none ${
                  isTemporaryMode
                    ? 'text-amber-600 hover:bg-amber-100'
                    : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-500'
                }`}
              >
                <ClockIcon className="w-3.5 h-3.5" />
                <span className={`overflow-hidden transition-all duration-200 whitespace-nowrap ${
                  isTemporaryMode ? 'max-w-[80px] opacity-100' : 'max-w-0 opacity-0'
                }`}>Temporary</span>
              </button>
              {threads.some(t => (t.artifacts?.length ?? 0) > 0) && (
                <ArtifactsPanelButton
                  count={threads.reduce((n, t) => n + (t.artifacts?.length ?? 0), 0)}
                  open={artifactPanelOpen}
                  onClick={() => setArtifactPanelOpen(v => !v)}
                />
              )}
            </div>
          )}

          {(activeThread ? (
            <ActiveChatView
              thread={activeThread}
              agentId={activeThread.agent_id ?? activeAgentId ?? undefined}
              agent={initialAgents.find(a => a.id === (activeThread.agent_id ?? activeAgentId))}
              pendingInput={pendingInput}
              pendingMentions={pendingMentions}
              pendingSources={pendingSources}
              pendingAttachmentMeta={pendingAttachmentMeta}
              isAttachUploading={isAttachUploading}
              onPendingInputConsumed={() => { setPendingInput(null); setPendingMentions([]); setPendingSources(['kb', 'inbox', 'calendar']); setPendingAttachmentMeta([]); }}
              onTitleUpdate={handleThreadTitleUpdate}
              onArtifactsUpdate={handleThreadArtifactsUpdate}
              onViewArtifact={handleViewArtifact}
              onArtifactReady={handleViewArtifact}
              artifactPanelOpen={artifactPanelOpen}
              onArtifactPanelToggle={() => setArtifactPanelOpen(v => !v)}
              onThreadRemove={(id) => setThreads(prev => prev.filter(t => t.id !== id))}
              onBackToWorkflow={(workflowId) => {
                setActiveThreadId(null);
                setSelectedWorkflowId(workflowId);
                setEditingWorkflowId(null);
                setActiveSection('studio');
                if (!studioWorkflows && !studioLoading) {
                  setStudioLoading(true);
                  fetchStudioWorkflows(workflowId).finally(() => setStudioLoading(false));
                }
              }}
              webEnabled={webEnabled}
              onWebToggle={setWebEnabled}
              externalDroppedFiles={droppedFiles}
              onDropConsumed={() => setDroppedFiles([])}
              externalSnippet={droppedSnippet}
              onSnippetConsumed={() => setDroppedSnippet(null)}
            />
          ) : activeAgentId ? (
            <AgentHomeScreen
              agent={initialAgents.find(a => a.id === activeAgentId)!}
              onStart={handleCreateThread}
              pendingFiles={pendingFiles.map(({ id, file }) => ({ id, name: file.name, size: file.size, isUploading: isAttachUploading }))}
              onAttach={handlePreAttach}
              onRemoveAttachment={handlePreRemoveAttachment}
              webEnabled={webEnabled}
              onWebToggle={setWebEnabled}
            />
          ) : (
            <ChatEmptyState
              onStart={handleCreateThread}
              userFirstName={userFullName}
              savedWorkflows={initialSavedWorkflows}
              onAttach={handlePreAttach}
              onRemoveAttachment={handlePreRemoveAttachment}
              attachments={pendingFiles.map(({ id, file }) => ({ id, name: file.name, size: file.size, isUploading: isAttachUploading }))}
            />
          ))}
          </>)}
        </div>
      </div>

      {/* Artifact panel — only in chat section, never in studio */}
      <div
        className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ${
          activeSection === 'chat' && artifactPanelOpen && (!activeThread || (activeThread.artifacts?.length ?? 0) > 0)
            ? 'w-[400px]'
            : 'w-0'
        }`}
      >
        {artifactPanelOpen && !activeThread && (
          <AllArtifactsPanel
            threads={threads}
            activeArtifactId={activeArtifactId}
            onClose={() => { setArtifactPanelOpen(false); setActiveArtifactId(null); }}
            onSelectThread={(threadId, artifactId) => {
              setActiveThreadId(threadId);
              setActiveArtifactId(artifactId);
            }}
          />
        )}
        {artifactPanelOpen && activeThread && (activeThread.artifacts?.length ?? 0) > 0 && (
          <ThreadArtifactsPanel
            thread={activeThread}
            onClose={() => setArtifactPanelOpen(false)}
            onArtifactsUpdate={(artifacts) => handleThreadArtifactsUpdate(activeThread.id, artifacts)}
            activeArtifactId={activeArtifactId}
          />
        )}
      </div>

    </div>
  );
}

// ─── Artifacts panel button ───────────────────────────────────────────────────

function ArtifactsPanelButton({ count, open, onClick }: { count: number; open: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Artifacts"
      className={`relative flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12px] transition-colors ${
        open
          ? 'bg-indigo-50 text-indigo-700'
          : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'
      }`}
    >
      <ArchiveBoxIcon className="w-3.5 h-3.5" />
      {count > 0 && (
        <span className={`text-[10.5px] font-medium ${open ? 'text-indigo-600' : 'text-neutral-400'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Active chat view ─────────────────────────────────────────────────────────

interface ActiveChatViewProps {
  thread: WorkThread;
  agentId?: string;
  agent?: SidebarAgent;
  pendingInput: string | null;
  pendingMentions?: MentionChip[];
  pendingSources?: SourceId[];
  pendingAttachmentMeta?: Array<{ id: string; name: string }>;
  isAttachUploading?: boolean;
  onPendingInputConsumed: () => void;
  onTitleUpdate: (id: string, title: string, persist?: boolean) => void;
  onArtifactsUpdate: (id: string, artifacts: DocumentArtifact[]) => void;
  onViewArtifact: (id: string) => void;
  onArtifactReady?: (artifactId: string) => void;
  artifactPanelOpen?: boolean;
  onArtifactPanelToggle?: () => void;
  onThreadRemove?: (id: string) => void;
  onBackToWorkflow?: (workflowId: string) => void;
  webEnabled?: boolean;
  onWebToggle?: (enabled: boolean) => void;
  externalDroppedFiles?: File[];
  onDropConsumed?: () => void;
  externalSnippet?: { id: string; name: string; snippetContent: string } | null;
  onSnippetConsumed?: () => void;
}

function ActiveChatView({
  thread,
  agentId,
  agent,
  pendingInput,
  pendingMentions = [],
  pendingSources = ['kb', 'inbox', 'calendar'],
  pendingAttachmentMeta = [],
  isAttachUploading = false,
  onPendingInputConsumed,
  onTitleUpdate,
  onArtifactsUpdate,
  onViewArtifact,
  onArtifactReady,
  artifactPanelOpen = false,
  onArtifactPanelToggle,
  onThreadRemove,
  onBackToWorkflow,
  webEnabled,
  onWebToggle,
  externalDroppedFiles,
  onDropConsumed,
  externalSnippet,
  onSnippetConsumed,
}: ActiveChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolStatus[]>([]);
  const [streamingClarification, setStreamingClarification] = useState<ClarificationData | null>(null);
  const [chatAttachments, setChatAttachments] = useState<AttachmentChip[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasSentPending = useRef(false);
  const lastUserInputRef = useRef<{ content: string; mentions: MentionChip[] } | null>(null);

  const mountedRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      streamAbortRef.current?.abort();
    };
  }, []);

  const hasArtifacts = (thread.artifacts?.length ?? 0) > 0;

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
        let msgs: ChatMessage[] = data.messages || [];
        // For workflow threads with artifacts, patch any assistant messages that lack
        // artifact_ids so the inline chip shows (covers runs created before Phase 141).
        if (thread.workflow_id && (thread.artifacts?.length ?? 0) > 0) {
          const artifactIds = (thread.artifacts ?? []).map(a => a.id).filter(Boolean) as string[];
          msgs = msgs.map(msg =>
            msg.role === 'assistant' && !(msg.metadata?.artifact_ids?.length)
              ? { ...msg, metadata: { ...msg.metadata, artifact_ids: artifactIds } }
              : msg
          );
        }
        setMessages(msgs);
        setIsLoading(false);
      })
      .catch((err) => { if (err.name !== 'AbortError') setIsLoading(false); });

    return () => controller.abort();
  }, [thread.id]);

  // Attachment handlers
  async function handleAttach(files: File[]) {
    // Add chips immediately with a loading spinner — don't wait for upload
    const tempChips = files.map(f => ({
      id: `uploading-${crypto.randomUUID()}`,
      name: f.name,
      size: f.size,
      isUploading: true,
    }));
    setChatAttachments(prev => [...prev, ...tempChips]);

    const formData = new FormData();
    for (const f of files) formData.append('file', f);
    try {
      const res = await fetch(`/api/work/threads/${thread.id}/chat-attach`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        setChatAttachments(prev => prev.filter(a => !tempChips.find(t => t.id === a.id)));
        return;
      }
      const { attachments } = await res.json();
      // Replace temp chips with real server-returned data
      const realChips = attachments.map((a: { chatAttachId: string; filename: string; size: number }) => ({
        id: a.chatAttachId,
        name: a.filename,
        size: a.size,
        isUploading: false,
      }));
      setChatAttachments(prev => {
        const without = prev.filter(a => !tempChips.find(t => t.id === a.id));
        return [...without, ...realChips];
      });
    } catch {
      setChatAttachments(prev => prev.filter(a => !tempChips.find(t => t.id === a.id)));
    }
  }

  async function handleRemoveAttachment(id: string) {
    setChatAttachments(prev => prev.filter(a => a.id !== id));
    await fetch(`/api/work/threads/${thread.id}/chat-attach?chatAttachId=${id}`, { method: 'DELETE' });
  }

  // Consume files dropped by the parent's window-level drag handler
  useEffect(() => {
    if (!externalDroppedFiles || externalDroppedFiles.length === 0) return;
    handleAttach(externalDroppedFiles).finally(() => onDropConsumed?.());
  }, [externalDroppedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Consume text snippet companion from paste (e.g. PPT slide = image + text/plain)
  useEffect(() => {
    if (!externalSnippet) return;
    setChatAttachments(prev => [...prev, {
      id: externalSnippet.id,
      name: externalSnippet.name,
      size: 0,
      isSnippet: true,
      snippetContent: externalSnippet.snippetContent,
    }]);
    onSnippetConsumed?.();
  }, [externalSnippet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send pendingInput once messages are loaded and it hasn't been sent yet
  useEffect(() => {
    if (!pendingInput || isLoading || isStreaming || isAttachUploading || hasSentPending.current) return;
    hasSentPending.current = true;
    onPendingInputConsumed();
    handleSubmit(pendingInput, pendingSources, pendingMentions, pendingAttachmentMeta);
  }, [pendingInput, isLoading, isAttachUploading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingTools]);

  // Auto-delete temporary thread on unmount or thread switch.
  // keepalive fetch in beforeunload handles browser/tab close; the cleanup
  // handles in-app navigation away from the thread.
  useEffect(() => {
    if (!thread.is_temporary) return;
    const threadId = thread.id;
    const handleUnload = () => {
      fetch(`/api/work/threads/${threadId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      onThreadRemove?.(threadId);
      fetch(`/api/work/threads/${threadId}`, { method: 'DELETE' }).catch(() => {});
    };
  }, [thread.id, thread.is_temporary]); // eslint-disable-line react-hooks/exhaustive-deps

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
    handleSubmit(content, ['kb', 'inbox', 'calendar'], mentions);
  }

  async function handleSubmit(message: string, sources: SourceId[], mentions: MentionChip[], extraAttachments?: Array<{ id: string; name: string }>, skipOptimisticUser?: boolean) {
    if (isStreaming || !message.trim()) return;
    lastUserInputRef.current = { content: message, mentions };

    // Separate snippet chips from real file chips
    const snippetChips = chatAttachments.filter(a => a.isSnippet);
    const fileChips = chatAttachments.filter(a => !a.isSnippet);

    // Inject snippet text into the message content sent to the AI
    const snippetBlock = snippetChips.length > 0
      ? '\n\n' + snippetChips.map(s => `[Pasted snippet]\n${s.snippetContent}`).join('\n\n---\n\n')
      : '';
    const enrichedMessage = message + snippetBlock;

    const currentAttachments = [
      ...fileChips.map(a => ({ id: a.id, name: a.name })),
      ...(extraAttachments ?? []),
    ];

    // Optimistic user message — display original message, show snippet chips alongside file chips
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
      mentions: mentions.length > 0 ? mentions : undefined,
      metadata: (currentAttachments.length > 0 || snippetChips.length > 0) ? {
        attachments: [
          ...currentAttachments,
          ...snippetChips.map(s => ({ id: s.id, name: s.name })),
        ],
      } : undefined,
    };
    if (!skipOptimisticUser) setMessages(prev => [...prev, userMsg]);
    setChatAttachments([]);
    setIsStreaming(true);
    setStreamingText('');
    setStreamingTools([]);

    const ac = new AbortController();
    streamAbortRef.current = ac;

    try {
      const res = await fetch(`/api/work/threads/${thread.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: enrichedMessage, sources, mentions, attachments: currentAttachments, agentId }),
        signal: ac.signal,
      });

      // Component unmounted while request was in flight — discard response silently
      if (!mountedRef.current) return;

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        console.error('[handleSubmit] API error', res.status, errText);
        throw new Error('Stream failed');
      }

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
      // Silently discard aborts (unmount / navigation away)
      if (!mountedRef.current || (err instanceof Error && err.name === 'AbortError')) return;
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

  // ── Artifact version map — derived, no extra state ───────────────────────
  const artifactVersionMap = useMemo(() => {
    const versioned = computeVersionedArtifacts(thread.artifacts ?? []);
    return new Map(versioned.map(a => [a.id ?? '', { title: a.title, versionLabel: a.versionLabel, type: a.type }]));
  }, [thread.artifacts]);

  // ── Edit message: truncate DB + restream ─────────────────────────────────
  async function handleEditMessage(messageId: string, newContent: string) {
    if (isStreaming) return;

    // Abort any in-flight stream before editing to avoid stale isStreaming state
    streamAbortRef.current?.abort();

    await fetch(`/api/work/threads/${thread.id}/chat`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, newContent }),
    });

    // If component unmounted while awaiting PATCH (e.g. user navigated away
    // and the temporary-thread cleanup already deleted this thread), bail out.
    if (!mountedRef.current) return;

    // Explicitly reset streaming state — guards against a race where a prior
    // stream finished server-side but React hasn't flushed setIsStreaming(false)
    // yet, which would cause handleSubmit to bail out at the isStreaming guard.
    setIsStreaming(false);
    setStreamingText('');
    setStreamingTools([]);
    setStreamingClarification(null);

    // Optimistically truncate local messages to just before the edited one,
    // then update its content
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx < 0) return prev;
      return prev.slice(0, idx + 1).map((m, i) =>
        i === idx ? { ...m, content: newContent, isEdited: true } : m
      );
    });

    // Re-stream from the edited message — skip optimistic user bubble (already updated in place)
    await handleSubmit(newContent, ['kb', 'inbox', 'calendar'], [], undefined, true);
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
    handleSubmit(confirmMessage, ['kb', 'inbox', 'calendar'], []);
  }



  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {/* Always-visible header — consistent across all threads */}
      <div className={`flex items-center gap-2 px-4 h-11 border-b flex-shrink-0 min-w-0 transition-colors duration-300 ${
        thread.is_temporary ? 'bg-amber-50 border-amber-100' : 'border-neutral-100'
      }`}>
        {/* Left: back button (workflow run threads) */}
        {thread.workflow_id && onBackToWorkflow && (
          <button
            onClick={() => onBackToWorkflow(thread.workflow_id!)}
            className="flex-shrink-0 text-neutral-400 hover:text-neutral-600 transition-colors"
            title="Back to workflow"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
        )}

        {/* Left: agent dot (if agent thread) */}
        {agent && (
          <div className={`w-4 h-4 rounded flex-shrink-0 ${AGENT_COLOR_MAP[agent.color]?.bg ?? 'bg-indigo-500'} flex items-center justify-center`}>
            <AgentIcon iconKey={agent.icon} className="w-2.5 h-2.5 text-white" />
          </div>
        )}

        {/* Left: title */}
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => {
              const trimmed = titleDraft.trim();
              if (trimmed && trimmed !== thread.title) onTitleUpdate(thread.id, trimmed, true);
              setIsEditingTitle(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.currentTarget.blur(); }
              if (e.key === 'Escape') { setIsEditingTitle(false); }
            }}
            className="flex-1 min-w-0 text-[12.5px] font-medium text-neutral-700 bg-transparent border-b border-neutral-300 focus:border-neutral-500 outline-none truncate"
          />
        ) : (
          <button
            onClick={() => { setTitleDraft(thread.title); setIsEditingTitle(true); setTimeout(() => titleInputRef.current?.select(), 0); }}
            className="text-[12.5px] font-medium text-neutral-700 truncate flex-1 min-w-0 text-left hover:text-neutral-900 transition-colors"
          >
            {thread.title}
          </button>
        )}

        {/* Temporary indicator */}
        {thread.is_temporary && (
          <div className="flex items-center gap-1 text-amber-500 flex-shrink-0">
            <ClockIcon className="w-3.5 h-3.5" />
            <span className="text-[12px]">Temporary</span>
          </div>
        )}

        {/* Right: gear icon (agent threads) + artifacts button */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {agent && (
            <Link
              href={`/agents/${agent.id}/edit`}
              className="text-neutral-400 hover:text-neutral-600 transition-colors"
              title={`Edit ${agent.name}`}
            >
              <Cog6ToothIcon className="w-4 h-4" />
            </Link>
          )}
          {hasArtifacts && (
            <ArtifactsPanelButton
              count={thread.artifacts?.length ?? 0}
              open={artifactPanelOpen}
              onClick={onArtifactPanelToggle}
            />
          )}
        </div>
      </div>

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
                onEditMessage={msg.role === 'user' && !isStreaming ? handleEditMessage : undefined}
                artifactVersionMap={artifactVersionMap}
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
            webEnabled={webEnabled}
            onWebToggle={onWebToggle}
          />

        </div>
      </div>
    </div>
  );
}

// ─── Agent home screen ────────────────────────────────────────────────────────

interface AgentHomeScreenProps {
  agent: SidebarAgent;
  onStart: (message: string, sources: SourceId[], mentions: MentionChip[]) => void;
  pendingFiles: AttachmentChip[];
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  webEnabled?: boolean;
  onWebToggle?: (enabled: boolean) => void;
}

function AgentHomeScreen({ agent, onStart, pendingFiles, onAttach, onRemoveAttachment, webEnabled = false, onWebToggle }: AgentHomeScreenProps) {
  if (!agent) return null;
  const colors = AGENT_COLOR_MAP[agent.color] ?? AGENT_COLOR_MAP.indigo;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
      {/* Agent identity */}
      <div className="flex flex-col items-center mb-8">
        <div className={`w-14 h-14 rounded-2xl ${colors.bg} flex items-center justify-center mb-4 shadow-sm`}>
          <AgentIcon iconKey={agent.icon} className={`w-7 h-7 ${colors.icon}`} />
        </div>
        <h1 className="text-[20px] font-semibold text-neutral-800 tracking-tight">{agent.name}</h1>
        {agent.description && (
          <p className="mt-1.5 text-[13px] text-neutral-500 text-center max-w-[380px] leading-snug">
            {agent.description}
          </p>
        )}
        <Link
          href={`/agents/${agent.id}/edit`}
          className="mt-3 text-[11.5px] text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Edit agent
        </Link>
      </div>

      {/* Input */}
      <div className="w-full max-w-[580px]">
        <ChatInputBar
          onSubmit={onStart}
          onAttach={onAttach}
          onRemoveAttachment={onRemoveAttachment}
          attachments={pendingFiles}
          placeholder={`Message ${agent.name}…`}
          webEnabled={webEnabled}
          onWebToggle={onWebToggle}
        />
        {/* Conversation starters — same layout/animation as default chat prompts */}
        {(agent.conversation_starters?.filter(Boolean).length ?? 0) > 0 && (
          <div className="mt-2">
            {agent.conversation_starters!.filter(Boolean).map((starter, i, arr) => (
              <div
                key={i}
                className="animate-prompt-in"
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}
              >
                <button
                  onClick={() => {
                    const sources: SourceId[] = ['kb', 'inbox', 'calendar'];
                    if (webEnabled) sources.push('web');
                    onStart(starter, sources, []);
                  }}
                  className="w-full text-left px-1 py-2.5 text-[13px] text-neutral-600 hover:text-neutral-900 transition-colors"
                >
                  {starter}
                </button>
                {i < arr.length - 1 && <div className="border-t border-neutral-100" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
