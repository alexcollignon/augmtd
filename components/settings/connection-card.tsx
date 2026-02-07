'use client';

import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import EmailSyncSettings from './email-sync-settings';
import ManualSyncButton from './manual-sync-button';

interface ConnectionCardProps {
  provider: 'gmail' | 'outlook';
  connection: any;
  connectUrl: string;
  disconnectUrl: string;
}

export default function ConnectionCard({ provider, connection, connectUrl, disconnectUrl }: ConnectionCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const providerConfig = {
    gmail: {
      name: 'Gmail',
      color: 'green',
      icon: (
        <svg viewBox="0 0 48 48" className="w-6 h-6">
          <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"/>
          <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"/>
          <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/>
          <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z"/>
          <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0 C43.076,8,45,9.924,45,12.298z"/>
        </svg>
      ),
      gradientFrom: 'from-green-50',
      gradientTo: 'to-emerald-50',
      border: 'border-green-200/50',
      buttonGradient: 'from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800',
      buttonShadow: 'shadow-primary-500/30'
    },
    outlook: {
      name: 'Outlook',
      color: 'blue',
      icon: (
        <svg viewBox="0 0 48 48" className="w-6 h-6">
          <rect x="4" y="8" width="40" height="32" rx="2" fill="#0078D4"/>
          <path d="M24 28 C18 28 14 24 14 20 C14 16 18 12 24 12 C30 12 34 16 34 20 C34 24 30 28 24 28 Z" fill="white"/>
          <path d="M24 26 C20 26 17 23.5 17 20 C17 16.5 20 14 24 14 C28 14 31 16.5 31 20 C31 23.5 28 26 24 26 Z" fill="#0078D4"/>
        </svg>
      ),
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
      <div className={`p-5 bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo} border ${config.border} rounded-xl`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm border border-gray-200">
              {config.icon}
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
    <div className="border border-gray-200/50 rounded-xl overflow-hidden">
      {/* Main Card */}
      <div className={`p-5 bg-gradient-to-br ${config.gradientFrom} ${config.gradientTo} border-b ${config.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm border border-gray-200">
              {config.icon}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <p className="font-semibold text-gray-900">{config.name}</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                  ● Active
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-0.5">{connection.account_email}</p>
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
            <span className="capitalize">{connection.sync_status || 'ready'}</span>
          </div>
          {connection.last_sync && (
            <div className="flex items-center space-x-1">
              <span className="font-medium">Last sync:</span>
              <span>{new Date(connection.last_sync).toLocaleDateString()}</span>
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
            <ManualSyncButton />
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
