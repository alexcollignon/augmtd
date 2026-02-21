'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  CheckCircleIcon,
  ArrowTopRightOnSquareIcon,
  SparklesIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import { needsConfirmation } from '@/lib/types/inbox';
import WorkDetailPanel from './work-detail-panel';

interface WorkCardProps {
  item: InboxItem;
}

export default function WorkCard({ item }: WorkCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // Check if this is a batched item
  const isBatch = (item as any).__isBatch === true;
  const batchCount = (item as any).__batchCount;
  const batchItems = (item as any).__batchItems || [];

  const sourceData = item.source_data;
  const recipientContext = item.recipient_context;
  const needsUserConfirmation = needsConfirmation(item);

  const handleConfirmation = async (action: 'confirm_as_mine' | 'not_my_task') => {
    setIsConfirming(true);

    try {
      const response = await fetch(`/api/inbox/${item.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (response.ok) {
        window.location.reload();
      } else {
        console.error('Failed to confirm');
        alert('Failed to confirm. Please try again.');
      }
    } catch (error) {
      console.error('Confirmation error:', error);
      alert('Failed to confirm. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const getEmailUrl = () => {
    if (sourceData?.provider === 'gmail') {
      return `https://mail.google.com/mail/u/0/#all/${sourceData.gmail_id || sourceData.message_id}`;
    } else if (sourceData?.provider === 'outlook') {
      return `https://outlook.office.com/mail/inbox/id/${sourceData.outlook_id || sourceData.message_id}`;
    }
    return null;
  };

  // Get section-specific styling
  const getSectionStyle = () => {
    if (needsUserConfirmation) {
      return {
        borderColor: 'border-amber-200',
        hoverBorder: 'hover:border-amber-300',
        accentColor: 'bg-amber-500',
      };
    }

    switch (item.visual_section) {
      case 'prepared':
        return {
          borderColor: 'border-indigo-100',
          hoverBorder: 'hover:border-indigo-200',
          accentColor: 'bg-indigo-500',
        };
      case 'awareness':
        return {
          borderColor: 'border-neutral-200',
          hoverBorder: 'hover:border-neutral-300',
          accentColor: 'bg-neutral-400',
        };
      default:
        return {
          borderColor: 'border-neutral-200',
          hoverBorder: 'hover:border-neutral-300',
          accentColor: 'bg-neutral-400',
        };
    }
  };

  const style = getSectionStyle();

  return (
    <>
      <article
        onClick={() => setShowDetail(true)}
        className={`
          group relative bg-white
          border ${style.borderColor} ${style.hoverBorder}
          hover:shadow-md cursor-pointer
          transition-all duration-150
          overflow-hidden
        `}
      >
        {/* Accent bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${style.accentColor} transition-all duration-150 group-hover:w-1`} />

        {/* Main content */}
        <div className="relative pl-4 pr-4 py-3">
          {/* Title and metadata row */}
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <h3 className="flex-1 text-[14px] font-semibold text-neutral-900 leading-tight line-clamp-1 group-hover:text-indigo-700 transition-colors">
              {item.work_title || sourceData?.subject || 'Review email'}
            </h3>

            {/* Provider icon */}
            {sourceData?.provider && (
              <div className="flex-shrink-0 w-3.5 h-3.5 rounded-sm bg-neutral-100 flex items-center justify-center">
                <Image
                  src={sourceData.provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
                  alt={sourceData.provider}
                  width={10}
                  height={10}
                  className="opacity-60"
                />
              </div>
            )}
          </div>

          {/* What was prepared - single line */}
          {item.what_i_prepared && (
            <p className="text-[13px] text-neutral-700 line-clamp-1 leading-tight mb-1">
              {item.what_i_prepared}
            </p>
          )}

          {/* Footer metadata */}
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            <span className="font-medium text-neutral-600 truncate">
              {sourceData?.from_name || sourceData?.from || 'Unknown'}
            </span>

            {recipientContext?.suggestionLabel && !needsUserConfirmation && (
              <>
                <span className="text-neutral-300">•</span>
                <span className="italic truncate">
                  {recipientContext.suggestionLabel}
                </span>
              </>
            )}

            {/* Batch indicator */}
            {isBatch && (
              <>
                <span className="text-neutral-300">•</span>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-semibold">
                  {batchCount} reminders
                </span>
              </>
            )}

            {/* AI indicator - subtle */}
            {sourceData?.draft && (
              <>
                <span className="text-neutral-300">•</span>
                <span className="inline-flex items-center gap-0.5 text-violet-600">
                  <SparklesIcon className="w-2.5 h-2.5" />
                  <span className="text-[10px]">Draft ready</span>
                </span>
              </>
            )}

            {/* Attachment indicator */}
            {sourceData?.attachments?.length > 0 && (
              <>
                <span className="text-neutral-300">•</span>
                <span className="inline-flex items-center gap-0.5 text-neutral-500">
                  <PaperClipIcon className="w-2.5 h-2.5" />
                  <span className="text-[10px]">{sourceData.attachments.length}</span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Confirmation footer for suggested items */}
        {needsUserConfirmation && (
          <div className="relative border-t border-amber-200 bg-amber-50/50 px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-amber-800 font-medium">
                Confirm if yours
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirmation('confirm_as_mine');
                  }}
                  disabled={isConfirming}
                  className="
                    inline-flex items-center gap-1
                    px-2.5 py-1 rounded-md text-[11px] font-semibold
                    bg-amber-600 text-white
                    hover:bg-amber-700
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors
                  "
                >
                  <CheckCircleIcon className="w-3 h-3" />
                  Yes
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirmation('not_my_task');
                  }}
                  disabled={isConfirming}
                  className="
                    px-2.5 py-1 rounded-md text-[11px] font-medium
                    text-amber-700 hover:bg-amber-100
                    disabled:opacity-50
                    transition-colors
                  "
                >
                  No
                </button>
              </div>
            </div>
          </div>
        )}
      </article>

      {/* Detail Panel */}
      <WorkDetailPanel
        item={item}
        isOpen={showDetail}
        onClose={() => setShowDetail(false)}
        batchItems={isBatch ? batchItems : undefined}
      />
    </>
  );
}
