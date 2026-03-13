'use client';

import { useState, useEffect } from 'react';
import { CheckIcon, QuestionMarkCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface RsvpButtonsProps {
  itemId: string; // calendar_events.id (UUID)
  attendees?: Array<{ email?: string; name?: string; responseStatus?: string; status?: string; self?: boolean }>;
  userEmail?: string;
  onDismiss?: (response: RsvpValue) => void;
}

type RsvpValue = 'accepted' | 'tentative' | 'declined';
type ButtonState = 'idle' | 'loading' | 'error';

function getCurrentStatus(
  attendees: RsvpButtonsProps['attendees'],
  userEmail?: string
): RsvpValue | null {
  if (!attendees) return null;
  const self = attendees.find(
    (a) => a.self || (userEmail && a.email?.toLowerCase() === userEmail.toLowerCase())
  );
  if (!self) return null;
  // Check both fields: sync stores 'status', Google API uses 'responseStatus'
  // Normalize Outlook values: 'none' → null (no selection), 'tentativelyaccepted' → 'tentative'
  const raw = self.responseStatus ?? self.status;
  if (raw === 'accepted') return 'accepted';
  if (raw === 'tentative' || raw === 'tentativelyaccepted') return 'tentative';
  if (raw === 'declined') return 'declined';
  return null; // 'none', 'needsAction', undefined → no button pre-selected
}

export default function RsvpButtons({ itemId, attendees, userEmail, onDismiss }: RsvpButtonsProps) {
  const [currentStatus, setCurrentStatus] = useState<RsvpValue | null>(() =>
    getCurrentStatus(attendees, userEmail)
  );
  const [buttonState, setButtonState] = useState<ButtonState>('idle');

  const [scopeProvider, setScopeProvider] = useState<string | null>(null);

  // Sync status when attendees prop updates externally (e.g. after RSVP from another panel)
  useEffect(() => {
    if (buttonState !== 'loading') {
      setCurrentStatus(getCurrentStatus(attendees, userEmail));
    }
  }, [attendees, userEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRsvp = async (response: RsvpValue) => {
    if (buttonState === 'loading') return;
    const prev = currentStatus;
    setCurrentStatus(response); // optimistic
    setButtonState('loading');
    setScopeProvider(null);

    try {
      const res = await fetch(`/api/meetings/${itemId}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCurrentStatus(prev); // revert
        if (data?.error === 'calendar_scope_required') {
          setScopeProvider(data.provider ?? 'calendar');
        }
        setButtonState('error');
        return;
      }

      setButtonState('idle');
      onDismiss?.(response);
    } catch {
      setCurrentStatus(prev); // revert
      setButtonState('error');
    }
  };

  const buttons: Array<{ value: RsvpValue; label: string; Icon: React.ElementType }> = [
    { value: 'accepted', label: 'Accept', Icon: CheckIcon },
    { value: 'tentative', label: 'Maybe', Icon: QuestionMarkCircleIcon },
    { value: 'declined', label: 'Decline', Icon: XMarkIcon },
  ];

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {buttons.map(({ value, label, Icon }) => {
          const isActive = currentStatus === value;
          return (
            <button
              key={value}
              onClick={() => handleRsvp(value)}
              disabled={buttonState === 'loading'}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium border transition-colors disabled:opacity-60 ${
                isActive
                  ? value === 'accepted'
                    ? 'bg-green-600 text-white border-green-600'
                    : value === 'tentative'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-red-500 text-white border-red-500'
                  : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {scopeProvider && (
        <p className="text-[12px] text-orange-600">
          Calendar write access needed.{' '}
          <a href="/settings/connections" className="underline hover:text-orange-800">
            Reconnect {scopeProvider === 'gmail' ? 'Google' : 'Outlook'} to RSVP
          </a>
        </p>
      )}
      {buttonState === 'error' && !scopeProvider && (
        <p className="text-[12px] text-red-500">Failed to update RSVP. Please try again.</p>
      )}
    </div>
  );
}
