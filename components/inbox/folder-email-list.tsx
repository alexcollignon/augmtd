'use client';

import type { FolderEmailSummary } from '@/lib/google/gmail';

interface Props {
  folderName: string;
  emails: FolderEmailSummary[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (email: FolderEmailSummary) => void;
  density: 'normal' | 'compact';
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function FolderEmailList({ folderName, emails, loading, selectedId, onSelect, density }: Props) {
  if (loading) {
    return (
      <div className="pt-2 px-2 space-y-1.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="rounded-xl bg-neutral-100 animate-pulse" style={{ height: density === 'compact' ? 44 : 68 }} />
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-4 text-center">
        <p className="text-[13px] text-neutral-500 font-medium mb-1">Nothing in {folderName}</p>
        <p className="text-[12px] text-neutral-400">This folder is empty.</p>
      </div>
    );
  }

  return (
    <div className="pt-1 px-1 space-y-0.5">
      {emails.map(email => {
        const isSelected = selectedId === email.id;
        const time = formatTime(email.date);
        if (density === 'compact') {
          return (
            <div
              key={email.id}
              onClick={() => onSelect(email)}
              className={`rounded-md px-3 py-1.5 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'}`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className={`text-[12px] font-semibold truncate ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
                  {email.fromName || email.from}
                </span>
                <span className="text-[10px] text-neutral-400 flex-shrink-0">{time}</span>
              </div>
              <p className={`text-[11px] truncate ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-500'}`}>
                {email.subject}
              </p>
            </div>
          );
        }
        return (
          <div
            key={email.id}
            onClick={() => onSelect(email)}
            className={`rounded-md px-3 py-3 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'}`}
          >
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className={`text-[13px] font-semibold truncate ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
                {email.fromName || email.from}
              </span>
              <span className="text-[10px] text-neutral-400 flex-shrink-0">{time}</span>
            </div>
            <p className={`text-[12px] truncate mb-0.5 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>
              {email.subject}
            </p>
            {email.snippet && (
              <p className="text-[11px] text-neutral-400 line-clamp-1 leading-relaxed">{email.snippet}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
