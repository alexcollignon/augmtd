'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ChevronDownIcon, ChevronUpIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import EmailSyncSettings from './email-sync-settings';
import { createClient } from '@/lib/supabase/client';

interface ConnectionCardProps {
  provider: 'gmail' | 'outlook';
  connection: any;
  connectUrl: string;
  disconnectUrl: string;
}

export default function ConnectionCard({ provider, connection, connectUrl, disconnectUrl }: ConnectionCardProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [syncStatus, setSyncStatus] = useState(connection?.sync_status || 'ready');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const supabase = createClient();

  // Poll for sync status updates
  useEffect(() => {
    if (!connection) return;

    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from('connections')
        .select('sync_status')
        .eq('id', connection.id)
        .single();

      if (data && data.sync_status !== syncStatus) {
        setSyncStatus(data.sync_status);
        if (syncing && data.sync_status !== 'syncing') setSyncing(false);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [connection, syncStatus, syncing, supabase]);

  const providerConfig = {
    gmail: {
      name: 'Gmail',
      logo: '/logos/gmail.png',
      accentColor: 'bg-red-500',
      bgGradient: 'from-red-50/30 to-orange-50/20',
      border: 'border-red-100',
      buttonBg: 'bg-neutral-900',
      buttonHover: 'hover:bg-neutral-800',
    },
    outlook: {
      name: 'Outlook',
      logo: '/logos/outlook.png',
      accentColor: 'bg-indigo-500',
      bgGradient: 'from-indigo-50/30 to-blue-50/20',
      border: 'border-indigo-100',
      buttonBg: 'bg-indigo-600',
      buttonHover: 'hover:bg-indigo-700',
    }
  };

  const config = providerConfig[provider];

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch('/api/connections/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sync failed');

      setSyncMessage({
        type: 'success',
        text: data.emailsFetched === 0
          ? 'No new emails'
          : `Synced ${data.emailsFetched} email${data.emailsFetched !== 1 ? 's' : ''}${data.inboxItemsCreated > 0 ? `, ${data.inboxItemsCreated} inbox item${data.inboxItemsCreated !== 1 ? 's' : ''} created` : ''}`,
      });
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (err) {
      setSyncMessage({ type: 'error', text: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  if (!connection || connection.status !== 'active') {
    return (
      <div className={`relative p-4 bg-gradient-to-br ${config.bgGradient} border ${config.border}`}>
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${config.accentColor}`} />
        <div className="flex items-center justify-between pl-3">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-9 h-9 bg-white border border-neutral-200 flex items-center justify-center shadow-sm">
              <Image src={config.logo} alt={config.name} width={20} height={20} />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-neutral-900">{config.name}</p>
              <p className="text-[12px] text-neutral-600">Not connected</p>
            </div>
          </div>
          <a
            href={connectUrl}
            className={`px-4 py-2 ${config.buttonBg} ${config.buttonHover} text-white text-[13px] font-semibold transition-all shadow-sm hover:shadow`}
          >
            Connect
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-neutral-200 overflow-hidden">
      {/* Main Card */}
      <div className={`relative p-4 bg-gradient-to-br ${config.bgGradient} border-b ${config.border}`}>
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${config.accentColor}`} />

        <div className="flex items-start justify-between pl-3">
          {/* Left: logo + name + email */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0 w-9 h-9 bg-white border border-neutral-200 flex items-center justify-center shadow-sm">
              <Image src={config.logo} alt={config.name} width={20} height={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-semibold text-neutral-900">{config.name}</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-semibold uppercase tracking-wide">
                  <span className="w-1 h-1 rounded-full bg-green-500" />
                  Active
                </span>
              </div>
              <p className="text-[12px] text-neutral-600 mt-0.5 truncate">{connection.metadata?.email}</p>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {/* Sync button */}
            <button
              onClick={handleSync}
              disabled={syncing || syncStatus === 'syncing'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${syncing || syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
              {syncing || syncStatus === 'syncing' ? 'Syncing…' : 'Sync'}
            </button>

            {/* Disconnect */}
            {confirmDisconnect ? (
              <div className="flex items-center gap-1">
                <form action={disconnectUrl} method="POST">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-[12.5px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    Confirm
                  </button>
                </form>
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  className="px-2 py-1.5 text-[12.5px] text-neutral-500 hover:text-neutral-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="px-3 py-1.5 text-[12.5px] font-medium border border-neutral-200 bg-white text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
              >
                Disconnect
              </button>
            )}

            {/* Settings toggle */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 hover:bg-white/60 transition-colors"
              title="Sync settings"
            >
              {showSettings ? (
                <ChevronUpIcon className="w-4 h-4 text-neutral-500" />
              ) : (
                <ChevronDownIcon className="w-4 h-4 text-neutral-500" />
              )}
            </button>
          </div>
        </div>

        {/* Status row */}
        <div className="mt-3 pl-3 flex items-center gap-4 text-[11px] text-neutral-600">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-neutral-700">Status:</span>
            <span className="capitalize flex items-center gap-1">
              {(syncStatus === 'syncing' || syncing) && (
                <svg className="animate-spin h-3 w-3 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {syncStatus || 'ready'}
            </span>
          </div>
          {connection.last_sync && (
            <>
              <span className="text-neutral-300">•</span>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-neutral-700">Last sync:</span>
                <span suppressHydrationWarning>
                  {new Date(connection.last_sync).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </>
          )}
          {syncMessage && (
            <>
              <span className="text-neutral-300">•</span>
              <span className={syncMessage.type === 'success' ? 'text-green-700' : 'text-red-600'}>
                {syncMessage.text}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Expandable: Sync Settings only */}
      {showSettings && (
        <div className="bg-white p-4">
          <h4 className="text-[13px] font-semibold text-neutral-900 mb-3">Sync Settings</h4>
          <EmailSyncSettings
            connectionId={connection.id}
            currentMaxEmails={connection.metadata?.max_emails_per_sync || 10}
          />
        </div>
      )}
    </div>
  );
}
