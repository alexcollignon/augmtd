'use client';

import { CheckCircleIcon, XMarkIcon, PencilIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';

interface ActivityLogRowProps {
  item: any;
  onClick: () => void;
  isSelected: boolean;
}

export default function ActivityLogRow({ item, onClick, isSelected }: ActivityLogRowProps) {
  const sourceData = item.source_data;
  const provider = sourceData?.provider || 'gmail';
  const wasCompleted = item.status === 'completed';
  const wasDismissed = item.status === 'dismissed';
  const wasArchived = wasDismissed && !!sourceData?.archived_at;
  const wasModified = sourceData?.modified === true;

  // Format timestamp for log-like display
  const formatLogTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    }

    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  // Get concise action description
  const getLogAction = () => {
    if (wasCompleted) {
      if (sourceData?.draft) {
        const recipient = sourceData.from_name || sourceData.from?.split('@')[0] || 'recipient';
        return `Sent reply to ${recipient}`;
      }
      return item.work_title || 'Action completed';
    } else if (wasArchived) {
      return `Archived: ${item.work_title || 'Item'}`;
    } else if (wasDismissed) {
      return `Dismissed: ${item.work_title || 'Item'}`;
    } else {
      return item.work_title || 'Item';
    }
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors border-l-2 ${
        isSelected
          ? 'border-l-primary-500 bg-primary-50/50'
          : 'border-l-transparent'
      }`}
    >
      <div className="flex items-center space-x-3 text-xs font-mono">
        {/* Timestamp */}
        <span className="text-gray-400 w-20 flex-shrink-0">
          {formatLogTimestamp(item.updated_at || item.created_at)}
        </span>

        {/* Status Icon */}
        <div className="flex-shrink-0">
          {wasCompleted ? (
            <CheckCircleIcon className="w-4 h-4 text-green-600" />
          ) : (
            <XMarkIcon className="w-4 h-4 text-gray-400" />
          )}
        </div>

        {/* Action */}
        <span className={`flex-1 min-w-0 truncate ${
          wasCompleted ? 'text-gray-900' : 'text-gray-600'
        }`}>
          {getLogAction()}
        </span>

        {/* Modified indicator */}
        {wasModified && (
          <PencilIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
        )}

        {/* Provider */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          <Image
            src={provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
            alt={provider}
            width={12}
            height={12}
            className="w-3 h-3 opacity-50"
          />
          <span className="text-gray-400 uppercase text-[10px]">{provider}</span>
        </div>
      </div>
    </button>
  );
}
