'use client';

import { useState, useEffect, useRef } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button, IconButton, Input } from '@/components/ui';

interface Member {
  user_id: string;
  full_name: string | null;
  email: string;
}

interface Props {
  isOpen: boolean;
  member: Member | null;
  onClose: () => void;
  onDeleted: (userId: string) => void;
}

export default function DeleteAccountModal({ isOpen, member, onClose, onDeleted }: Props) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setConfirmEmail('');
      setError('');
      setLoading(false);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen || !member) return null;

  const displayName = member.full_name || member.email;
  const confirmed = confirmEmail.trim().toLowerCase() === member.email.toLowerCase();

  async function handleDelete() {
    if (!confirmed || !member) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/company/members/${member.user_id}/delete`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
        return;
      }
      onDeleted(member.user_id);
      onClose();
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-xl w-full max-w-md pointer-events-auto">
          {/* Header */}
          <div className="flex items-start justify-between p-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-neutral-900">Delete account</h2>
                <p className="text-[12px] text-neutral-400 mt-0.5">{displayName}</p>
              </div>
            </div>
            <IconButton onClick={onClose}>
              <XMarkIcon className="w-5 h-5" />
            </IconButton>
          </div>

          {/* Body */}
          <div className="px-6 pb-6 space-y-4">
            <div className="p-3 bg-red-50 rounded-xl border border-red-100">
              <p className="text-[12px] text-red-700 leading-relaxed">
                This permanently deletes all their data — emails, meetings, files, and work.{' '}
                <span className="font-semibold">This cannot be undone.</span>
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                Type <span className="font-mono font-bold text-neutral-700">{member.email}</span> to confirm
              </label>
              <Input
                ref={inputRef}
                type="email"
                value={confirmEmail}
                onChange={e => setConfirmEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmed && handleDelete()}
                placeholder={member.email}
                className="focus:border-red-400"
              />
            </div>

            {error && (
              <p className="text-[12px] text-red-600">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" onClick={onClose} disabled={loading} className="flex-1">
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete} disabled={!confirmed || loading} className="flex-1">
                {loading ? 'Deleting…' : 'Delete account'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
