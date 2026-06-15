'use client';

import { useState } from 'react';
import { WorkersRoster } from '@/components/workers/workers-roster';
import { WorkerProfile } from '@/components/workers/worker-profile';
import { WorkersSetupView } from '@/components/workers/workers-setup-view';

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
  const [workers, setWorkers] = useState<Worker[]>(initialWorkers);

  const enabledWorkers = workers.filter(w => w.is_enabled);
  const hasEnabled = enabledWorkers.length > 0;

  // 'setup' = catalog view; 'workspace' = two-column roster+profile
  const [view, setView] = useState<'setup' | 'workspace'>(hasEnabled ? 'workspace' : 'setup');

  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(
    enabledWorkers[0]?.id ?? null
  );
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

  async function handleSelectWorker(id: string) {
    if (id === activeWorkerId) return;
    setActiveWorkerId(id);
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
          activeWorkerId={activeWorkerId}
          onSelect={handleSelectWorker}
          onManage={() => setView('setup')}
        />
      </div>

      {/* Right: worker profile */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activeWorker ? (
          <WorkerProfile
            key={activeWorker.id}
            worker={activeWorker}
            initialThreads={activeThreads}
            initialMessages={activeWorkerId === (workers.find(w => w.is_enabled)?.id) ? (initialMessages as import('@/components/work/chat-message').ChatMessage[] | undefined) : undefined}
            onThreadCreated={(thread) => handleThreadCreated(activeWorker.id, thread)}
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
