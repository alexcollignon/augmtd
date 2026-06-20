'use client';

import { useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WorkersRoster } from '@/components/workers/workers-roster';
import { WorkerProfile } from '@/components/workers/worker-profile';
import { WorkersSetupView } from '@/components/workers/workers-setup-view';
import { TeamHomeView } from '@/components/workers/team-home-view';
import { SkillsLibraryView } from '@/components/workers/skills-library-view';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Worker {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  worker_role: string | null;
  is_enabled: boolean;
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
  userFirstName?: string;
  initialWorkers: Worker[];
  initialThreads: WorkerThread[];
  initialMessages?: Array<{ id: string; role: string; content: string; created_at: string; metadata?: unknown }>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkersPageClient({
  initialWorkers,
  userFirstName,
  initialThreads,
  initialMessages,
}: WorkersPageClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [workers, setWorkers] = useState<Worker[]>(initialWorkers);

  const enabledWorkers = workers.filter(w => w.is_enabled);
  const hasEnabled = enabledWorkers.length > 0;

  // 'setup' = catalog view; 'workspace' = two-column roster+profile
  const [view, setView] = useState<'setup' | 'workspace'>(hasEnabled ? 'workspace' : 'setup');

  // Read URL params once at mount — do NOT use reactively so worker switches
  // can't bleed the old thread ID into the newly-mounted WorkerProfile.
  const urlWorkerId = searchParams.get('worker');
  const urlTab = searchParams.get('tab');
  const urlThreadId = searchParams.get('thread');

  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(() => {
    if (urlWorkerId && enabledWorkers.some(w => w.id === urlWorkerId)) return urlWorkerId;
    return enabledWorkers[0]?.id ?? null;
  });

  // Land on the team home (review desk) by default; a ?worker=/?thread= deep
  // link goes straight to that worker instead.
  const [showTeamHome, setShowTeamHome] = useState<boolean>(!urlWorkerId && !urlThreadId);
  // Skills library — a team-level surface (sits with Home in the roster).
  const [showSkills, setShowSkills] = useState<boolean>(false);

  // Tracks the thread ID to pass as initialThreadId to WorkerProfile.
  // Set from URL on first load; cleared immediately when switching workers so
  // the old thread ID never leaks into a newly-mounted WorkerProfile.
  const [profileInitialThreadId, setProfileInitialThreadId] = useState<string | null>(urlThreadId);

  // Refs track current tab/thread so URL updates always use up-to-date values
  const currentTabRef = useRef<string>(urlTab ?? 'chat');
  const currentThreadRef = useRef<string | null>(urlThreadId);

  const pushUrl = useCallback((patch: { worker?: string | null; tab?: string | null; thread?: string | null }) => {
    const w = patch.worker !== undefined ? patch.worker : (activeWorkerId);
    const tab = patch.tab !== undefined ? patch.tab : currentTabRef.current;
    const thread = patch.thread !== undefined ? patch.thread : currentThreadRef.current;
    const params = new URLSearchParams();
    if (w) params.set('worker', w);
    if (tab && tab !== 'chat') params.set('tab', tab);
    if (thread) params.set('thread', thread);
    router.replace(`/workers${params.size ? '?' + params.toString() : ''}`, { scroll: false });
  }, [activeWorkerId, router]);

  const handleTabChange = useCallback((tab: string) => {
    currentTabRef.current = tab;
    pushUrl({ tab });
  }, [pushUrl]);

  const handleActiveThreadChange = useCallback((threadId: string | null) => {
    currentThreadRef.current = threadId;
    pushUrl({ thread: threadId });
  }, [pushUrl]);
  const [threadsByWorker, setThreadsByWorker] = useState<Record<string, WorkerThread[]>>(
    activeWorkerId ? { [activeWorkerId]: initialThreads } : {}
  );

  const activeWorker = workers.find(w => w.id === activeWorkerId) ?? null;
  const activeThreads = activeWorkerId ? (threadsByWorker[activeWorkerId] ?? []) : [];

  function handleEnable(workerId: string) {
    setWorkers(prev => prev.map(w => w.id === workerId ? { ...w, is_enabled: true } : w));
  }

  function handleDisable(workerId: string) {
    setWorkers(prev => prev.map(w => w.id === workerId ? { ...w, is_enabled: false } : w));
    // If the disabled worker was active, pick next enabled one
    if (activeWorkerId === workerId) {
      const next = workers.find(w => w.id !== workerId && w.is_enabled);
      setActiveWorkerId(next?.id ?? null);
    }
  }

  function handleEnterWorkspace() {
    const first = workers.find(w => w.is_enabled);
    if (first) setActiveWorkerId(first.id);
    setView('workspace');
  }

  function handleGoTeamHome() {
    setShowTeamHome(true);
    setShowSkills(false);
    setProfileInitialThreadId(null);
    pushUrl({ worker: null, tab: null, thread: null });
  }

  function handleGoSkills() {
    setShowSkills(true);
    setShowTeamHome(false);
    setProfileInitialThreadId(null);
    pushUrl({ worker: null, tab: null, thread: null });
  }

  async function handleSelectWorker(id: string, threadId?: string) {
    setShowTeamHome(false);
    setShowSkills(false);
    if (id === activeWorkerId) {
      // already open — just jump to the thread if one was requested
      if (threadId) { setProfileInitialThreadId(threadId); pushUrl({ worker: id, tab: null, thread: threadId }); }
      return;
    }
    setActiveWorkerId(id);
    setProfileInitialThreadId(threadId ?? null); // open the requested thread, or clear
    currentTabRef.current = 'chat';
    currentThreadRef.current = threadId ?? null;
    pushUrl({ worker: id, tab: null, thread: threadId ?? null });
    // Always re-fetch — local cache can be stale if threads were created in this session
    const res = await fetch(`/api/work/threads?agent_id=${id}`);
    if (res.ok) {
      const data = await res.json();
      setThreadsByWorker(prev => ({ ...prev, [id]: data.threads ?? [] }));
    }
  }

  function handleThreadCreated(workerId: string, thread: WorkerThread) {
    setThreadsByWorker(prev => ({
      ...prev,
      [workerId]: [thread, ...(prev[workerId] ?? [])],
    }));
  }

  function handleThreadDeleted(workerId: string, threadId: string) {
    setThreadsByWorker(prev => ({
      ...prev,
      [workerId]: (prev[workerId] ?? []).filter(t => t.id !== threadId),
    }));
  }

  // ── Setup view ────────────────────────────────────────────────────────────

  if (view === 'setup') {
    return (
      <WorkersSetupView
        workers={workers}
        userFirstName={userFirstName}
        onEnable={handleEnable}
        onDisable={handleDisable}
        onEnterWorkspace={handleEnterWorkspace}
      />
    );
  }

  // ── Workspace view ────────────────────────────────────────────────────────

  // If all workers were disabled while in workspace, go back to setup
  const workspaceWorkers = workers.filter(w => w.is_enabled);
  if (workspaceWorkers.length === 0) {
    setView('setup');
    return null;
  }

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50 p-2 gap-2">

      {/* Left: roster */}
      <div className="w-[200px] flex-shrink-0">
        <WorkersRoster
          workers={workspaceWorkers}
          activeWorkerId={showTeamHome || showSkills ? null : activeWorkerId}
          onSelect={handleSelectWorker}
          onManage={() => setView('setup')}
          onSelectHome={handleGoTeamHome}
          homeActive={showTeamHome}
          onSelectSkills={handleGoSkills}
          skillsActive={showSkills}
        />
      </div>

      {/* Right: team home (review desk) or worker profile */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {showSkills ? (
          <SkillsLibraryView
            workers={workspaceWorkers.map(w => ({ id: w.id, name: w.name, worker_role: w.worker_role }))}
          />
        ) : showTeamHome ? (
          <TeamHomeView
            userFirstName={userFirstName}
            onSelectWorker={handleSelectWorker}
          />
        ) : activeWorker ? (
          <WorkerProfile
            key={activeWorker.id}
            worker={activeWorker}
            initialThreads={activeThreads}
            initialMessages={activeWorkerId === (workers.find(w => w.is_enabled)?.id) ? (initialMessages as import('@/components/work/chat-message').ChatMessage[] | undefined) : undefined}
            initialTab={(urlTab as 'chat' | 'knowledge' | 'tasks' | 'documents' | 'activity') ?? undefined}
            initialThreadId={profileInitialThreadId ?? undefined}
            onTabChange={handleTabChange}
            onActiveThreadChange={handleActiveThreadChange}
            onThreadCreated={(thread) => handleThreadCreated(activeWorker.id, thread)}
            onThreadDeleted={(threadId) => handleThreadDeleted(activeWorker.id, threadId)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-2xl bg-white shadow-sm">
            <p className="text-[13px] text-neutral-400">Select a worker</p>
          </div>
        )}
      </div>

    </div>
  );
}
