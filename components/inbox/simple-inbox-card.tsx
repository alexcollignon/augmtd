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
      className="w-full text-left p-5 hover:bg-gradient-to-r hover:from-primary-50/50 hover:to-purple-50/50 transition-all duration-200 flex items-center space-x-4 group border-l-4 border-transparent hover:border-primary-500"
    >
      {/* Icon */}
      <div className="flex-shrink-0">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all duration-200">
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2 mb-1">
          {showPriorityDot && (
            <span className={`w-2 h-2 rounded-full ${priorityColor} flex-shrink-0 animate-pulse`} />
          )}
          <p className="text-sm font-semibold text-gray-900 truncate">
            {actionText} {sourceData?.from_name || 'Unknown'}
          </p>
        </div>
        <p className="text-sm text-gray-600 truncate leading-relaxed">
          {sourceData?.subject || 'No subject'}
        </p>
      </div>

      {/* Metadata - Icons with Labels */}
      <div className="flex-shrink-0 flex items-center space-x-4">
        {sourceData?.draftReply && (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-primary-50 text-primary-700 group-hover:bg-primary-100 transition-colors">
            <EnvelopeIcon className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Draft</span>
          </div>
        )}
        {sourceData?.actionItems && sourceData.actionItems.length > 0 && (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 group-hover:bg-gray-200 transition-colors">
            <ClipboardDocumentListIcon className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">{sourceData.actionItems.length}</span>
          </div>
        )}
        {sourceData?.calendarEvent && (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 group-hover:bg-blue-100 transition-colors">
            <CalendarIcon className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Event</span>
          </div>
        )}
      </div>
    </button>
  );
}
