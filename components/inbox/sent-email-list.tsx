'use client';

import { useMemo } from 'react';
import { PaperClipIcon } from '@heroicons/react/24/outline';

export interface SentEmail {
  id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string[] | null;
  subject: string | null;
  received_at: string | null;
  html_body: string | null;
  body: string | null;
  metadata?: { attachments?: Array<{ filename: string; mimeType: string; size: number | null }> } | null;
}

interface SentEmailListProps {
  emails: SentEmail[];
  selectedId: string | null;
  onSelect: (email: SentEmail) => void;
  loading?: boolean;
  compact?: boolean;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (itemDay.getTime() === today.getTime()) return 'Today';
  if (itemDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function SentEmailList({ emails, selectedId, onSelect, loading, compact = false }: SentEmailListProps) {
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: SentEmail[] }> = [];
    let currentLabel = '';
    for (const email of emails) {
      const label = email.received_at ? getDateLabel(email.received_at) : 'Earlier';
      if (label !== currentLabel) {
        result.push({ label, items: [email] });
        currentLabel = label;
      } else {
        result[result.length - 1].items.push(email);
      }
    }
    return result;
  }, [emails]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-4 h-4 border-2 border-neutral-300 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-4 text-center">
        <p className="text-[13px] text-neutral-500 font-medium mb-1">No sent emails</p>
        <p className="text-[12px] text-neutral-400">Sent emails will appear here after the next sync.</p>
      </div>
    );
  }

  return (
    <div className="pt-1">
      {groups.map(group => (
        <div key={group.label}>
          <div className="h-8 flex items-center px-3 bg-neutral-50 border-b border-neutral-100 sticky top-0 z-10">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
              {group.label}
            </span>
          </div>
          <div className="px-1 py-0.5 space-y-0.5">
            {group.items.map(email => {
              const toDisplay = email.to_addresses?.[0] ?? '';
              const subjectDisplay = email.subject ?? '';
              const timeDisplay = email.received_at ? formatTime(email.received_at) : '';
              const isSelected = selectedId === email.id;
              const snippetDisplay = email.body ? email.body.slice(0, 120) : '';
              const attachments = email.metadata?.attachments ?? [];

              if (compact) {
                return (
                  <div
                    key={email.id}
                    onClick={() => onSelect(email)}
                    className={`w-full text-left relative rounded-md transition-colors cursor-pointer group ${
                      isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
                    }`}
                  >
                    <div className="px-3 py-1.5">
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <span className={`text-[12px] truncate font-semibold ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
                          {toDisplay ? `To: ${toDisplay}` : 'No recipient'}
                        </span>
                        {timeDisplay && (
                          <span className="text-[10px] text-neutral-400 flex-shrink-0">{timeDisplay}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <p className={`text-[11px] truncate flex-1 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-500'}`}>
                          {subjectDisplay || '(no subject)'}
                        </p>
                        {attachments.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-neutral-400 flex-shrink-0">
                            <PaperClipIcon className="w-2.5 h-2.5" />
                            <span className="text-[10px]">{attachments.length}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={email.id}
                  onClick={() => onSelect(email)}
                  className={`w-full text-left relative rounded-md transition-colors cursor-pointer group ${
                    isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
                  }`}
                >
                  <div className="px-3 py-3">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className={`text-[13px] truncate font-semibold ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
                        {toDisplay ? `To: ${toDisplay}` : 'No recipient'}
                      </span>
                      {timeDisplay && (
                        <span className="text-[10px] text-neutral-400 flex-shrink-0">{timeDisplay}</span>
                      )}
                    </div>
                    <p className={`text-[12px] truncate mb-0.5 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>
                      {subjectDisplay || '(no subject)'}
                    </p>
                    {snippetDisplay && (
                      <p className="text-[11px] text-neutral-400 line-clamp-1 leading-relaxed">
                        {snippetDisplay}
                      </p>
                    )}
                    {attachments.length > 0 && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="inline-flex items-center gap-0.5 text-neutral-400">
                          <PaperClipIcon className="w-2.5 h-2.5" />
                          <span className="text-[10px]">{attachments.length}</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
