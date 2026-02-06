'use client';

import {
  EnvelopeIcon,
  ChatBubbleLeftIcon,
  ClipboardDocumentCheckIcon,
  InformationCircleIcon,
  NewspaperIcon,
  MegaphoneIcon,
  UserGroupIcon,
  DocumentIcon,
  ClipboardDocumentListIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';

interface SimpleInboxCardProps {
  item: any;
  onClick: () => void;
}

export default function SimpleInboxCard({ item, onClick }: SimpleInboxCardProps) {
  const sourceData = item.source_data;

  // Get icon based on category
  const getIcon = (category: string) => {
    switch (category) {
      case 'action_required':
        return ClipboardDocumentCheckIcon;
      case 'question':
        return ChatBubbleLeftIcon;
      case 'decision':
        return ClipboardDocumentCheckIcon;
      case 'information':
        return InformationCircleIcon;
      case 'newsletter':
        return NewspaperIcon;
      case 'promotional':
        return MegaphoneIcon;
      case 'social':
        return UserGroupIcon;
      default:
        return DocumentIcon;
    }
  };

  // Get action text based on category
  const getActionText = (category: string) => {
    switch (category) {
      case 'action_required':
        return 'Complete';
      case 'question':
        return 'Answer';
      case 'decision':
        return 'Decide on';
      case 'information':
        return 'Review';
      case 'newsletter':
        return 'Read';
      case 'promotional':
        return 'Review';
      case 'social':
        return 'Check';
      default:
        return 'Review';
    }
  };

  const Icon = getIcon(item.ai_suggestion_type);
  const actionText = getActionText(item.ai_suggestion_type);

  // Get priority indicator
  const showPriorityDot = item.priority >= 75 || sourceData?.urgency === 'high' || sourceData?.urgency === 'critical';
  const priorityColor = sourceData?.urgency === 'critical' ? 'bg-red-500' : 'bg-orange-500';

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-center space-x-3 group"
    >
      {/* Icon */}
      <div className="flex-shrink-0">
        <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center group-hover:bg-primary-100 transition-colors">
          <Icon className="w-5 h-5 text-primary-600" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2 mb-0.5">
          {showPriorityDot && (
            <span className={`w-2 h-2 rounded-full ${priorityColor} flex-shrink-0`} />
          )}
          <p className="text-sm font-medium text-gray-900 truncate">
            {actionText} {sourceData?.from_name || 'Unknown'}
          </p>
        </div>
        <p className="text-sm text-gray-600 truncate">
          {sourceData?.subject || 'No subject'}
        </p>
      </div>

      {/* Metadata - Icons */}
      <div className="flex-shrink-0 flex items-center space-x-2">
        {sourceData?.draftReply && (
          <div className="flex items-center space-x-1 text-primary-600" title="Draft reply ready">
            <EnvelopeIcon className="w-4 h-4" />
          </div>
        )}
        {sourceData?.actionItems && sourceData.actionItems.length > 0 && (
          <div className="flex items-center space-x-1 text-gray-600" title={`${sourceData.actionItems.length} action items`}>
            <ClipboardDocumentListIcon className="w-4 h-4" />
            <span className="text-xs">{sourceData.actionItems.length}</span>
          </div>
        )}
        {sourceData?.calendarEvent && (
          <div className="flex items-center space-x-1 text-gray-600" title="Calendar event suggested">
            <CalendarIcon className="w-4 h-4" />
          </div>
        )}
      </div>
    </button>
  );
}
