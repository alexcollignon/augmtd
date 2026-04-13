'use client';

import { useState } from 'react';
import {
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export interface ChatThread {
  id: string;
  title: string;
  updated_at: string;
  process_title?: string | null;
  agent_name?: string | null;
  agent_color?: string | null;
}

const AGENT_DOT: Record<string, string> = {
  indigo:  'bg-indigo-500',
  violet:  'bg-violet-500',
  blue:    'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-500',
  rose:    'bg-rose-500',
  neutral: 'bg-neutral-400',
};

interface Props {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ChatThreadSidebar({
  threads,
  activeThreadId,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEdit(thread: ChatThread, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(thread.id);
    setEditTitle(thread.title);
    setConfirmDeleteId(null);
  }

  function commitEdit(id: string) {
    if (editTitle.trim()) onRename(id, editTitle.trim());
    setEditingId(null);
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
      {threads.length === 0 && (
        <p className="px-3 py-4 text-[12px] text-neutral-400 text-center">No chats yet</p>
      )}
      {threads.map((thread) => (
        <div
          key={thread.id}
          className="relative"
          onMouseEnter={() => setHoveredId(thread.id)}
          onMouseLeave={() => {
            setHoveredId(null);
            setConfirmDeleteId(null);
          }}
        >
          {editingId === thread.id ? (
            <div className="flex items-center gap-1 px-2 py-1.5">
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(thread.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onBlur={() => commitEdit(thread.id)}
                className="flex-1 min-w-0 text-[12px] bg-neutral-50 border border-neutral-200 rounded-md px-2 py-1 outline-none focus:border-indigo-400"
              />
              <button
                onMouseDown={(e) => { e.preventDefault(); commitEdit(thread.id); }}
                className="p-1 rounded text-green-600 hover:bg-green-50 flex-shrink-0"
              >
                <CheckIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); setEditingId(null); }}
                className="p-1 rounded text-neutral-400 hover:bg-neutral-100 flex-shrink-0"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(thread.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(thread.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
                activeThreadId === thread.id
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              <div className="text-[12.5px] font-medium truncate pr-10 leading-snug">
                {thread.title}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {thread.process_title && (
                  <span className="text-[10.5px] text-violet-500 truncate max-w-[80px]">
                    ↑ {thread.process_title}
                  </span>
                )}
                {thread.agent_name && (
                  <span className="inline-flex items-center gap-1 flex-shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${AGENT_DOT[thread.agent_color ?? 'indigo'] ?? AGENT_DOT.indigo}`} />
                    <span className="text-[10.5px] text-neutral-400 truncate max-w-[80px]">{thread.agent_name}</span>
                  </span>
                )}
                <span className="text-[11px] text-neutral-400">
                  {relativeTime(thread.updated_at)}
                </span>
              </div>

              {/* Hover actions */}
              {hoveredId === thread.id && editingId !== thread.id && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  {confirmDeleteId === thread.id ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(thread.id);
                          setConfirmDeleteId(null);
                        }}
                        className="p-1 rounded text-red-500 hover:bg-red-50 transition-colors"
                        title="Confirm delete"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                        className="p-1 rounded text-neutral-400 hover:bg-neutral-100 transition-colors"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => startEdit(thread, e)}
                        className="p-1 rounded text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
                        title="Rename"
                      >
                        <PencilIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(thread.id);
                        }}
                        className="p-1 rounded text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
