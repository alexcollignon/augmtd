import { CheckCircleIcon, XMarkIcon, PencilIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';

interface ActivityItemProps {
  item: any;
}

export default function ActivityItem({ item }: ActivityItemProps) {
  const sourceData = item.source_data;
  const provider = sourceData?.provider || 'gmail';
  const wasApproved = item.status === 'approved';
  const wasModified = sourceData?.modified === true;

  // Format the action description
  const getActionDescription = () => {
    if (wasApproved) {
      if (sourceData?.draft) {
        return `Reply sent to ${sourceData.from_name || 'recipient'}`;
      }
      return item.work_title || 'Action completed';
    } else {
      return `Dismissed: ${item.work_title || 'Item'}`;
    }
  };

  // Get how it was resolved
  const getResolutionMethod = () => {
    if (!wasApproved) return 'Dismissed';
    if (wasModified) return 'Edited before sending';
    return 'Sent as-is';
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  return (
    <div className="px-5 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start space-x-4">
        {/* Icon */}
        <div className="flex-shrink-0 pt-0.5">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
            wasApproved
              ? 'bg-green-50'
              : 'bg-gray-100'
          }`}>
            {wasApproved ? (
              <CheckCircleIcon className="w-5 h-5 text-green-600" />
            ) : (
              <XMarkIcon className="w-5 h-5 text-gray-500" />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Action description */}
          <p className="text-sm font-medium text-gray-900 mb-1">
            {getActionDescription()}
          </p>

          {/* Metadata row */}
          <div className="flex items-center space-x-3 text-xs text-gray-500">
            {/* Timestamp */}
            <span>{formatTimestamp(item.reviewed_at || item.created_at)}</span>

            <span>•</span>

            {/* How */}
            <span className="flex items-center space-x-1">
              {wasModified && <PencilIcon className="w-3 h-3" />}
              <span>{getResolutionMethod()}</span>
            </span>

            <span>•</span>

            {/* Provider */}
            <div className="flex items-center space-x-1">
              <Image
                src={provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
                alt={provider}
                width={10}
                height={10}
                className="w-2.5 h-2.5 opacity-60"
              />
              <span className="uppercase">{provider}</span>
            </div>
          </div>

          {/* Optional: AI note */}
          {sourceData?.draft && wasApproved && (
            <p className="text-xs text-gray-400 mt-2">
              AI prepared draft • {sourceData.draft.tone || 'professional'} tone
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
