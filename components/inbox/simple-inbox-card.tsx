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
  const provider = sourceData?.provider || 'gmail'; // Default to gmail for backward compatibility

  // Provider icon components
  const GmailIcon = () => (
    <svg viewBox="0 0 48 48" className="w-3.5 h-3.5">
      <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"/>
      <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"/>
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/>
      <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z"/>
      <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0 C43.076,8,45,9.924,45,12.298z"/>
    </svg>
  );

  const OutlookIcon = () => (
    <svg viewBox="0 0 48 48" className="w-3.5 h-3.5">
      <path fill="#0078D4" d="M24,4L4,12v24l20,8l20-8V12L24,4z M24,28l-12-6l12-6l12,6L24,28z"/>
      <path fill="#50E6FF" d="M24,16l12,6v12l-12,6V28l-12-6v-6L24,16z"/>
      <path fill="#0078D4" opacity="0.5" d="M12,22v12l12,6V28L12,22z"/>
    </svg>
  );

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
        {/* Provider Badge */}
        <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full ${
          provider === 'outlook'
            ? 'bg-blue-50 text-blue-700 group-hover:bg-blue-100'
            : 'bg-green-50 text-green-700 group-hover:bg-green-100'
        } transition-colors`}>
          {provider === 'outlook' ? <OutlookIcon /> : <GmailIcon />}
          <span className="text-xs font-medium capitalize">{provider}</span>
        </div>

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
