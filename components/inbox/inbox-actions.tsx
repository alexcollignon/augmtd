'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircleIcon, PencilIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface InboxActionsProps {
  itemId: string;
  status: string;
  draft?: {
    subject: string;
    body: string;
    tone?: string;
  };
  onClose?: () => void;
}

export default function InboxActions({ itemId, status, draft, onClose }: InboxActionsProps) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Editing state
  const [editedSubject, setEditedSubject] = useState(draft?.subject || '');
  const [editedBody, setEditedBody] = useState(draft?.body || '');

  const handleApprove = async () => {
    try {
      setIsApproving(true);
      setError(null);

      const response = await fetch(`/api/inbox/${itemId}/approve`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve item');
      }

      setSuccess(data.message);

      // Close drawer and refresh after brief success message display
      setTimeout(() => {
        if (onClose) onClose();
        router.refresh();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve item');
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!confirm('Are you sure you want to dismiss this item?')) {
      return;
    }

    try {
      setIsRejecting(true);
      setError(null);

      const response = await fetch(`/api/inbox/${itemId}/reject`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject item');
      }

      setSuccess('Item dismissed');

      // Close drawer and refresh after brief success message display
      setTimeout(() => {
        if (onClose) onClose();
        router.refresh();
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject item');
      setIsRejecting(false);
    }
  };

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
    // Reset to original draft if canceling
    if (isEditing) {
      setEditedSubject(draft?.subject || '');
      setEditedBody(draft?.body || '');
    }
  };

  const handleSendModified = async () => {
    try {
      setIsSending(true);
      setError(null);

      const response = await fetch(`/api/inbox/${itemId}/modify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: editedSubject,
          emailBody: editedBody,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send modified email');
      }

      setSuccess(data.message);

      // Close drawer and refresh after brief success message display
      setTimeout(() => {
        if (onClose) onClose();
        router.refresh();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send modified email');
      setIsSending(false);
    }
  };

  if (status !== 'pending') {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 text-center">
        <p className="text-gray-600">
          This item has been {status === 'approved' ? 'approved and executed' : status}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="w-5 h-5 text-green-600" />
            <p className="text-sm font-medium text-green-700">{success}</p>
          </div>
          <p className="text-xs text-green-600 mt-1">Closing...</p>
        </div>
      )}

      {/* Hide actions when showing success */}
      {!success && (
        <>
          {/* Edit Mode */}
          {isEditing && draft ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="subject" className="block text-xs font-medium text-gray-500 mb-2">
              Subject
            </label>
            <input
              id="subject"
              type="text"
              value={editedSubject}
              onChange={(e) => setEditedSubject(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all"
              placeholder="Email subject..."
            />
          </div>
          <div>
            <label htmlFor="body" className="block text-xs font-medium text-gray-500 mb-2">
              Email Body
            </label>
            <textarea
              id="body"
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={12}
              className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-sans text-sm leading-relaxed transition-all resize-none"
              placeholder="Email body..."
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleEditToggle}
              disabled={isSending}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSendModified}
              disabled={isSending || !editedSubject || !editedBody}
              className="flex items-center space-x-2 px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircleIcon className="w-5 h-5" />
              <span>{isSending ? 'Sending...' : 'Send Modified Email'}</span>
            </button>
          </div>
        </div>
      ) : (
        /* Normal Mode */
        <>
          <div className="flex items-center justify-between">
            <div className="flex space-x-3">
              <button
                onClick={handleApprove}
                disabled={isApproving || isRejecting}
                className={`flex items-center space-x-2 px-6 py-3 bg-primary-600 text-white rounded-lg font-medium transition-colors ${
                  isApproving || isRejecting
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-primary-700'
                }`}
              >
                <CheckCircleIcon className="w-5 h-5" />
                <span>{isApproving ? 'Approving...' : 'Approve & Execute'}</span>
              </button>
              {draft && (
                <button
                  onClick={handleEditToggle}
                  disabled={isApproving || isRejecting}
                  className={`flex items-center space-x-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium transition-colors ${
                    isApproving || isRejecting
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <PencilIcon className="w-5 h-5" />
                  <span>Make a change</span>
                </button>
              )}
            </div>
            <button
              onClick={handleReject}
              disabled={isApproving || isRejecting}
              className={`flex items-center space-x-2 px-6 py-3 border border-red-300 text-red-700 rounded-lg font-medium transition-colors ${
                isApproving || isRejecting
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-red-50'
              }`}
            >
              <XMarkIcon className="w-5 h-5" />
              <span>{isRejecting ? 'Dismissing...' : 'Dismiss'}</span>
            </button>
          </div>
          {draft && (
            <p className="text-xs text-gray-500 mt-3">
              Approving will send the draft reply and mark action items as complete
            </p>
          )}
          {!draft && (
            <p className="text-xs text-gray-500 mt-3">
              Approving will mark this item as complete (no email to send)
            </p>
          )}
        </>
          )}
        </>
      )}
    </div>
  );
}
