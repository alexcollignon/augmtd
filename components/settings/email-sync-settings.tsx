'use client';

import { useState } from 'react';

interface EmailSyncSettingsProps {
  connectionId: string;
  currentMaxEmails: number;
}

export default function EmailSyncSettings({
  connectionId,
  currentMaxEmails,
}: EmailSyncSettingsProps) {
  const [maxEmails, setMaxEmails] = useState(currentMaxEmails);
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
        <label htmlFor="maxEmails" className="block text-sm font-medium text-gray-700 mb-2">
          Emails per sync
        </label>
        <div className="flex items-center space-x-4">
          <input
            type="number"
            id="maxEmails"
            min="1"
            max="100"
            value={maxEmails}
            onChange={(e) => setMaxEmails(parseInt(e.target.value))}
            className="block w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
          />
          <button
            onClick={handleSave}
            disabled={isSaving || maxEmails === currentMaxEmails}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isSaving || maxEmails === currentMaxEmails
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-primary-600 text-white hover:bg-primary-700'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
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
