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

export default function DeskCard({ item, onMove, onDismiss }: DeskCardProps) {
  const SourceIcon = SOURCE_ICONS[item.sourceType] ?? RectangleStackIcon;
  const isDone = item.column === 'done';
  const synthesizing = !item.synthesis && !item.synthesisAt && item.sourceType === 'email';

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('desk-item-id', item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`group bg-white border border-neutral-100 p-3 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm hover:border-neutral-200 ${
        isDone ? 'opacity-55' : ''
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-6 h-6 bg-neutral-100 flex items-center justify-center mt-0.5">
          <SourceIcon className="w-3.5 h-3.5 text-neutral-500" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-start gap-1">
            <p className={`text-[13px] font-medium leading-tight flex-1 ${isDone ? 'line-through text-neutral-400' : 'text-neutral-900'}`}>
              {item.title}
            </p>
            {item.sourceUrl && (
              <Link
                href={item.sourceUrl}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Open"
              >
                <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 text-neutral-400 hover:text-indigo-500 mt-0.5" />
              </Link>
            )}
          </div>

          {/* Source badge row */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
              {SOURCE_LABELS[item.sourceType]}
            </span>
            {item.sourceType === 'email' && item.emailCount > 1 && (
              <span className="text-[10px] text-neutral-400">· {item.emailCount} emails</span>
            )}
            {item.urgency && (
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${URGENCY_DOT[item.urgency] ?? 'bg-neutral-300'}`} />
            )}
            {item.hasPrepared && (
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-indigo-400" title="AUGMTD has prepared a draft" />
            )}
          </div>
        </div>

        {/* Dismiss */}
        <button
          onClick={() => onDismiss(item.id)}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-red-500 text-neutral-300"
          title="Remove from desk"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body — synthesis > ai_context > description */}
      <div className="pl-8 mt-1.5">
        {synthesizing && !item.synthesis && (
          <div className="space-y-1">
            <div className="h-2.5 bg-neutral-100 animate-pulse rounded w-full" />
            <div className="h-2.5 bg-neutral-100 animate-pulse rounded w-4/5" />
          </div>
        )}
        {item.synthesis && (
          <p className="text-[11px] text-neutral-600 leading-snug">
            {item.synthesis}
          </p>
        )}
        {!item.synthesis && !synthesizing && item.description && (
          <p className="text-[11px] text-neutral-500 leading-snug line-clamp-2">
            {item.description}
          </p>
        )}
      </div>

      {/* Quick actions */}
      {!isDone && (
        <div className="flex items-center gap-2 mt-2.5 pl-8 opacity-0 group-hover:opacity-100 transition-opacity">
          {item.column !== 'in_progress' && (
            <button
              onClick={() => onMove(item.id, 'in_progress')}
              className="text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
            >
              Start
            </button>
          )}
          {item.column !== 'waiting' && (
            <button
              onClick={() => onMove(item.id, 'waiting')}
              className="text-[10px] font-medium text-neutral-500 hover:text-neutral-700"
            >
              Waiting
            </button>
          )}
          <button
            onClick={() => onMove(item.id, 'done')}
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
