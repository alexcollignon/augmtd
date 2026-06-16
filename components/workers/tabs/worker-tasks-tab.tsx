'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  BoltIcon,
  PlayIcon,
  PauseIcon,
  ClockIcon,
  CheckCircleIcon,
  EllipsisHorizontalIcon,
  PlusIcon,
  XMarkIcon,
  Cog6ToothIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  UsersIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused';
  trigger: {
    type: 'schedule' | 'manual';
    cron?: string;
    timezone?: string;
    label?: string;
  };
  last_run_at: string | null;
  next_run_at: string | null;
  agent_id: string | null;
  sharing_mode: string | null;
  is_owned_by_me?: boolean;
  owner_name?: string | null;
}

interface TeamTask {
  id: string;
  name: string;
  description: string | null;
  status: string;
  trigger: {
    type: 'schedule' | 'manual';
    cron?: string;
    label?: string;
  };
  owner_name: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scheduleLabel(trigger: Task['trigger'] | TeamTask['trigger']): string {
  if (trigger.type === 'manual') return 'Manual trigger';
  if (trigger.label) return trigger.label;
  if (trigger.cron) return trigger.cron;
  return 'Scheduled';
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never run';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function upcomingTime(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'Overdue';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `next in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `next in ${hours}h`;
  return `next in ${Math.floor(hours / 24)}d`;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface WorkerTasksTabProps {
  workerId: string;
  workerName: string;
  isActive?: boolean;
  onOpenInChat: (threadId: string) => void;
}

export function WorkerTasksTab({ workerId, workerName, isActive, onOpenInChat }: WorkerTasksTabProps) {
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [teamTasks, setTeamTasks] = useState<TeamTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [usingTaskId, setUsingTaskId] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);

  const load = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      fetch(`/api/workflows?agent_id=${workerId}`).then(r => r.json()),
      fetch('/api/workflows?company_tasks=true').then(r => r.json()),
    ])
      .then(([myData, teamData]) => {
        setMyTasks(myData.workflows ?? []);
        setTeamTasks(teamData.workflows ?? []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [workerId]);

  useEffect(() => { load(); }, [load]);

  // Reload when tab becomes active after being hidden — skip first render
  const prevActiveRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevActiveRef.current === null) { prevActiveRef.current = !!isActive; return; }
    if (isActive && !prevActiveRef.current) load();
    prevActiveRef.current = !!isActive;
  }, [isActive, load]);

  async function handleDelete(taskId: string) {
    setMyTasks(prev => prev.filter(t => t.id !== taskId));
    await fetch(`/api/workflows/${taskId}`, { method: 'DELETE' }).catch(() => {});
  }

  async function handleDuplicate(taskId: string) {
    if (duplicatingId) return;
    setDuplicatingId(taskId);
    try {
      const res = await fetch(`/api/workflows/${taskId}`);
      if (!res.ok) return;
      const { workflow: src } = await res.json();
      const createRes = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Copy of ${src.name}`,
          description: src.description,
          icon: src.icon,
          color: src.color,
          trigger: src.trigger,
          steps: src.steps,
          output_config: src.output_config,
          worker_instructions: src.worker_instructions ?? null,
          agent_id: workerId,
          status: 'paused',
        }),
      });
      if (createRes.ok) {
        const { workflow } = await createRes.json();
        setMyTasks(prev => [{ ...workflow, sharing_mode: null, is_owned_by_me: true }, ...prev]);
      }
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleToggleShare(taskId: string, currentMode: string | null) {
    if (sharingId) return;
    setSharingId(taskId);
    const nextMode = currentMode ? null : 'live';
    setMyTasks(prev => prev.map(t => t.id === taskId ? { ...t, sharing_mode: nextMode } : t));
    try {
      await fetch(`/api/workflows/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharing_mode: nextMode }),
      });
    } catch {
      setMyTasks(prev => prev.map(t => t.id === taskId ? { ...t, sharing_mode: currentMode } : t));
    } finally {
      setSharingId(null);
    }
  }

  async function handleUseTask(sourceId: string) {
    if (usingTaskId) return;
    setUsingTaskId(sourceId);
    try {
      const res = await fetch(`/api/workflows/${sourceId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: workerId }),
      });
      if (res.ok) {
        const data = await res.json();
        const workflow = data.workflow;
        if (workflow) {
          setMyTasks(prev => [{ ...workflow, sharing_mode: null, is_owned_by_me: true }, ...prev]);
        }
      }
    } finally {
      setUsingTaskId(null);
    }
  }

  async function handleToggle(task: Task) {
    if (togglingId) return;
    const next = task.status === 'active' ? 'paused' : 'active';
    setMyTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
    setTogglingId(task.id);
    try {
      await fetch(`/api/workflows/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      setMyTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleOpenLatestRun(taskId: string) {
    if (openingId) return;
    setOpeningId(taskId);
    try {
      const res = await fetch(`/api/workflows/${taskId}/runs?limit=1`);
      if (!res.ok) return;
      const { runs } = await res.json();
      const threadId = runs?.[0]?.thread_id;
      if (threadId) onOpenInChat(threadId);
    } finally {
      setOpeningId(null);
    }
  }

  async function handleRunNow(taskId: string) {
    if (runningId) return;
    setRunningId(taskId);
    try {
      const res = await fetch(`/api/workflows/${taskId}/run`, { method: 'POST' });
      if (res.ok) {
        await new Promise(r => setTimeout(r, 1500));
        const runsRes = await fetch(`/api/workflows/${taskId}/runs?limit=1`);
        if (runsRes.ok) {
          const { runs } = await runsRes.json();
          const threadId = runs?.[0]?.thread_id;
          if (threadId) onOpenInChat(threadId);
        }
      }
    } finally {
      setRunningId(null);
    }
  }

  function handleTaskCreated(task: Task) {
    setMyTasks(prev => [{ ...task, sharing_mode: null, is_owned_by_me: true }, ...prev]);
    setShowNewTask(false);
  }

  if (isLoading) {
    return (
      <div className="flex-1 px-8 py-8 space-y-3 animate-pulse">
        {[1, 2].map(i => <div key={i} className="h-16 bg-neutral-100 rounded-xl" />)}
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-8">

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-[13px] font-semibold text-neutral-800">Tasks</h2>
              <p className="text-[11.5px] text-neutral-400 mt-0.5">
                Scheduled tasks {workerName} runs automatically
              </p>
            </div>
            <button
              onClick={() => setShowNewTask(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[12px] font-medium transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              New task
            </button>
          </div>

          {/* My tasks */}
          {myTasks.length === 0 ? (
            <EmptyTasks workerName={workerName} workerId={workerId} onNew={() => setShowNewTask(true)} />
          ) : (
            <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 mb-6">
              {myTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isToggling={togglingId === task.id}
                  isOpening={openingId === task.id}
                  isRunning={runningId === task.id}
                  isDuplicating={duplicatingId === task.id}
                  isSharing={sharingId === task.id}
                  onToggle={() => handleToggle(task)}
                  onOpenLatestRun={() => handleOpenLatestRun(task.id)}
                  onRunNow={() => handleRunNow(task.id)}
                  onDuplicate={() => handleDuplicate(task.id)}
                  onDelete={() => handleDelete(task.id)}
                  onToggleShare={() => handleToggleShare(task.id, task.sharing_mode ?? null)}
                />
              ))}
            </div>
          )}

          {/* From the team */}
          {teamTasks.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <UsersIcon className="w-3.5 h-3.5 text-neutral-400" />
                <h3 className="text-[11.5px] font-semibold text-neutral-500 uppercase tracking-wide">From the team</h3>
              </div>
              <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100">
                {teamTasks.map(task => (
                  <TeamTaskRow
                    key={task.id}
                    task={task}
                    isUsing={usingTaskId === task.id}
                    onUse={() => handleUseTask(task.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Advanced escape hatch */}
          <p className="mt-5 text-center text-[11px] text-neutral-400">
            Need a complex pipeline?{' '}
            <Link href={`/studio?assign_worker=${workerId}`} className="text-neutral-500 hover:text-indigo-600 underline underline-offset-2 transition-colors">
              Open in Studio
            </Link>
          </p>

        </div>
      </div>

      {/* New task modal */}
      {showNewTask && (
        <NewTaskModal
          workerId={workerId}
          workerName={workerName}
          onClose={() => setShowNewTask(false)}
          onCreated={handleTaskCreated}
        />
      )}
    </>
  );
}

// ─── My task row ──────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task;
  isToggling: boolean;
  isOpening: boolean;
  isRunning: boolean;
  isDuplicating: boolean;
  isSharing: boolean;
  onToggle: () => void;
  onOpenLatestRun: () => void;
  onRunNow: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleShare: () => void;
}

function TaskRow({ task, isToggling, isOpening, isRunning, isDuplicating, isSharing, onToggle, onOpenLatestRun, onRunNow, onDuplicate, onDelete, onToggleShare }: TaskRowProps) {
  const isActive = task.status === 'active';
  const isDraft = task.status === 'draft';
  const isShared = task.sharing_mode === 'live';
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50 transition-colors group relative">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRunning ? 'bg-amber-400 animate-pulse' : isActive ? 'bg-emerald-400' : 'bg-neutral-300'}`} />

      <button className="min-w-0 flex-1 text-left" onClick={onOpenLatestRun} disabled={isOpening}>
        <div className="flex items-center gap-1.5">
          <p className={`text-[13px] font-medium truncate transition-colors ${
            isOpening ? 'text-neutral-400' : 'text-neutral-700 group-hover:text-indigo-600'
          }`}>
            {isOpening ? 'Opening…' : task.name}
          </p>
          {isShared && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 text-[9.5px] font-medium flex-shrink-0">
              <UsersIcon className="w-2.5 h-2.5" />
              Shared
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="flex items-center gap-1 text-[11px] text-neutral-400">
            <ClockIcon className="w-3 h-3" />
            {scheduleLabel(task.trigger)}
          </span>
          {task.last_run_at && (
            <span className="flex items-center gap-1 text-[11px] text-neutral-400">
              <CheckCircleIcon className="w-3 h-3" />
              {relativeTime(task.last_run_at)}
            </span>
          )}
          {isActive && task.next_run_at && (
            <span className="text-[11px] text-neutral-400">{upcomingTime(task.next_run_at)}</span>
          )}
          {isDraft && (
            <span className="text-[10.5px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded-full">Draft</span>
          )}
        </div>
      </button>

      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {!isDraft && (
          <>
            <button
              onClick={onRunNow}
              disabled={isRunning}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-medium text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40"
            >
              <BoltIcon className={`w-3 h-3 ${isRunning ? 'text-amber-400' : ''}`} />
              {isRunning ? 'Running…' : 'Run now'}
            </button>
            <button
              onClick={onToggle}
              disabled={isToggling}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-medium transition-colors disabled:opacity-40 ${
                isActive
                  ? 'text-neutral-500 hover:text-amber-600 hover:bg-amber-50'
                  : 'text-neutral-500 hover:text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              {isActive
                ? <><PauseIcon className="w-3 h-3" />Pause</>
                : <><PlayIcon className="w-3 h-3" />Resume</>}
            </button>
          </>
        )}

        <div className="relative">
          <button
            onClick={() => setShowMenu(v => !v)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          >
            <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-neutral-200 py-1 z-50 text-[12.5px]">
                <Link
                  href={`/studio?workflow=${task.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
                  onClick={() => setShowMenu(false)}
                >
                  <Cog6ToothIcon className="w-3.5 h-3.5 text-neutral-400" />
                  Advanced settings
                </Link>
                <button
                  onClick={() => { setShowMenu(false); onDuplicate(); }}
                  disabled={isDuplicating}
                  className="w-full flex items-center gap-2 px-3 py-2 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors disabled:opacity-40"
                >
                  <DocumentDuplicateIcon className="w-3.5 h-3.5 text-neutral-400" />
                  {isDuplicating ? 'Duplicating…' : 'Duplicate task'}
                </button>
                <button
                  onClick={() => { setShowMenu(false); onToggleShare(); }}
                  disabled={isSharing}
                  className="w-full flex items-center gap-2 px-3 py-2 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors disabled:opacity-40"
                >
                  {isShared
                    ? <><LockClosedIcon className="w-3.5 h-3.5 text-neutral-400" />Stop sharing</>
                    : <><UsersIcon className="w-3.5 h-3.5 text-neutral-400" />Share with team</>}
                </button>
                <div className="border-t border-neutral-100 my-1" />
                {confirmDelete ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <p className="text-[11.5px] text-neutral-500">Delete this task?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowMenu(false); setConfirmDelete(false); onDelete(); }}
                        className="flex-1 py-1 rounded-lg bg-red-500 text-white text-[11.5px] font-medium hover:bg-red-600 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 py-1 rounded-lg bg-neutral-100 text-neutral-600 text-[11.5px] hover:bg-neutral-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    Delete task
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Team task row ────────────────────────────────────────────────────────────

function TeamTaskRow({ task, isUsing, onUse }: { task: TeamTask; isUsing: boolean; onUse: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50 transition-colors group">
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-indigo-200" />

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-neutral-700 truncate">{task.name}</p>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="flex items-center gap-1 text-[11px] text-neutral-400">
            <ClockIcon className="w-3 h-3" />
            {scheduleLabel(task.trigger)}
          </span>
          {task.owner_name && (
            <span className="text-[11px] text-neutral-400">from {task.owner_name}</span>
          )}
        </div>
      </div>

      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={onUse}
          disabled={isUsing}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-medium text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40"
        >
          <PlusIcon className="w-3 h-3" />
          {isUsing ? 'Adding…' : 'Use task'}
        </button>
      </div>
    </div>
  );
}

// ─── New task modal ───────────────────────────────────────────────────────────

interface NewTaskModalProps {
  workerId: string;
  workerName: string;
  onClose: () => void;
  onCreated: (task: Task) => void;
}

function NewTaskModal({ workerId, workerName, onClose, onCreated }: NewTaskModalProps) {
  const [description, setDescription] = useState('');
  const [taskInstructions, setTaskInstructions] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [status, setStatus] = useState<'idle' | 'generating' | 'creating'>('idle');
  const [error, setError] = useState<string | null>(null);

  const isBusy = status !== 'idle';

  async function handleCreate() {
    if (!description.trim() || isBusy) return;
    setError(null);
    setStatus('generating');

    try {
      const genRes = await fetch('/api/workflows/generate-from-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          agent_id: workerId,
          worker_instructions: taskInstructions.trim() || null,
        }),
      });
      if (!genRes.ok) {
        const { error: msg } = await genRes.json().catch(() => ({}));
        throw new Error(msg ?? 'Could not generate a task from that description. Try rephrasing.');
      }
      const { workflow: generated } = await genRes.json();

      setStatus('creating');

      const createRes = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...generated,
          agent_id: workerId,
          status: 'active',
          worker_instructions: generated.worker_instructions ?? null,
        }),
      });
      if (!createRes.ok) throw new Error('Failed to save the task.');
      const { workflow } = await createRes.json();
      onCreated(workflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStatus('idle');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate();
  }

  const buttonLabel = status === 'generating' ? 'Building pipeline…' : status === 'creating' ? 'Saving…' : 'Create task';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
      <div className="w-full max-w-[520px] bg-white rounded-2xl shadow-xl border border-neutral-200 overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <div>
            <h2 className="text-[14px] font-semibold text-neutral-800">New task</h2>
            <p className="text-[11.5px] text-neutral-400 mt-0.5">
              Describe what {workerName} should do — and when.
            </p>
          </div>
          <button onClick={onClose} disabled={isBusy} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors disabled:opacity-40">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <textarea
            autoFocus
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            placeholder={`e.g. "Every Monday morning, scan my inbox for client emails and write me a brief" or "Every Friday, search for industry news and summarise the top 5 stories"`}
            rows={4}
            className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-[13px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-300 focus:shadow-sm transition-all resize-none leading-relaxed disabled:opacity-50"
          />

          {!showInstructions ? (
            <button
              type="button"
              onClick={() => setShowInstructions(true)}
              disabled={isBusy}
              className="text-[11.5px] text-neutral-400 hover:text-indigo-500 transition-colors disabled:opacity-40"
            >
              + Add tone / persona for this task
            </button>
          ) : (
            <div className="space-y-1">
              <label className="block text-[11.5px] font-medium text-neutral-500">Tone / persona (optional)</label>
              <textarea
                value={taskInstructions}
                onChange={e => setTaskInstructions(e.target.value)}
                disabled={isBusy}
                placeholder={`e.g. "Write in the style of a German financial journalist — terse, data-driven, no fluff."`}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-[13px] text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-300 transition-all resize-none leading-relaxed disabled:opacity-50"
              />
              <p className="text-[11px] text-neutral-400">Specific to this task — doesn&apos;t change {workerName}&apos;s core identity.</p>
            </div>
          )}

          <p className="text-[11px] text-neutral-400">
            AI builds a multi-step pipeline and detects the schedule automatically. ⌘↵ to submit.
          </p>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-100">
          <button
            onClick={onClose}
            disabled={isBusy}
            className="px-4 py-2 rounded-xl text-[12.5px] text-neutral-600 hover:bg-neutral-100 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!description.trim() || isBusy}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-[12.5px] font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40"
          >
            {isBusy && (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {buttonLabel}
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyTasks({ workerName, workerId, onNew }: { workerName: string; workerId: string; onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-200 px-6 py-12 text-center">
      <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-4">
        <BoltIcon className="w-5 h-5 text-neutral-400" />
      </div>
      <p className="text-[13px] font-medium text-neutral-700 mb-2">No tasks running yet</p>
      <p className="text-[12.5px] text-neutral-400 max-w-[320px] mx-auto leading-relaxed mb-5">
        Tell {workerName} in chat what you want automated, or create a task directly.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-[12.5px] font-medium hover:bg-indigo-100 transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          New task
        </button>
        <Link
          href={`/studio?assign_worker=${workerId}`}
          className="px-3.5 py-2 rounded-xl border border-neutral-200 text-neutral-500 text-[12.5px] hover:border-neutral-300 hover:text-neutral-700 transition-colors"
        >
          Open Studio
        </Link>
      </div>
    </div>
  );
}
