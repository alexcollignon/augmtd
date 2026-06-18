'use client';

import { useState, useEffect } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui';

interface ManualSyncButtonProps {
  provider: 'gmail' | 'outlook';
  connectionId: string;
}

export default function ManualSyncButton({ provider, connectionId }: ManualSyncButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const supabase = createClient();

  // Poll connection status to detect when sync completes
  useEffect(() => {
    if (!syncing) return;

    const pollInterval = setInterval(async () => {
      const { data: connection } = await supabase
        .from('connections')
        .select('sync_status')
        .eq('id', connectionId)
        .single();

      if (connection && connection.sync_status !== 'syncing') {
        setSyncing(false);
        clearInterval(pollInterval);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [syncing, connectionId, supabase]);

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const response = await fetch('/api/connections/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
      setMessage({
        type: 'success',
        text: data.emailsFetched === 0
          ? `${providerName}: No new emails to sync`
          : `${providerName}: Synced ${data.emailsFetched} new emails${data.inboxItemsCreated > 0 ? `, created ${data.inboxItemsCreated} inbox items` : ''}`
      });

      // Clear message after 5 seconds
      setTimeout(() => {
        setMessage(null);
      }, 5000);

    } catch (error) {
      // Extract user-friendly error message from response
      let errorText = 'Sync failed. Please try again.';

      if (error instanceof Error) {
        try {
          // Try to parse error message as JSON response
          const match = error.message.match(/\{.*\}/);
          if (match) {
            const errorData = JSON.parse(match[0]);
            errorText = errorData.message || errorData.error || error.message;
          } else {
            errorText = error.message;
          }
        } catch {
          errorText = error.message;
        }
      }

      setMessage({
        type: 'error',
        text: errorText
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <Button
        onClick={handleSync}
        disabled={syncing}
        className="w-full"
      >
        <ArrowPathIcon className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
        <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
      </Button>

      {message && (
        <div className={`mt-3 text-[12px] p-3 border rounded-lg ${
          message.type === 'success'
            ? 'bg-green-50 text-green-800 border-green-200'
            : 'bg-red-50 text-red-800 border-red-200'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
