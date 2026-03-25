'use client';

import {
  EnvelopeIcon,
  MicrophoneIcon,
  RectangleStackIcon,
} from '@heroicons/react/24/outline';
import type { DeskItem } from '@/lib/types/desk';
import { SOURCE_LABELS } from '@/lib/types/desk';

interface PoolCardProps {
  item: DeskItem;
  onConfirm: (id: string) => void;
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

export default function PoolCard({ item, onConfirm, onDismiss, onSelect }: PoolCardProps) {
  const SourceIcon = SOURCE_ICONS[item.sourceType] ?? RectangleStackIcon;

  return (
    <div
      className="group bg-white border border-neutral-100 px-3 py-2 hover:border-neutral-200 hover:shadow-sm transition-all cursor-pointer"
      onClick={() => onSelect?.(item.id)}
    >
      {/* Title row */}
      <div className="flex items-start gap-1.5">
        <SourceIcon className="w-3 h-3 text-neutral-400 flex-shrink-0 mt-px" />
        <p className="text-[12px] font-medium text-neutral-900 leading-snug line-clamp-1 flex-1 min-w-0">
          {item.title}
        </p>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 mt-0.5 pl-4">
        <span className="text-[10px] text-neutral-400 uppercase tracking-wide font-medium">
          {SOURCE_LABELS[item.sourceType]}
        </span>
        {item.description && (
          <span className="text-[10px] text-neutral-400 truncate min-w-0">
            · {item.description}
          </span>
        )}
        {item.urgency && (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-auto ${URGENCY_DOT[item.urgency] ?? 'bg-neutral-300'}`} />
        )}
      </div>

      {/* CTAs — always visible, inline */}
      <div className="flex items-center gap-3 mt-1.5 pl-4">
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(item.id); }}
          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          Add to board →
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
          className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
