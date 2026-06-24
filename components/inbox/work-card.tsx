'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  PaperClipIcon,
} from '@heroicons/react/24/outline';
import type { InboxItem } from '@/lib/types/inbox';
import { classifyItem, TYPE_CONFIG, TYPE_ORDER, type ItemType } from '@/lib/inbox/classify-item';
import WorkDetailPanel from './work-detail-panel';

interface WorkCardProps {
  item: InboxItem;
}

export default function WorkCard({ item }: WorkCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [override, setOverride] = useState<ItemType | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const type = override ?? classifyItem(item as any);
  const cfg = type !== 'hidden' ? TYPE_CONFIG[type] : null;

  const handleRetype = async (t: ItemType) => {
    setOverride(t);
    setMenuOpen(false);
    try {
      await fetch(`/api/inbox/${item.id}/retype`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: t }),
      });
    } catch { /* optimistic — chip already updated */ }
  };

  // Check if this is a batched item
  const isBatch = (item as any).__isBatch === true;
  const batchCount = (item as any).__batchCount;
  const batchItems = (item as any).__batchItems || [];

  const sourceData = item.source_data;
  const recipientContext = item.recipient_context;

  const getEmailUrl = () => {
    if (sourceData?.provider === 'gmail') {
      return `https://mail.google.com/mail/u/0/#all/${sourceData.gmail_id || sourceData.message_id}`;
    } else if (sourceData?.provider === 'outlook') {
      return `https://outlook.office.com/mail/inbox/id/${sourceData.outlook_id || sourceData.message_id}`;
    }
    return null;
  };

  const getSectionStyle = () => {
    switch (item.visual_section) {
      case 'prepared':
        return {
          borderColor: 'border-indigo-100',
          hoverBorder: 'hover:border-indigo-200',
          accentColor: 'bg-indigo-500',
        };
      case 'suggested':
        return {
          borderColor: 'border-amber-100',
          hoverBorder: 'hover:border-amber-200',
          accentColor: 'bg-amber-400',
        };
      case 'awareness':
      default:
        return {
          borderColor: 'border-neutral-200',
          hoverBorder: 'hover:border-neutral-300',
          accentColor: 'bg-neutral-400',
        };
    }
  };

  const style = getSectionStyle();

  // suppress TS warning — getEmailUrl is available if needed downstream
  void getEmailUrl;

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

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* The verb for this type — surfaced on hover */}
              {cfg && (
                <span className="opacity-0 group-hover:opacity-100 text-[11px] font-medium text-indigo-600 transition-opacity">
                  {cfg.verb}
                </span>
              )}
              {/* Provider icon */}
              {sourceData?.provider && (
                <div className="w-3.5 h-3.5 bg-neutral-100 flex items-center justify-center">
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
          </div>


          {/* Footer metadata */}
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            {/* Type chip — click to re-type (corrects the AI + teaches it) */}
            {cfg && (
              <div className="relative flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${cfg.countBg} ${cfg.countText} font-semibold hover:opacity-80 transition-opacity`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
                    <div className="absolute z-20 mt-1 left-0 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                      <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-neutral-400">Change type</div>
                      {TYPE_ORDER.map(t => (
                        <button
                          key={t}
                          onClick={(e) => { e.stopPropagation(); handleRetype(t); }}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-neutral-50 transition-colors ${t === type ? 'font-semibold text-neutral-900' : 'text-neutral-600'}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${TYPE_CONFIG[t].dot}`} />
                          {TYPE_CONFIG[t].label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <span className="text-neutral-300">•</span>
            <span className="font-medium text-neutral-600 truncate">
              {sourceData?.from_name || sourceData?.from || 'Unknown'}
            </span>

            {recipientContext?.suggestionLabel && (
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
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-neutral-100 text-neutral-700 font-semibold">
                  {batchCount} reminders
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
