'use client';

import { useState } from 'react';
import Image from 'next/image';

interface AttendeeConnectionCardProps {
  isEnabled: boolean;
  apiKeyConfigured: boolean;
}

export default function AttendeeConnectionCard({
  isEnabled: initialEnabled,
  apiKeyConfigured,
}: AttendeeConnectionCardProps) {
  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [isLoading, setIsLoading] = useState(false);

  const config = {
    name: 'AUGMTD Meeting Assistant',
    logo: '/logos/attendee.svg',
    accentColor: 'bg-violet-500',
    bgGradient: 'from-violet-50/30 to-purple-50/20',
    border: 'border-violet-100',
  };

  const handleToggle = async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/integrations/attendee/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !isEnabled }),
      });

      if (!response.ok) {
        throw new Error('Failed to toggle Attendee integration');
      }

      const data = await response.json();
      setIsEnabled(data.enabled);

      // Refresh page to show updated state
      window.location.reload();
    } catch (error) {
      console.error('Failed to toggle Attendee:', error);
      alert('Failed to update Attendee integration. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!apiKeyConfigured) {
    return (
      <div className={`relative p-4 bg-gradient-to-br ${config.bgGradient} border ${config.border}`}>
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${config.accentColor}`} />

        <div className="flex items-center gap-3 pl-3">
          <div className="flex-shrink-0 w-9 h-9 bg-white border border-neutral-200 flex items-center justify-center shadow-sm">
            <Image src={config.logo} alt={config.name} width={20} height={20} />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-neutral-900">{config.name}</p>
            <p className="text-[12px] text-red-600">API key not configured</p>
          </div>
        </div>

        <div className="mt-3 pl-3 text-[12px] text-neutral-600">
          <p>Set <code className="bg-neutral-100 px-1 py-0.5 font-mono text-[11px]">ATTENDEE_API_KEY</code> in environment variables.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative p-4 bg-gradient-to-br ${config.bgGradient} border ${config.border}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${config.accentColor}`} />

      <div className="flex items-center justify-between pl-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex-shrink-0 w-9 h-9 bg-white border border-neutral-200 flex items-center justify-center shadow-sm">
            <Image src={config.logo} alt={config.name} width={20} height={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold text-neutral-900">{config.name}</p>
              {isEnabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-semibold uppercase tracking-wide">
                  <span className="w-1 h-1 rounded-full bg-green-500" />
                  Active
                </span>
              )}
            </div>
            <p className="text-[12px] text-neutral-600 mt-0.5">
              {isEnabled ? 'Meeting bot auto-join enabled' : 'Meeting transcription disabled'}
            </p>
          </div>
        </div>

        {/* Toggle Switch */}
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isEnabled ? 'bg-violet-600' : 'bg-neutral-300'
          } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Info when enabled */}
      {isEnabled && (
        <div className="mt-3 pl-3 text-[11px] text-neutral-600 leading-relaxed">
          <p>
            Your AI meeting assistant will automatically join meetings with Zoom, Google Meet, or Teams links.
            Transcripts are analyzed with AI to extract action items and create work items.
          </p>
        </div>
      )}
    </div>
  );
}
