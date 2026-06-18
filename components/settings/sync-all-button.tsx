'use client';

import { useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';

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
    <Button
      variant="secondary"
      size="sm"
      onClick={handleSync}
      disabled={syncing || !providers.length}
    >
      <ArrowPathIcon className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
      {message ?? (syncing ? 'Syncing…' : 'Sync now')}
    </Button>
  );
}
