'use client';

import { useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

export default function ManualSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const response = await fetch('/api/connections/sync', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      setMessage({
        type: 'success',
        text: data.emailsFetched === 0
          ? 'No new emails to sync'
          : `Synced ${data.emailsFetched} new emails${data.inboxItemsCreated > 0 ? `, created ${data.inboxItemsCreated} inbox items` : ''}`
      });

      // Clear message after 5 seconds
      setTimeout(() => {
        setMessage(null);
      }, 5000);

    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Sync failed'
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium transition-colors flex items-center justify-center space-x-2"
      >
        <ArrowPathIcon className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
        <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
      </button>

      {message && (
        <div className={`mt-3 text-sm p-3 rounded ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700'
            : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
