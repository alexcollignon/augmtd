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
          color: 'text-green-600',
          bgColor: 'bg-green-50'
        };
      case 'decision_required':
        return {
          icon: ExclamationCircleIcon,
          color: 'text-orange-600',
          bgColor: 'bg-orange-50'
        };
      case 'waiting':
        return {
          icon: ClockIcon,
          color: 'text-gray-500',
          bgColor: 'bg-gray-50'
        };
      default: // no_work
        return {
          icon: CheckCircleIcon,
          color: 'text-gray-400',
          bgColor: 'bg-gray-50'
        };
    }
  };

  const { icon: Icon, color, bgColor } = getWorkStateDisplay(item.work_state || 'work_prepared');

  // Get priority indicator
  const showPriorityDot = item.priority >= 75 || sourceData?.urgency === 'high' || sourceData?.urgency === 'critical';
  const priorityColor = sourceData?.urgency === 'critical' ? 'bg-red-500' : 'bg-orange-500';

  return (
    <button
      onClick={onClick}
      className="relative w-full text-left px-5 py-4 transition-colors flex items-start space-x-4 group border-l-2 border-transparent hover:border-gray-900 hover:bg-gray-50 isolate"
    >
      {/* Icon */}
      <div className="flex-shrink-0 pt-0.5">
        <div className={`w-9 h-9 rounded-lg ${bgColor} flex items-center justify-center`}>
          <Icon className={`w-4.5 h-4.5 ${color}`} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Work Title - PRIMARY */}
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            {showPriorityDot && (
              <span className={`w-1.5 h-1.5 rounded-full ${priorityColor} flex-shrink-0 animate-pulse mt-1.5`} />
            )}
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              {item.work_title || sourceData?.subject || 'Review email'}
            </h3>
          </div>
        </div>

        {/* What I Prepared */}
        <p className="text-xs text-gray-600 font-medium mb-1.5 truncate">
          {item.what_i_prepared || 'Summary and analysis'}
        </p>

        {/* Why Matters - context */}
        <p className="text-xs text-gray-500 line-clamp-1 leading-relaxed mb-2">
          {item.why_matters || sourceData?.summary || 'Needs your attention'}
        </p>

        {/* Metadata Row */}
        <div className="flex items-center space-x-2 text-xs text-gray-400">
          {/* Provider Badge */}
          <div className="flex items-center space-x-1">
            <Image
              src={provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
              alt={provider}
              width={12}
              height={12}
              className="w-3 h-3 opacity-60"
            />
            <span className="text-[10px] uppercase">{provider}</span>
          </div>

          <span>•</span>

          {/* From */}
          <span className="truncate text-[11px]">
            {sourceData?.from_name || 'Unknown'}
          </span>

          {/* Urgency if high */}
          {(sourceData?.urgency === 'high' || sourceData?.urgency === 'critical') && (
            <>
              <span>•</span>
              <span className={`text-[10px] uppercase font-medium ${
                sourceData.urgency === 'critical' ? 'text-red-600' : 'text-orange-600'
              }`}>
                {sourceData.urgency}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Arrow */}
      <div className="flex-shrink-0 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <ChevronRightIcon className="w-4 h-4 text-gray-400" />
      </div>
    </button>
  );
}
