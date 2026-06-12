'use client';

import type { ConnectionFolders } from '@/components/inbox/folder-rail';

export type EmailSearchResult = {
  id: string;
  message_id: string;
  provider_message_id: string;
  from_address: string;
  from_name: string;
  subject: string;
  snippet: string;
  received_at: string;
  labels: string[];
  is_from_user: boolean;
  connection_id: string;
};

const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: 'Inbox',
  SENT: 'Sent',
  TRASH: 'Trash',
  SPAM: 'Spam',
  DRAFT: 'Drafts',
  DRAFTS: 'Drafts',
};

const SKIP_LABELS = new Set([
  'UNREAD', 'IMPORTANT', 'STARRED',
  'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES',
  'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS',
]);

function deriveFolder(labels: string[], isFromUser: boolean, connectionId: string, folderSections: ConnectionFolders[]): string {
  if (isFromUser) return 'Sent';
  for (const label of labels) {
    const sys = SYSTEM_LABEL_NAMES[label];
    if (sys) return sys;
  }
  const conn = folderSections.find(c => c.connectionId === connectionId);
  if (conn) {
    for (const label of labels) {
      if (SKIP_LABELS.has(label)) continue;
      const folder = conn.folders.find(f => f.id === label);
      if (folder) return folder.name;
    }
  }
  return 'Email';
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const FOLDER_BADGE_STYLES: Record<string, string> = {
  Sent: 'bg-blue-50 text-blue-600',
  Inbox: 'bg-green-50 text-green-600',
  Trash: 'bg-red-50 text-red-500',
  Spam: 'bg-orange-50 text-orange-500',
  Drafts: 'bg-yellow-50 text-yellow-600',
};

interface Props {
  results: EmailSearchResult[];
  folderSections: ConnectionFolders[];
  selectedId: string | null;
  onSelect: (result: EmailSearchResult) => void;
  loading: boolean;
  query: string;
}

export default function EmailSearchResults({ results, folderSections, selectedId, onSelect, loading, query }: Props) {
  if (loading) {
    return (
      <div className="pt-2 px-2 space-y-1.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="rounded-xl bg-neutral-100 animate-pulse h-[68px]" />
        ))}
      </div>
    );
  }

  if (results.length === 0 && query) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-4 text-center">
        <p className="text-[13px] text-neutral-500 font-medium mb-1">No results for "{query}"</p>
        <p className="text-[12px] text-neutral-400">Try searching by name, subject, or keyword</p>
      </div>
    );
  }

  return (
    <div className="pt-1 px-1 space-y-0.5">
      {results.map(result => {
        const isSelected = selectedId === result.message_id;
        const time = formatTime(result.received_at);
        const folder = deriveFolder(result.labels, result.is_from_user, result.connection_id, folderSections);
        const badgeStyle = FOLDER_BADGE_STYLES[folder] ?? 'bg-neutral-100 text-neutral-500';

        return (
          <div
            key={result.id}
            onClick={() => onSelect(result)}
            className={`rounded-md px-3 py-3 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'}`}
          >
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className={`text-[13px] font-semibold truncate ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
                {result.from_name || result.from_address}
              </span>
              <span className="text-[10px] text-neutral-400 flex-shrink-0">{time}</span>
            </div>
            <p className={`text-[12px] truncate mb-1 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-700'}`}>
              {result.subject}
            </p>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`inline-block flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeStyle}`}>
                {folder}
              </span>
              {result.snippet && (
                <p className="text-[11px] text-neutral-400 truncate">{result.snippet}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
