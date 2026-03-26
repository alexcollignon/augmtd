'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import { WorkspaceTabBar } from '@/components/work/workspace-tab-bar';
import type { ProcessListItem, ProcessStatus } from '@/lib/types/process';
import {
  PlusIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ClockIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

interface Props {
  userId: string;
  userEmail: string;
  companyName: string;
}

function StatusBadge({ status }: { status: ProcessStatus | 'needs_action' | 'at_risk' | 'on_track' }) {
  const map: Record<string, string> = {
    draft: 'bg-neutral-100 text-neutral-600',
    active: 'bg-blue-50 text-blue-700',
    completed: 'bg-green-50 text-green-700',
    archived: 'bg-neutral-100 text-neutral-400',
    needs_action: 'bg-amber-50 text-amber-700',
    at_risk: 'bg-orange-50 text-orange-700',
    on_track: 'bg-green-50 text-green-700',
    blocked: 'bg-red-50 text-red-700',
  };
  const label: Record<string, string> = {
    draft: 'Draft',
    active: 'Active',
    completed: 'Completed',
    archived: 'Archived',
    needs_action: 'Needs action',
    at_risk: 'At risk',
    on_track: 'On track',
    blocked: 'Blocked',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${map[status] ?? map.draft}`}>
      {label[status] ?? status}
    </span>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-neutral-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

type Tab = 'needs_action' | 'watching' | 'owned' | 'all';

export function ProcessesClient({ userId, userEmail, companyName }: Props) {
  const router = useRouter();
  const [processes, setProcesses] = useState<ProcessListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/processes');
      if (res.ok) {
        const data = await res.json();
        setProcesses(data.processes ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteProcess = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this process? All steps and comments will be permanently removed.')) return;
    const res = await fetch(`/api/processes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setProcesses(prev => prev.filter(p => p.id !== id));
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? 'Failed to delete process');
    }
  };

  const onDesk = processes.filter((p) => p.on_desk_of_me);
  const watching = processes.filter((p) => !p.on_desk_of_me && p.owner_id !== userId);
  const owned = processes.filter((p) => p.owner_id === userId && !p.on_desk_of_me);

  const blockedCount = processes.filter((p) => p.status === 'active' && !p.on_desk_of_me).length;
  const needsActionCount = onDesk.length;

  const tabItems: Record<Tab, ProcessListItem[]> = {
    needs_action: onDesk,
    watching,
    owned,
    all: processes,
  };

  const displayed = tabItems[activeTab];

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <SidebarNav userEmail={userEmail} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <WorkspaceTabBar />
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-neutral-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-neutral-900">Processes</h1>
              <p className="text-[12px] text-neutral-500 mt-0.5">{companyName} · Collaborative team workflows</p>
            </div>
            <button
              onClick={() => router.push('/processes/new')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[12px] font-medium hover:bg-indigo-700 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              New Process
            </button>
          </div>

          {/* Stats bar */}
          <div className="flex gap-4 mt-3">
            {[
              { label: 'Needs my action', value: needsActionCount, color: 'text-amber-600' },
              { label: 'Blocked', value: blockedCount, color: 'text-red-600' },
              { label: 'Active', value: processes.filter(p => p.status === 'active').length, color: 'text-blue-600' },
              { label: 'Completed', value: processes.filter(p => p.status === 'completed').length, color: 'text-green-600' },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center gap-1.5">
                <span className={`text-[13px] font-semibold ${stat.color}`}>{stat.value}</span>
                <span className="text-[11px] text-neutral-500">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Smart banner */}
        {blockedCount > 0 && (
          <div className="flex-shrink-0 mx-6 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded flex items-center gap-2">
            <ExclamationTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-[12px] text-red-700">
              You have {blockedCount} blocked {blockedCount === 1 ? 'process' : 'processes'} waiting on other team members.
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex-shrink-0 px-6 mt-3 border-b border-neutral-200 bg-white">
          <div className="flex gap-0">
            {([
              ['all', 'All'],
              ['needs_action', 'Needs my action'],
              ['watching', 'Watching'],
              ['owned', 'Owned by me'],
            ] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-500 text-indigo-700'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                }`}
              >
                {label}
                {tab === 'needs_action' && needsActionCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded-full">
                    {needsActionCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-neutral-400 text-[13px] py-8">
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
              Loading processes...
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-16">
              <ArrowPathIcon className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
              <p className="text-[13px] text-neutral-500">No processes here yet.</p>
              {activeTab === 'all' && (
                <button
                  onClick={() => router.push('/processes/new')}
                  className="mt-3 px-4 py-2 bg-indigo-600 text-white text-[12px] rounded hover:bg-indigo-700"
                >
                  Create your first process
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* ON MY DESK section */}
              {activeTab === 'all' && onDesk.length > 0 && (
                <ProcessSection
                  title={`ON MY DESK (${onDesk.length})`}
                  items={onDesk}
                  userId={userId}
                  onRowClick={(id) => router.push(`/processes/${id}`)}
                  onDelete={deleteProcess}
                />
              )}

              {/* Main table */}
              {activeTab !== 'all' ? (
                <ProcessSection
                  title={activeTab === 'needs_action' ? `ON MY DESK (${displayed.length})` : undefined}
                  items={displayed}
                  userId={userId}
                  onRowClick={(id) => router.push(`/processes/${id}`)}
                  onDelete={deleteProcess}
                />
              ) : watching.length > 0 || owned.length > 0 ? (
                <ProcessSection
                  title={`OTHER PROCESSES (${processes.length - onDesk.length})`}
                  items={[...owned, ...watching]}
                  userId={userId}
                  onRowClick={(id) => router.push(`/processes/${id}`)}
                  onDelete={deleteProcess}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProcessSection({
  title,
  items,
  userId,
  onRowClick,
  onDelete,
}: {
  title?: string;
  items: ProcessListItem[];
  userId: string;
  onRowClick: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}) {
  return (
    <div>
      {title && (
        <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">{title}</h2>
      )}
      <div className="bg-white border border-neutral-200 rounded overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-neutral-100">
              {['Process', 'Current Step', 'On desk of', 'Owner', 'Due', 'Progress', 'Status', ''].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-[11px] font-medium text-neutral-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr
                key={p.id}
                onClick={() => onRowClick(p.id)}
                className="border-b border-neutral-50 hover:bg-neutral-50 cursor-pointer transition-colors group"
              >
                <td className="px-4 py-3 font-medium text-neutral-900 max-w-[200px] truncate">{p.title}</td>
                <td className="px-4 py-3 text-neutral-600 max-w-[160px] truncate">
                  {p.current_step_title ?? '—'}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {p.current_step_assignee_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-neutral-600">{p.owner_name ?? '—'}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {p.due_date ? new Date(p.due_date).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 w-32">
                  <ProgressBar current={p.current_step} total={p.total_steps} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-3 w-8 text-right">
                  {p.owner_id === userId && (
                    <button
                      onClick={(e) => onDelete(p.id, e)}
                      title="Delete process"
                      className="opacity-0 group-hover:opacity-100 p-1 text-neutral-300 hover:text-red-500 transition-all rounded"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
