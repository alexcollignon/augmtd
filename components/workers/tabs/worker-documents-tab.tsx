'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DocumentTextIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { ArtifactPanel } from '@/components/workers/artifact-panel';

interface WorkerDocument {
  artifactId: string;
  title: string;
  taskName: string;
  workflowId: string | null;
  threadId: string;
  createdAt: string;
}

interface TaskGroup {
  taskName: string;
  workflowId: string | null;
  versions: WorkerDocument[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface WorkerDocumentsTabProps {
  workerId: string;
  workerName: string;
  onOpenInChat: (threadId: string) => void;
  onNewVersion?: (title: string) => void;
}

export function WorkerDocumentsTab({ workerId, workerName, onOpenInChat, onNewVersion }: WorkerDocumentsTabProps) {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [openArtifact, setOpenArtifact] = useState<{ artifactId: string; threadId: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const wfRes = await fetch(`/api/workflows?agent_id=${workerId}`);
      if (!wfRes.ok) return;
      const { workflows } = await wfRes.json();
      if (!workflows || workflows.length === 0) { setGroups([]); return; }

      const workflowIds: string[] = workflows.map((w: { id: string }) => w.id);
      const params = workflowIds.map(id => `workflow_ids=${encodeURIComponent(id)}`).join('&');
      const tRes = await fetch(`/api/workers/${workerId}/documents?${params}`);
      if (!tRes.ok) return;
      const { documents } = await tRes.json();

      // Group by workflowId / taskName
      const groupMap = new Map<string, TaskGroup>();
      (documents ?? []).forEach((d: WorkerDocument) => {
        const key = d.workflowId ?? d.taskName;
        if (!groupMap.has(key)) {
          groupMap.set(key, { taskName: d.taskName, workflowId: d.workflowId, versions: [] });
        }
        groupMap.get(key)!.versions.push(d);
      });

      // Sort versions newest-first within each group
      const sorted = Array.from(groupMap.values()).map(g => ({
        ...g,
        versions: [...g.versions].sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
      }));

      // Sort groups by latest version date
      sorted.sort((a, b) =>
        new Date(b.versions[0]?.createdAt ?? 0).getTime() -
        new Date(a.versions[0]?.createdAt ?? 0).getTime()
      );

      setGroups(sorted);
    } finally {
      setIsLoading(false);
    }
  }, [workerId]);

  useEffect(() => { load(); }, [load]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const allDocs = groups.flatMap(g => g.versions);

  function toggleSelect(id: string) {
    setConfirmingDelete(false);
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setConfirmingDelete(false);
    setSelected(prev => prev.size === allDocs.length ? new Set() : new Set(allDocs.map(d => d.artifactId)));
  }
  async function handleDeleteSelected() {
    if (deleting || selected.size === 0) return;
    setDeleting(true);
    setConfirmingDelete(false);
    try {
      const items = allDocs.filter(d => selected.has(d.artifactId)).map(d => ({ artifactId: d.artifactId, threadId: d.threadId }));
      await fetch(`/api/workers/${workerId}/documents`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      });
      setSelected(new Set());
      await load();
    } finally { setDeleting(false); }
  }

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDownload(doc: WorkerDocument) {
    if (downloadingId) return;
    setDownloadingId(doc.artifactId);
    try {
      const res = await fetch(`/api/work/threads/${doc.threadId}/download?artifactId=${doc.artifactId}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.title;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 px-8 py-8 space-y-3 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-14 bg-neutral-100 rounded-xl" />)}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8">
        <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center mb-2">
          <DocumentTextIcon className="w-5 h-5 text-neutral-400" />
        </div>
        <p className="text-[13px] font-medium text-neutral-700">No documents yet</p>
        <p className="text-[12px] text-neutral-400 text-center max-w-[280px] leading-relaxed">
          Documents {workerName} produces from tasks will appear here — ready to preview or download.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Document list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-[13px] font-semibold text-neutral-800">Documents</h2>
              <p className="text-[11.5px] text-neutral-400 mt-0.5">
                All outputs produced by {workerName}&apos;s tasks
              </p>
            </div>
            <div className="flex items-center gap-1">
              <label className="flex items-center gap-1.5 text-[11.5px] text-neutral-400 mr-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allDocs.length > 0 && selected.size === allDocs.length}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded accent-indigo-600"
                />
                Select all
              </label>
              {selected.size > 0 && (
                confirmingDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11.5px] text-neutral-500">Delete {selected.size} — also from Drive?</span>
                    <button onClick={handleDeleteSelected} disabled={deleting}
                      className="px-2 py-1 rounded-lg text-[11.5px] font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40">
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <button onClick={() => setConfirmingDelete(false)}
                      className="px-2 py-1 rounded-lg text-[11.5px] text-neutral-500 hover:bg-neutral-100 transition-colors">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    title="Delete selected (also removes from Drive)"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <TrashIcon className="w-3.5 h-3.5" /> Delete ({selected.size})
                  </button>
                )
              )}
              <button
                onClick={load}
                title="Refresh"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                <ArrowPathIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-3 rise-in-stagger">
            {groups.map(group => {
              const key = group.workflowId ?? group.taskName;
              const isExpanded = expandedGroups.has(key);
              const latest = group.versions[0];
              const olderVersions = group.versions.slice(1);

              return (
                <div key={key} className="rounded-xl border border-neutral-200 overflow-hidden">
                  {/* Latest version — always visible */}
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50 transition-colors group cursor-pointer"
                    onClick={() => setOpenArtifact({ artifactId: latest.artifactId, threadId: latest.threadId })}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(latest.artifactId)}
                      onClick={e => e.stopPropagation()}
                      onChange={() => toggleSelect(latest.artifactId)}
                      className="w-3.5 h-3.5 rounded accent-indigo-600 flex-shrink-0"
                    />
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                      <DocumentTextIcon className="w-4 h-4 text-indigo-500" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-neutral-800 truncate leading-tight">
                        {latest.title}
                      </p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        {group.taskName}
                        {olderVersions.length > 0 && (
                          <span className="ml-1.5 px-1 py-0.5 rounded bg-neutral-100 text-neutral-500 text-[10px]">
                            latest
                          </span>
                        )}
                        {' · '}{relativeTime(latest.createdAt)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); handleDownload(latest); }}
                        disabled={downloadingId === latest.artifactId}
                        title="Download"
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
                      >
                        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                      </button>
                      {olderVersions.length > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); toggleGroup(key); }}
                          title={isExpanded ? 'Hide older versions' : `Show ${olderVersions.length} older version${olderVersions.length > 1 ? 's' : ''}`}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
                        >
                          {isExpanded
                            ? <ChevronDownIcon className="w-3.5 h-3.5" />
                            : <ChevronRightIcon className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Older versions */}
                  {isExpanded && olderVersions.length > 0 && (
                    <div className="border-t border-neutral-100 bg-neutral-50/50">
                      {olderVersions.map((doc, idx) => (
                        <div
                          key={doc.artifactId}
                          className={`flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-100/60 transition-colors group cursor-pointer ${idx < olderVersions.length - 1 ? 'border-b border-neutral-100' : ''}`}
                          onClick={() => setOpenArtifact({ artifactId: doc.artifactId, threadId: doc.threadId })}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(doc.artifactId)}
                            onClick={e => e.stopPropagation()}
                            onChange={() => toggleSelect(doc.artifactId)}
                            className="w-3.5 h-3.5 rounded accent-indigo-600 flex-shrink-0 ml-1"
                          />
                          <div className="w-6 h-6 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
                            <DocumentTextIcon className="w-3 h-3 text-neutral-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] text-neutral-600 truncate">{doc.title}</p>
                            <p className="text-[10.5px] text-neutral-400">{relativeTime(doc.createdAt)}</p>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); handleDownload(doc); }}
                            disabled={downloadingId === doc.artifactId}
                            title="Download"
                            className="p-1 rounded-md text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40 flex-shrink-0"
                          >
                            <ArrowDownTrayIcon className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Artifact preview panel */}
      {openArtifact && (
        <div className="border-l border-neutral-100 overflow-hidden flex">
          <ArtifactPanel
            key={openArtifact.artifactId}
            artifactId={openArtifact.artifactId}
            threadId={openArtifact.threadId}
            onClose={() => setOpenArtifact(null)}
            onNewVersion={(title) => {
              setOpenArtifact(null);
              onNewVersion?.(title);
            }}
          />
        </div>
      )}
    </div>
  );
}
