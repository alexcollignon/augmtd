'use client';

import { useState } from 'react';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';
import DeskCard from './desk-card';

interface KanbanColumnProps {
  id: DeskColumn;
  label: string;
  items: DeskItem[];
  onMove: (id: string, column: DeskColumn) => void;
  onDismiss: (id: string) => void;
}

export default function KanbanColumn({ id, label, items, onMove, onDismiss }: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData('desk-item-id');
    if (itemId) onMove(itemId, id);
  };

  const COLUMN_HEADER_COLOR: Record<DeskColumn, string> = {
    todo: 'text-neutral-600',
    in_progress: 'text-indigo-600',
    waiting: 'text-amber-600',
    done: 'text-green-600',
  };

  const COLUMN_DOT: Record<DeskColumn, string> = {
    todo: 'bg-neutral-300',
    in_progress: 'bg-indigo-400',
    waiting: 'bg-amber-400',
    done: 'bg-green-400',
  };

  return (
    <div
      className={`flex flex-col min-h-[200px] rounded transition-colors ${
        isDragOver ? 'bg-neutral-100' : 'bg-neutral-50'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-neutral-200">
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
        {items.length === 0 && (
          <div className="h-8" />
        )}
        {items.map((item) => (
          <DeskCard
            key={item.id}
            item={item}
            onMove={onMove}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}
