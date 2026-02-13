'use client';

import { useState, useEffect } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';
import ActivityLogRow from '@/components/activity/activity-log-row';
import ActivityDrawer from '@/components/activity/activity-drawer';
import { createClient } from '@/lib/supabase/client';

interface ActivityPageClientProps {
  activityItems: any[];
}

export default function ActivityPageClient({ activityItems }: ActivityPageClientProps) {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  console.log('[ActivityPageClient] Received items:', activityItems?.length || 0);

  // Monitor session validity
  useEffect(() => {
    const supabase = createClient();

    async function checkSession() {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        console.log('[Session] Invalid or expired, redirecting to login');
        window.location.href = '/login?session=expired';
      }
    }

    // Check session every 30 seconds
    const sessionCheckInterval = setInterval(checkSession, 30000);

    // Initial check
    checkSession();

    return () => clearInterval(sessionCheckInterval);
  }, []);

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
        <div className="text-center py-20 bg-white border border-neutral-200 shadow-sm">
          <div className="w-16 h-16 mx-auto mb-5 bg-gradient-to-br from-neutral-100 to-neutral-200 flex items-center justify-center shadow-sm">
            <ClockIcon className="w-8 h-8 text-neutral-400" />
          </div>
          <h3 className="text-[17px] font-semibold text-neutral-900 mb-2">
            No activity yet
          </h3>
          <p className="text-[14px] text-neutral-600">
            Completed work will appear here
          </p>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 shadow-sm overflow-hidden">
          {/* Log Header */}
          <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
            <div className="flex items-center gap-3 text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">
              <span className="w-20 flex-shrink-0">Time</span>
              <span className="w-1 flex-shrink-0"></span>
              <span className="flex-1">Action</span>
              <span className="flex-shrink-0">Source</span>
            </div>
          </div>

          {/* Log Rows */}
          <div className="divide-y divide-neutral-100">
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
