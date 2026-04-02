'use client';

import { useState } from 'react';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface KnowledgeSource {
  id: string;
  provider: 'google_drive' | 'onedrive';
  folder_name: string;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  file_count: number;
  last_synced_at: string | null;
}

interface SourceCardProps {
  source: KnowledgeSource;
  onSync: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function SourceCard({ source, onSync, onRemove }: SourceCardProps) {
  const [syncing, setSyncing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync(source.id);
    } finally {
      setSyncing(false);
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    setRemoving(true);
    await onRemove(source.id);
  };

  const providerName = source.provider === 'google_drive' ? 'Google Drive' : 'OneDrive';
  const providerInitials = source.provider === 'google_drive' ? 'GD' : 'OD';
  const providerColor = source.provider === 'google_drive'
    ? 'bg-blue-50 text-blue-600 border-blue-100'
    : 'bg-indigo-50 text-indigo-600 border-indigo-100';

  const statusDot = {
    pending: <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />,
    indexing: (
      <svg className="animate-spin w-3 h-3 text-indigo-500 inline-block" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
    ready: <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />,
    error: <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />,
  }[source.status];

  const statusLabel = {
    pending: 'Pending',
    indexing: 'Indexing…',
    ready: 'Ready',
    error: 'Error',
  }[source.status];

  return (
    <div className="flex items-center gap-4 p-4 bg-white border border-neutral-200 rounded-lg hover:border-neutral-300 transition-colors">
      {/* Provider badge */}
      <div className={`flex-shrink-0 w-9 h-9 border rounded-lg flex items-center justify-center text-[10px] font-bold tracking-wide ${providerColor}`}>
        {providerInitials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13.5px] font-semibold text-neutral-900 truncate">{source.folder_name}</span>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-neutral-500">
          <span className="flex items-center gap-1">
            {statusDot}
            {statusLabel}
          </span>
          {(source.status !== 'indexing' && source.status !== 'pending') || source.file_count > 0 ? (
            <>
              <span className="text-neutral-300">•</span>
              <span>{source.file_count} file{source.file_count !== 1 ? 's' : ''}</span>
            </>
          ) : null}
          {source.last_synced_at && (
            <>
              <span className="text-neutral-300">•</span>
              <span suppressHydrationWarning>Last synced {timeAgo(source.last_synced_at)}</span>
            </>
          )}
        </div>
        {(source.status === 'indexing' || source.status === 'pending') && (
          <p className="text-[11px] text-neutral-400 mt-0.5">Large folders may take a minute…</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={handleSync}
          disabled={syncing || source.status === 'indexing'}
          title="Sync now"
          className="p-1.5 rounded-md text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowPathIcon className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
        </button>

        {confirmRemove ? (
          <button
            onClick={handleRemove}
            disabled={removing}
            className="px-2 py-1 text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
          >
            {removing ? '…' : 'Remove'}
          </button>
        ) : (
          <button
            onClick={handleRemove}
            title="Remove source"
            className="p-1.5 rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
