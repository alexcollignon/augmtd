'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface InboxActionsProps {
  itemId: string;
  status: string;
}

export default function InboxActions({ itemId, status }: InboxActionsProps) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setTimeout(() => {
        router.push('/inbox');
        router.refresh();
      }, 1500);
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
      setTimeout(() => {
        router.push('/inbox');
        router.refresh();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject item');
      setIsRejecting(false);
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
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex space-x-3">
          <button
            onClick={handleApprove}
            disabled={isApproving || isRejecting}
            className={`px-6 py-3 bg-primary-600 text-white rounded-lg font-medium transition-colors ${
              isApproving || isRejecting
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-primary-700'
            }`}
          >
            {isApproving ? '⏳ Approving...' : '✓ Approve & Execute'}
          </button>
          <button
            disabled={isApproving || isRejecting}
            className={`px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium transition-colors ${
              isApproving || isRejecting
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-gray-50'
            }`}
          >
            ✎ Edit Draft
          </button>
        </div>
        <button
          onClick={handleReject}
          disabled={isApproving || isRejecting}
          className={`px-6 py-3 border border-red-300 text-red-700 rounded-lg font-medium transition-colors ${
            isApproving || isRejecting
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-red-50'
          }`}
        >
          {isRejecting ? '⏳ Dismissing...' : '✕ Dismiss'}
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-3">
        Approving will send the draft reply and mark action items as complete
      </p>
    </div>
  );
}
