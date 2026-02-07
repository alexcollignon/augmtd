'use client';

import Image from 'next/image';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';

interface SimpleInboxCardProps {
  item: any;
  onClick: () => void;
}

export default function SimpleInboxCard({ item, onClick }: SimpleInboxCardProps) {
  const sourceData = item.source_data;
  const provider = sourceData?.provider || 'gmail';

  // Get work-state icon and color
  const getWorkStateDisplay = (workState: string) => {
    switch (workState) {
      case 'work_prepared':
        return {
          icon: CheckCircleIcon,
          color: 'from-green-500 to-green-600',
          textColor: 'text-green-700'
        };
      case 'decision_required':
        return {
          icon: ExclamationCircleIcon,
          color: 'from-orange-500 to-orange-600',
          textColor: 'text-orange-700'
        };
      case 'waiting':
        return {
          icon: ClockIcon,
          color: 'from-gray-400 to-gray-500',
          textColor: 'text-gray-600'
        };
      default: // no_work
        return {
          icon: CheckCircleIcon,
          color: 'from-gray-300 to-gray-400',
          textColor: 'text-gray-500'
        };
    }
  };

  const { icon: Icon, color, textColor } = getWorkStateDisplay(item.work_state || 'work_prepared');

  // Get priority indicator
  const showPriorityDot = item.priority >= 75 || sourceData?.urgency === 'high' || sourceData?.urgency === 'critical';
  const priorityColor = sourceData?.urgency === 'critical' ? 'bg-red-500' : 'bg-orange-500';

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-5 hover:bg-gradient-to-r hover:from-primary-50/50 hover:to-purple-50/50 transition-all duration-200 flex items-start space-x-4 group border-l-4 border-transparent hover:border-primary-500"
    >
      {/* Icon */}
      <div className="flex-shrink-0 pt-0.5">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all duration-200`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Work Title - PRIMARY */}
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            {showPriorityDot && (
              <span className={`w-2 h-2 rounded-full ${priorityColor} flex-shrink-0 animate-pulse mt-1.5`} />
            )}
            <h3 className="text-base font-semibold text-gray-900 truncate">
              {item.work_title || sourceData?.subject || 'Review email'}
            </h3>
          </div>
        </div>

        {/* What I Prepared */}
        <p className="text-sm text-primary-700 font-medium mb-1 truncate">
          {item.what_i_prepared || 'Summary and analysis'}
        </p>

        {/* Why Matters - context */}
        <p className="text-sm text-gray-600 line-clamp-1 leading-relaxed mb-2">
          {item.why_matters || sourceData?.summary || 'Needs your attention'}
        </p>

        {/* Metadata Row */}
        <div className="flex items-center space-x-3 text-xs text-gray-500">
          {/* Provider Badge */}
          <div className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full ${
            provider === 'outlook'
              ? 'bg-blue-50 text-blue-700'
              : 'bg-green-50 text-green-700'
          }`}>
            <Image
              src={provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
              alt={provider}
              width={12}
              height={12}
              className="w-3 h-3"
            />
            <span className="font-medium capitalize">{provider}</span>
          </div>

          {/* From */}
          <span className="truncate">
            from {sourceData?.from_name || 'Unknown'}
          </span>

          {/* Urgency if high */}
          {(sourceData?.urgency === 'high' || sourceData?.urgency === 'critical') && (
            <span className={`px-2 py-0.5 rounded-full font-medium ${
              sourceData.urgency === 'critical'
                ? 'bg-red-100 text-red-700'
                : 'bg-orange-100 text-orange-700'
            }`}>
              {sourceData.urgency === 'critical' ? 'Critical' : 'High Priority'}
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <div className="flex-shrink-0 pt-1">
        <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-primary-600 transition-colors" />
      </div>
    </button>
  );
}
