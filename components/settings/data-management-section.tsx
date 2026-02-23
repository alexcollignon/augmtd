'use client';

import { useState } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';

interface Connection {
  id: string;
  provider: string;
  metadata?: { email?: string };
}

interface DataManagementSectionProps {
  connections: Connection[];
}

export default function DataManagementSection({ connections }: DataManagementSectionProps) {
  const [selectedScope, setSelectedScope] = useState<string>('all');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const selectedLabel =
    selectedScope === 'all'
      ? 'all accounts'
      : connections.find(c => c.id === selectedScope)?.metadata?.email || 'selected account';

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/settings/delete-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: selectedScope }),
      });

      if (res.ok) {
        setResult('success');
        setConfirming(false);
      } else {
        setResult('error');
      }
    } catch {
      setResult('error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white border border-neutral-200 p-6 mb-6 shadow-sm">
      <h3 className="text-[15px] font-semibold text-neutral-900 mb-1">Data Management</h3>
      <p className="text-[13px] text-neutral-500 mb-4">
        Permanently delete synced data — emails, calendar events, meeting transcripts, and attachments.
      </p>

      {result === 'success' && (
        <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 text-[13px] text-green-700">
          Data deleted successfully.
        </div>
      )}
      {result === 'error' && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-[13px] text-red-600">
          Something went wrong. Please try again.
        </div>
      )}

      <div className="flex items-center gap-3">
        <select
          value={selectedScope}
          onChange={e => { setSelectedScope(e.target.value); setConfirming(false); setResult(null); }}
          className="flex-1 max-w-xs px-3 py-2 border border-neutral-200 text-[13px] text-neutral-900 bg-white focus:outline-none focus:border-neutral-400"
          disabled={deleting}
        >
          <option value="all">All accounts</option>
          {connections.map(conn => (
            <option key={conn.id} value={conn.id}>
              {conn.metadata?.email || conn.provider} ({conn.provider})
            </option>
          ))}
        </select>

        {!confirming && (
          <button
            onClick={() => { setConfirming(true); setResult(null); }}
            disabled={deleting}
            className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 font-semibold text-[13px] transition-colors disabled:opacity-40"
          >
            <TrashIcon className="w-4 h-4" />
            Delete data
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200">
          <p className="text-[13px] text-red-800 font-medium mb-1">
            Delete all synced data for {selectedLabel}?
          </p>
          <p className="text-[12px] text-red-600 mb-3">
            This will permanently remove all emails, calendar events, meeting transcripts, and
            attachment files. This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={deleting}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px] transition-colors disabled:opacity-60"
            >
              {deleting ? 'Deleting...' : 'Confirm delete'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="px-4 py-2 border border-neutral-200 text-neutral-600 hover:bg-neutral-50 font-semibold text-[13px] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
