'use client';

import { useState } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';
import ActivityLogRow from '@/components/activity/activity-log-row';
import ActivityDrawer from '@/components/activity/activity-drawer';

interface ActivityPageClientProps {
  activityItems: any[];
}

export default function ActivityPageClient({ activityItems }: ActivityPageClientProps) {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleRowClick = (item: any) => {
    setSelectedItem(item);
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    // Keep selectedItem for a moment to allow smooth transition
    setTimeout(() => setSelectedItem(null), 300);
  };

  return (
    <>
      {/* Activity Log */}
      {activityItems.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <ClockIcon className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-2">
            No activity yet
          </h3>
          <p className="text-sm text-gray-600">
            Completed work will appear here
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {/* Log Header */}
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center space-x-3 text-xs font-semibold text-gray-500 uppercase tracking-wide font-mono">
              <span className="w-20 flex-shrink-0">Time</span>
              <span className="w-4 flex-shrink-0"></span>
              <span className="flex-1">Action</span>
              <span className="flex-shrink-0">Source</span>
            </div>
          </div>

          {/* Log Rows */}
          <div className="divide-y divide-gray-100">
            {activityItems.map((item) => (
              <ActivityLogRow
                key={item.id}
                item={item}
                onClick={() => handleRowClick(item)}
                isSelected={selectedItem?.id === item.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Drawer */}
      <ActivityDrawer
        item={selectedItem}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
      />
    </>
  );
}
