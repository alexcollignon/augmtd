'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

const PROVIDER_CONFIG = {
  gmail: {
    name: 'Gmail',
    logoPath: '/logos/gmail.png',
  },
  outlook: {
    name: 'Outlook',
    logoPath: '/logos/outlook.png',
  },
};

function ProviderLogo({ provider, name }: { provider: string; name: string }) {
  const config = PROVIDER_CONFIG[provider as keyof typeof PROVIDER_CONFIG];

  if (!config) {
    return (
      <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-[12px] font-semibold text-neutral-500 flex-shrink-0">
        {name[0].toUpperCase()}
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-white border border-neutral-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
      <Image src={config.logoPath} alt={name} width={22} height={22} className="object-contain" />
    </div>
  );
}

function formatLastSync(dateStr: string | null): string {
  if (!dateStr) return 'Never synced';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  if (Math.floor(hours / 24) === 1) return 'Synced yesterday';
  return `Synced ${new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

interface ConnectionCardProps {
  provider: 'gmail' | 'outlook';
  connection: any;
  connectUrl: string;
  disconnectUrl: string;
}

export default function ConnectionCard({ provider, connection, connectUrl, disconnectUrl }: ConnectionCardProps) {
  const config = PROVIDER_CONFIG[provider];
  const [syncStatus, setSyncStatus] = useState(connection?.sync_status || 'ready');
  const [connectionStatus, setConnectionStatus] = useState(connection?.status || 'active');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!connection) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('connections')
        .select('sync_status, status')
        .eq('id', connection.id)
        .single();
      if (data) {
        setSyncStatus(data.sync_status);
        setConnectionStatus(data.status);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [connection, supabase]);

  // Not connected
  if (!connection || connection.status !== 'active') {
    return (
      <div className="flex items-center gap-3 py-3">
        <ProviderLogo provider={provider} name={config.name} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-neutral-500">{config.name}</p>
          <p className="text-[11px] text-neutral-400">Not connected</p>
        </div>
        <a
          href={connectUrl}
          className="px-3 py-1.5 text-[12px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          Connect
        </a>
      </div>
    );
  }

  const needsReconnect = connectionStatus === 'needs_reconnect';
  const email = connection.metadata?.email;

  return (
    <div className="flex items-center gap-3 py-3">
      <ProviderLogo provider={provider} name={config.name} />

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-neutral-900 truncate">{email || config.name}</p>
        <p className="text-[11px] text-neutral-400 mt-0.5" suppressHydrationWarning>
          {syncStatus === 'syncing'
            ? <span className="text-indigo-500">Syncing…</span>
            : formatLastSync(connection.last_sync)
          }
        </p>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {needsReconnect ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Reconnect needed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Active
          </span>
        )}

        {needsReconnect ? (
          <a
            href={connectUrl}
            className="px-2.5 py-1 text-[12px] font-medium border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
          >
            Reconnect
          </a>
        ) : confirmDisconnect ? (
          <div className="flex items-center gap-1.5">
            <form action={disconnectUrl} method="POST">
              <input type="hidden" name="connectionId" value={connection.id} />
              <button
                type="submit"
                className="px-2.5 py-1 text-[12px] font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Confirm
              </button>
            </form>
            <button
              onClick={() => setConfirmDisconnect(false)}
              className="px-2 py-1 text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDisconnect(true)}
            className="px-2.5 py-1 text-[12px] font-medium text-neutral-400 hover:text-red-500 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
