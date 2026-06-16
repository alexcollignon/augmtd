'use client';

import { useState } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import type { WorkerThread } from '@/app/workers/workers-page-client';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface WorkerThreadListProps {
  threads: WorkerThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function WorkerThreadList({ threads, activeThreadId, onSelect, onDelete }: WorkerThreadListProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-24">
        <p className="text-[12px] text-neutral-400">No conversations yet</p>
      </div>
    );
  }

  async function handleConfirmDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setConfirmId(null);
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  }

  function handleRequestDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setConfirmId(id);
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmId(null);
  }

  return (
    <div className="p-1.5 space-y-0.5">
      {threads.map((thread) => {
        const isActive = thread.id === activeThreadId;
        const isDeleting = deletingId === thread.id;
        const isConfirming = confirmId === thread.id;
        const isHovered = hoveredId === thread.id;

        return (
          <div
            key={thread.id}
            onMouseEnter={() => setHoveredId(thread.id)}
            onMouseLeave={() => { setHoveredId(null); if (confirmId === thread.id) setConfirmId(null); }}
            className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${
              isActive ? 'bg-indigo-50' : 'hover:bg-neutral-50'
            } ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
            onClick={() => !isConfirming && onSelect(thread.id)}
          >
            {/* Thread info */}
            <div className="min-w-0 flex-1">
              <p className={`text-[12.5px] font-medium truncate leading-tight ${
                isActive ? 'text-indigo-700' : 'text-neutral-700'
              }`}>
                {thread.title}
              </p>
              <p className="text-[10.5px] text-neutral-400 mt-0.5 leading-tight">
                {relativeTime(thread.updated_at)}
              </p>
            </div>

            {/* Inline delete confirmation */}
            {isConfirming ? (
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  onClick={handleCancelDelete}
                  className="px-2 py-0.5 rounded-md text-[11px] text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => handleConfirmDelete(e, thread.id)}
                  className="px-2 py-0.5 rounded-md text-[11px] text-white bg-red-500 hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            ) : isHovered && (
              <button
                onClick={(e) => handleRequestDelete(e, thread.id)}
                className="p-1 rounded-md text-neutral-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
                title="Delete conversation"
              >
                <TrashIcon className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
