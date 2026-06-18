'use client';

import { useState, useRef, useEffect } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import { Button, Input, Select } from '@/components/ui';

interface Connection {
  id: string;
  provider: string;
  metadata?: { email?: string };
}

interface DataManagementSectionProps {
  connections: Connection[];
  userEmail: string;
}

export default function DataManagementSection({ connections, userEmail }: DataManagementSectionProps) {
  const [selectedScope, setSelectedScope] = useState<string>('all');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const confirmInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (deleteAccountOpen) {
      setTimeout(() => confirmInputRef.current?.focus(), 50);
    } else {
      setConfirmEmail('');
      setDeleteError('');
    }
  }, [deleteAccountOpen]);

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

  const emailConfirmed = confirmEmail.trim().toLowerCase() === userEmail.toLowerCase();

  const handleDeleteAccount = async () => {
    if (!emailConfirmed) return;
    setDeletingAccount(true);
    setDeleteError('');
    try {
      const res = await fetch('/api/user/delete', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error ?? 'Something went wrong');
        return;
      }
      window.location.href = '/login';
    } catch {
      setDeleteError('Network error — please try again');
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <>
      <h3 className="text-[14px] font-semibold text-neutral-900 mb-1">Data Management</h3>
      <p className="text-[12px] text-neutral-400 mb-4">
        Permanently delete synced emails, calendar events, transcripts, and attachments.
      </p>

      {result === 'success' && (
        <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-[13px] text-green-700">
          Data deleted successfully.
        </div>
      )}
      {result === 'error' && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-600">
          Something went wrong. Please try again.
        </div>
      )}

      <div className="flex items-center gap-3">
        <Select
          value={selectedScope}
          onChange={e => { setSelectedScope(e.target.value); setConfirming(false); setResult(null); }}
          className="flex-1 max-w-xs"
          disabled={deleting}
        >
          <option value="all">All accounts</option>
          {connections.map(conn => (
            <option key={conn.id} value={conn.id}>
              {conn.metadata?.email || conn.provider} ({conn.provider})
            </option>
          ))}
        </Select>

        {!confirming && (
          <button
            onClick={() => { setConfirming(true); setResult(null); }}
            disabled={deleting}
            className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 font-medium text-[13px] rounded-lg transition-colors disabled:opacity-40"
          >
            <TrashIcon className="w-4 h-4" />
            Delete data
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-[13px] text-red-800 font-medium mb-1">
            Delete all synced data for {selectedLabel}?
          </p>
          <p className="text-[12px] text-red-600 mb-3">
            This will permanently remove all emails, calendar events, meeting transcripts, and attachment files
            {selectedScope === 'all' ? ', and knowledge base files' : ''}. This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="danger" onClick={handleConfirm} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Delete account */}
      <div className="mt-8 pt-6 border-t border-neutral-100">
        <h3 className="text-[14px] font-semibold text-neutral-900 mb-1">Delete Account</h3>
        <p className="text-[12px] text-neutral-400 mb-4">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>

        {!deleteAccountOpen ? (
          <button
            onClick={() => setDeleteAccountOpen(true)}
            className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 font-medium text-[13px] rounded-lg transition-colors"
          >
            <TrashIcon className="w-4 h-4" />
            Delete my account
          </button>
        ) : (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
            <p className="text-[13px] text-red-800 font-medium">
              This will permanently delete your account and all your data.{' '}
              <span className="font-semibold">This cannot be undone.</span>
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-red-700 uppercase tracking-wide mb-1.5">
                Type <span className="font-mono font-bold">{userEmail}</span> to confirm
              </label>
              <Input
                ref={confirmInputRef}
                type="email"
                value={confirmEmail}
                onChange={e => { setConfirmEmail(e.target.value); setDeleteError(''); }}
                onKeyDown={e => e.key === 'Enter' && emailConfirmed && handleDeleteAccount()}
                placeholder={userEmail}
                className="border-red-200 focus:border-red-400 placeholder:text-red-200"
              />
            </div>
            {deleteError && (
              <p className="text-[12px] text-red-600">{deleteError}</p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDeleteAccountOpen(false)} disabled={deletingAccount}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDeleteAccount} disabled={!emailConfirmed || deletingAccount}>
                {deletingAccount ? 'Deleting…' : 'Delete my account'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
