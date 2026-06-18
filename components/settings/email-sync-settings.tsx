'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';

interface EmailSyncSettingsProps {
  connectionId: string;
  currentMaxEmails?: number;
}

export default function EmailSyncSettings({
  connectionId,
  currentMaxEmails,
}: EmailSyncSettingsProps) {
  const [maxEmails, setMaxEmails] = useState(() => {
    const n = Number(currentMaxEmails);
    return Number.isFinite(n) && n > 0 ? n : 50;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setMessage(null);

      const response = await fetch('/api/settings/email-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          maxEmails,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save settings');
      }

      setMessage({ type: 'success', text: 'Settings saved successfully' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="maxEmails" className="block text-[13px] font-medium text-neutral-700 mb-2">
          Emails per sync
        </label>
        <div className="flex items-center space-x-4">
          <Input
            type="number"
            id="maxEmails"
            min="1"
            max="100"
            value={maxEmails}
            onChange={(e) => setMaxEmails(parseInt(e.target.value) || 50)}
            className="w-32"
          />
          <Button
            onClick={handleSave}
            disabled={isSaving || maxEmails === currentMaxEmails}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
        <p className="text-[12px] text-neutral-400 mt-2">
          How many recent unread emails to fetch during each sync (1-100)
        </p>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
