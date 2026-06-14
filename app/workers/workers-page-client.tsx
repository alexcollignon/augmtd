'use client';

import { useState } from 'react';
import { WorkersRoster } from '@/components/workers/workers-roster';
import { WorkerProfile } from '@/components/workers/worker-profile';

// ─── Types (exported for reuse across workers components) ─────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkersPageClient({
  initialWorkers,
  initialActiveWorkerId,
  initialThreads,
}: WorkersPageClientProps) {
  const [workers] = useState<Worker[]>(initialWorkers);
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(initialActiveWorkerId);
  const [threadsByWorker, setThreadsByWorker] = useState<Record<string, WorkerThread[]>>(
    initialActiveWorkerId ? { [initialActiveWorkerId]: initialThreads } : {}
  );

  const activeWorker = workers.find(w => w.id === activeWorkerId) ?? null;
  const activeThreads = activeWorkerId ? (threadsByWorker[activeWorkerId] ?? []) : [];

  async function handleSelectWorker(id: string) {
    if (id === activeWorkerId) return;
    setActiveWorkerId(id);

    // Load threads if not cached
    if (!threadsByWorker[id]) {
      const res = await fetch(`/api/work/threads?agent_id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setThreadsByWorker(prev => ({ ...prev, [id]: data.threads ?? [] }));
      }
    }
  }

  if (workers.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-neutral-50">
        <p className="text-[13px] text-neutral-400">Your workers are being set up…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50 p-2 gap-2">

      {/* Left: roster */}
      <div className="w-[180px] flex-shrink-0">
        <WorkersRoster
          workers={workers}
          activeWorkerId={activeWorkerId}
          onSelect={handleSelectWorker}
        />
      </div>

      {/* Right: worker profile */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activeWorker ? (
          <WorkerProfile
            key={activeWorker.id}
            worker={activeWorker}
            initialThreads={activeThreads}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-2xl bg-white shadow-sm">
            <p className="text-[13px] text-neutral-400">Select a worker to get started</p>
          </div>
        )}
      </div>

    </div>
  );
}
