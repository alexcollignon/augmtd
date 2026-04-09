'use client';

import { useState } from 'react';
import Image from 'next/image';

interface MeetingAssistantCardProps {
  isEnabled: boolean;
  selfHostedConfigured?: boolean;
}

export default function MeetingAssistantCard({
  isEnabled: initialEnabled,
  selfHostedConfigured = false,
}: MeetingAssistantCardProps) {
  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/integrations/meeting-bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !isEnabled }),
      });
      if (!response.ok) throw new Error('Failed to toggle');
      const data = await response.json();
      setIsEnabled(data.enabled);
      window.location.reload();
    } catch {
      alert('Failed to update Meeting Assistant. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!selfHostedConfigured) {
    return (
      <div className="flex items-center gap-3 py-3">
        <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
          <Image src="/logos/attendee.svg" alt="Meeting Assistant" width={18} height={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-neutral-900">Meeting Assistant</p>
          <p className="text-[11px] text-neutral-400">
            Set <code className="bg-neutral-100 px-1 py-0.5 font-mono text-[10px] rounded">MEETING_BOT_SERVICE_URL</code> to enable
          </p>
        </div>
        <span className="text-[11px] text-neutral-400">Not configured</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
        <Image src="/logos/attendee.svg" alt="Meeting Assistant" width={18} height={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-neutral-900">Meeting Assistant</p>
        <p className="text-[11px] text-neutral-400">
          {isEnabled ? 'Auto-joins your Google Meet calls and captures transcripts' : 'Disabled — enable to auto-join meetings'}
        </p>
      </div>
      <button
        onClick={handleToggle}
        disabled={isLoading}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
          isEnabled ? 'bg-violet-600' : 'bg-neutral-200'
        } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
            isEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </div>
  );
}
