'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  CheckCircleIcon,
  BellIcon,
  DocumentTextIcon,
  MegaphoneIcon,
  ChevronDownIcon,
  ChevronUpIcon
} from '@heroicons/react/24/outline';
import { BatchedItem } from '@/lib/utils/batch-inbox-items';

interface BatchCardProps {
  batch: BatchedItem;
  onClick: (itemId: string) => void;
}

export default function BatchCard({ batch, onClick }: BatchCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get icon based on category
  const getIcon = () => {
    switch (batch.icon) {
      case 'confirmations':
        return CheckCircleIcon;
      case 'notifications':
        return BellIcon;
      case 'receipts':
        return DocumentTextIcon;
      case 'marketing':
        return MegaphoneIcon;
      default:
        return CheckCircleIcon;
    }
  };

  const Icon = getIcon();

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Batch Summary */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="relative w-full text-left px-5 py-3.5 transition-colors flex items-start space-x-4 group hover:bg-gray-50"
      >
        {/* Icon */}
        <div className="flex-shrink-0 pt-0.5">
          <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
            <Icon className="w-4.5 h-4.5 text-gray-400" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Summary */}
          <h3 className="text-sm font-medium text-gray-700 mb-1">
            {batch.summary}
          </h3>

          {/* Metadata */}
          <div className="flex items-center space-x-2 text-xs text-gray-400">
            {/* Provider Badges */}
            {batch.providers.map((provider) => (
              <div key={provider} className="flex items-center space-x-1">
                <Image
                  src={provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
                  alt={provider}
                  width={12}
                  height={12}
                  className="w-3 h-3 opacity-50"
                />
              </div>
            ))}

            <span>•</span>
            <span className="text-[10px] uppercase tracking-wide">Auto-handled</span>
          </div>
        </div>

        {/* Expand/Collapse Icon */}
        <div className="flex-shrink-0 pt-1">
          {isExpanded ? (
            <ChevronUpIcon className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Items */}
      {isExpanded && (
        <div className="bg-gray-50 border-t border-gray-100">
          {batch.items.map((item, index) => (
            <button
              key={item.id}
              onClick={() => onClick(item.id)}
              className="w-full text-left px-5 py-3 pl-16 hover:bg-gray-100 transition-colors border-b border-gray-100 last:border-0"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">
                    {item.source_data?.subject || 'No subject'}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {item.source_data?.from_name || 'Unknown sender'}
                  </p>
                </div>
                <div className="flex items-center space-x-1 ml-3">
                  <Image
                    src={item.source_data?.provider === 'outlook' ? '/logos/outlook.png' : '/logos/gmail.png'}
                    alt={item.source_data?.provider || 'email'}
                    width={12}
                    height={12}
                    className="w-3 h-3 opacity-40"
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
