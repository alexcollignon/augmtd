'use client';

import { useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

interface SyncAllButtonProps {
  providers: string[];
}

export default function SyncAllButton({ providers }: SyncAllButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSync = async () => {
    if (!providers.length) return;
    setSyncing(true);
    setMessage(null);
    try {
      await Promise.all(
        providers.map(provider =>
          fetch('/api/connections/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider }),
          })
        )
      );
      setMessage('Synced');
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage('Failed');
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      onClick={handleSync}
      disabled={syncing || !providers.length}
      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg hover:bg-neutral-50 disabled:opacity-40 transition-colors"
    >
      <ArrowPathIcon className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
      {message ?? (syncing ? 'Syncing…' : 'Sync now')}
    </button>
  );
}
