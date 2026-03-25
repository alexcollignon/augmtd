'use client';

import Link from 'next/link';
import {
  EnvelopeIcon,
  MicrophoneIcon,
  RectangleStackIcon,
  XMarkIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';
import { SOURCE_LABELS } from '@/lib/types/desk';

interface DeskCardProps {
  item: DeskItem;
  onMove: (id: string, column: DeskColumn) => void;
  onDismiss: (id: string) => void;
  onSelect?: (id: string) => void;
}

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: EnvelopeIcon,
  meeting_action: MicrophoneIcon,
  process_step: RectangleStackIcon,
  manual: RectangleStackIcon,
};

const URGENCY_DOT: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-neutral-300',
};

export default function DeskCard({ item, onMove, onDismiss, onSelect }: DeskCardProps) {
  const SourceIcon = SOURCE_ICONS[item.sourceType] ?? RectangleStackIcon;
  const isDone = item.column === 'done';
  const synthesizing = !item.synthesis && !item.synthesisAt && item.sourceType === 'email';
  const bodyText = item.synthesis || (!synthesizing ? item.description : null);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('desk-item-id', item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onSelect?.(item.id)}
      className={`group bg-white border border-neutral-100 px-3 py-2 cursor-pointer transition-all hover:shadow-sm hover:border-neutral-200 ${
        isDone ? 'opacity-55' : ''
      }`}
    >
      {/* Title row */}
      <div className="flex items-start gap-1.5">
        <SourceIcon className="w-3 h-3 text-neutral-400 flex-shrink-0 mt-px" />
        <p className={`text-[12px] font-medium leading-snug line-clamp-1 flex-1 min-w-0 ${isDone ? 'line-through text-neutral-400' : 'text-neutral-900'}`}>
          {item.title}
        </p>
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {item.sourceUrl && (
            <Link href={item.sourceUrl} title="Open" onClick={(e) => e.stopPropagation()}>
              <ArrowTopRightOnSquareIcon className="w-3 h-3 text-neutral-400 hover:text-indigo-500" />
            </Link>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
            className="p-0.5 text-neutral-300 hover:text-red-500 transition-colors"
            title="Remove"
          >
            <XMarkIcon className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 mt-0.5 pl-4">
        <span className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
          {SOURCE_LABELS[item.sourceType]}
        </span>
        {item.sourceType === 'email' && item.emailCount > 1 && (
          <span className="text-[10px] text-neutral-400">· {item.emailCount}</span>
        )}
        {item.urgency && (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${URGENCY_DOT[item.urgency] ?? 'bg-neutral-300'}`} />
        )}
      </div>

      {/* Body */}
      {synthesizing && (
        <div className="pl-4 mt-1 space-y-1">
          <div className="h-2 bg-neutral-100 animate-pulse rounded w-full" />
          <div className="h-2 bg-neutral-100 animate-pulse rounded w-3/4" />
        </div>
      )}
      {bodyText && (
        <p className="pl-4 mt-0.5 text-[11px] text-neutral-500 leading-snug line-clamp-1">
          {bodyText}
        </p>
      )}

      {/* Quick actions on hover */}
      {!isDone && (
        <div className="flex items-center gap-2 mt-1.5 pl-4 opacity-0 group-hover:opacity-100 transition-opacity">
          {item.column !== 'in_progress' && (
            <button
              onClick={(e) => { e.stopPropagation(); onMove(item.id, 'in_progress'); }}
              className="text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
            >
              Start
            </button>
          )}
          {item.column !== 'waiting' && (
            <button
              onClick={(e) => { e.stopPropagation(); onMove(item.id, 'waiting'); }}
              className="text-[10px] font-medium text-neutral-500 hover:text-neutral-700"
            >
              Waiting
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onMove(item.id, 'done'); }}
            className="text-[10px] font-medium text-green-600 hover:text-green-700 flex items-center gap-0.5"
          >
            <CheckIcon className="w-3 h-3" />
            Done
          </button>
        </div>
      )}
    </div>
  );
}
