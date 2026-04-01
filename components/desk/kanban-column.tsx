'use client';

import { useEffect, useRef, useState } from 'react';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';
import DeskCard from './desk-card';
import PoolCard from './pool-card';

interface KanbanColumnProps {
  id: DeskColumn;
  label: string;
  items: DeskItem[];
  onMove: (id: string, column: DeskColumn) => void;
  onDismiss: (id: string) => void;
  onConfirm?: (id: string) => void;
  onSelect?: (id: string) => void;
  addingTask?: boolean;
  onAddTask?: (title: string) => void;
  onCancelAddTask?: () => void;
}

const POOL_VISIBLE_DEFAULT = 15;

export default function KanbanColumn({
  id, label, items, onMove, onDismiss, onConfirm,
  onSelect, addingTask, onAddTask, onCancelAddTask,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  const isPool = id === 'pool';

  useEffect(() => {
    if (addingTask) {
      setNewTaskTitle('');
      submittedRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [addingTask]);

  const handleDragOver = (e: React.DragEvent) => {
    if (isPool) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    if (isPool) return;
    e.preventDefault();
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData('desk-item-id');
    if (itemId) onMove(itemId, id);
  };

  const COLUMN_HEADER_COLOR: Record<DeskColumn, string> = {
    pool: 'text-violet-600',
    todo: 'text-neutral-600',
    in_progress: 'text-indigo-600',
    waiting: 'text-amber-600',
    done: 'text-green-600',
  };

  const COLUMN_DOT: Record<DeskColumn, string> = {
    pool: 'bg-violet-400',
    todo: 'bg-neutral-300',
    in_progress: 'bg-indigo-400',
    waiting: 'bg-amber-400',
    done: 'bg-green-400',
  };

  const visibleItems = isPool && !showAll ? items.slice(0, POOL_VISIBLE_DEFAULT) : items;
  const hiddenCount = isPool ? Math.max(0, items.length - POOL_VISIBLE_DEFAULT) : 0;

  return (
    <div
      className={`flex flex-col min-h-[200px] rounded-2xl shadow-sm transition-colors ${
        isDragOver ? 'bg-neutral-50' : 'bg-white'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-neutral-100">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${COLUMN_DOT[id]}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${COLUMN_HEADER_COLOR[id]}`}>
          {label}
        </span>
        {items.length > 0 && (
          <span className="ml-auto text-[11px] font-medium text-neutral-400">{items.length}</span>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2">
        {/* Inline task input (top of Todo) */}
        {addingTask && id === 'todo' && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
            <input
              ref={inputRef}
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Task title…"
              className="w-full text-[12px] text-neutral-800 placeholder-neutral-400 outline-none bg-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTaskTitle.trim()) {
                  submittedRef.current = true;
                  onAddTask?.(newTaskTitle.trim());
                  setNewTaskTitle('');
                } else if (e.key === 'Escape') {
                  submittedRef.current = true;
                  onCancelAddTask?.();
                }
              }}
              onBlur={() => {
                if (!submittedRef.current) onCancelAddTask?.();
              }}
            />
            <p className="text-[10px] text-neutral-400 mt-1">Enter to add · Esc to cancel</p>
          </div>
        )}

        {items.length === 0 && !addingTask && (
          <div className="h-8" />
        )}
        {visibleItems.map((item) =>
          isPool ? (
            <PoolCard
              key={item.id}
              item={item}
              onConfirm={onConfirm ?? (() => {})}
              onDismiss={onDismiss}
              onSelect={onSelect}
            />
          ) : (
            <DeskCard
              key={item.id}
              item={item}
              onMove={onMove}
              onDismiss={onDismiss}
              onSelect={onSelect}
            />
          )
        )}
        {isPool && !showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full text-[11px] text-neutral-500 hover:text-neutral-700 py-1.5 text-center"
          >
            + {hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}
