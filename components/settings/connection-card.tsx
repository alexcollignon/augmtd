'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import EmailSyncSettings from './email-sync-settings';
import ManualSyncButton from './manual-sync-button';
import { createClient } from '@/lib/supabase/client';

interface ConnectionCardProps {
  provider: 'gmail' | 'outlook';
  connection: any;
  connectUrl: string;
  disconnectUrl: string;
}

export default function ConnectionCard({ provider, connection, connectUrl, disconnectUrl }: ConnectionCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [syncStatus, setSyncStatus] = useState(connection?.sync_status || 'ready');
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
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [connection, syncStatus, supabase]);

  const providerConfig = {
    gmail: {
      name: 'Gmail',
      color: 'green',
      logo: '/logos/gmail.png',
      gradientFrom: 'from-green-50',
      gradientTo: 'to-emerald-50',
      border: 'border-green-200/50',
      buttonGradient: 'from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800',
      buttonShadow: 'shadow-primary-500/30'
    },
    outlook: {
      name: 'Outlook',
      color: 'blue',
      logo: '/logos/outlook.png',
      gradientFrom: 'from-blue-50',
      gradientTo: 'to-sky-50',
      border: 'border-blue-200/50',
      buttonGradient: 'from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800',
      buttonShadow: 'shadow-blue-500/30'
    }
  };

  const config = providerConfig[provider];

  if (!connection || connection.status !== 'active') {
    return (
      <div className={`p-5 bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo} border ${config.border} rounded-lg`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm border border-gray-200">
              <Image src={config.logo} alt={config.name} width={24} height={24} />
            </div>
            <div>
              <p className="font-semibold text-gray-900">{config.name}</p>
              <p className="text-sm text-gray-600">Not connected</p>
            </div>
          </div>
          <a
            href={connectUrl}
            className={`px-4 py-2 bg-gradient-to-r ${config.buttonGradient} text-white rounded-lg font-medium transition-all duration-200 shadow-lg ${config.buttonShadow} text-sm`}
          >
            Connect
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200/50 rounded-lg overflow-hidden">
      {/* Main Card */}
      <div className={`p-5 bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo} border-b ${config.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm border border-gray-200">
              <Image src={config.logo} alt={config.name} width={24} height={24} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <p className="font-semibold text-gray-900">{config.name}</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                  ● Active
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-0.5">{connection.metadata?.email}</p>
            </div>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
          >
            {showDetails ? (
              <ChevronUpIcon className="w-5 h-5 text-gray-600" />
            ) : (
              <ChevronDownIcon className="w-5 h-5 text-gray-600" />
            )}
          </button>
        </div>

        {/* Quick Info */}
        <div className="mt-3 flex items-center space-x-4 text-xs text-gray-600">
          <div className="flex items-center space-x-1">
            <span className="font-medium">Status:</span>
            <span className="capitalize flex items-center gap-1.5">
              {syncStatus === 'syncing' && (
                <svg className="animate-spin h-3 w-3 text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {syncStatus || 'ready'}
            </span>
          </div>
          {connection.last_sync && (
            <div className="flex items-center space-x-1">
              <span className="font-medium">Last sync:</span>
              <span suppressHydrationWarning>
                {new Date(connection.last_sync).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Expandable Details */}
      {showDetails && (
        <div className="bg-white p-5 space-y-4">
          {/* Manual Sync */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Manual Sync</h4>
            <p className="text-xs text-gray-600 mb-3">
              Fetch and process new emails immediately
            </p>
            <ManualSyncButton provider={provider} connectionId={connection.id} />
          </div>

          {/* Sync Settings */}
          <div className="pt-4 border-t border-gray-100">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Sync Settings</h4>
            <EmailSyncSettings
              connectionId={connection.id}
              currentMaxEmails={connection.metadata?.max_emails_per_sync || 10}
            />
          </div>

          {/* Disconnect */}
          <div className="pt-4 border-t border-gray-100">
            <form action={disconnectUrl} method="POST">
              <button
                type="submit"
                className="w-full px-4 py-2.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-medium transition-all duration-200 text-sm"
              >
                Disconnect {config.name}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
