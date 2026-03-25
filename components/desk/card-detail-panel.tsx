'use client';

import Link from 'next/link';
import {
  XMarkIcon,
  ArrowTopRightOnSquareIcon,
  EnvelopeIcon,
  MicrophoneIcon,
  RectangleStackIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';
import { SOURCE_LABELS } from '@/lib/types/desk';

interface CardDetailPanelProps {
  item: DeskItem;
  onClose: () => void;
  onMove: (id: string, column: DeskColumn) => void;
  onDismiss: (id: string) => void;
}

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: EnvelopeIcon,
  meeting_action: MicrophoneIcon,
  process_step: RectangleStackIcon,
  manual: RectangleStackIcon,
};

const URGENCY_LABEL: Record<string, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

const URGENCY_COLOR: Record<string, string> = {
  high: 'text-red-600 bg-red-50',
  medium: 'text-amber-600 bg-amber-50',
  low: 'text-neutral-500 bg-neutral-100',
};

const SOURCE_LINK_LABEL: Record<string, string> = {
  email: 'Open in Inbox →',
  meeting_action: 'View meeting →',
  process_step: 'View process →',
};

const URGENCY_DOT: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-neutral-300',
};

export default function CardDetailPanel({ item, onClose, onMove, onDismiss }: CardDetailPanelProps) {
  const SourceIcon = SOURCE_ICONS[item.sourceType] ?? RectangleStackIcon;
  const synthesizing = !item.synthesis && !item.synthesisAt && item.sourceType === 'email';
  const bodyText = item.synthesis || item.description || item.aiContext;

  return (
    <div className="w-80 flex-shrink-0 border-l border-neutral-200 bg-white flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-neutral-100 flex-shrink-0 gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <SourceIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0 mt-0.5" />
          <h3 className="text-[13px] font-semibold text-neutral-900 leading-snug">{item.title}</h3>
        </div>
        <button onClick={onClose} className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors flex-shrink-0">
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Meta */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {SOURCE_LABELS[item.sourceType]}
          </span>
          {item.sourceType === 'email' && item.emailCount > 1 && (
            <span className="text-[10px] text-neutral-400">· {item.emailCount} emails</span>
          )}
          {item.urgency && (
            <>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${URGENCY_DOT[item.urgency]}`} />
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${URGENCY_COLOR[item.urgency]}`}>
                {URGENCY_LABEL[item.urgency]}
              </span>
            </>
          )}
        </div>

        {/* Body text */}
        {synthesizing && (
          <div className="space-y-1.5">
            <div className="h-2.5 bg-neutral-100 animate-pulse rounded w-full" />
            <div className="h-2.5 bg-neutral-100 animate-pulse rounded w-4/5" />
            <div className="h-2.5 bg-neutral-100 animate-pulse rounded w-3/5" />
          </div>
        )}
        {bodyText && (
          <div>
            <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1">
              {item.synthesis ? 'Brief' : 'Description'}
            </p>
            <p className="text-[13px] text-neutral-700 leading-relaxed">{bodyText}</p>
          </div>
        )}

        {/* Source link */}
        {item.sourceUrl && (
          <Link
            href={item.sourceUrl}
            className="inline-flex items-center gap-1.5 text-[12px] text-indigo-600 hover:text-indigo-800"
          >
            <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 flex-shrink-0" />
            {SOURCE_LINK_LABEL[item.sourceType] ?? 'Open source'}
          </Link>
        )}
      </div>

      {/* Footer actions — always visible */}
      {item.column !== 'done' && (
        <div className="flex-shrink-0 border-t border-neutral-100 px-4 py-3 flex items-center gap-3 flex-wrap">
          {item.column !== 'in_progress' && (
            <button
              onClick={() => onMove(item.id, 'in_progress')}
              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
            >
              Start
            </button>
          )}
          {item.column !== 'waiting' && (
            <button
              onClick={() => onMove(item.id, 'waiting')}
              className="text-[11px] font-medium text-neutral-500 hover:text-neutral-700"
            >
              Waiting
            </button>
          )}
          <button
            onClick={() => { onMove(item.id, 'done'); onClose(); }}
            className="text-[11px] font-medium text-green-600 hover:text-green-700 flex items-center gap-0.5"
          >
            <CheckIcon className="w-3.5 h-3.5" />
            Done
          </button>
          <button
            onClick={() => { onDismiss(item.id); onClose(); }}
            className="text-[11px] font-medium text-red-500 hover:text-red-700 ml-auto"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
