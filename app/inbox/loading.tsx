import SidebarNav from '@/components/sidebar-nav';
import InboxCardSkeleton from '@/components/inbox/inbox-card-skeleton';

export default function Loading() {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <SidebarNav userEmail="" />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <div className="h-8 bg-gray-200 rounded w-48 mb-2 animate-pulse" />
            <div className="h-4 bg-gray-200 rounded w-96 animate-pulse" />
          </div>

          {/* Loading Cards */}
          <div className="mb-8">
            <div className="flex items-center space-x-2.5 mb-3">
              <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
              <div className="h-4 bg-gray-200 rounded w-40 animate-pulse" />
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100">
              <InboxCardSkeleton />
              <InboxCardSkeleton />
              <InboxCardSkeleton />
            </div>
          </div>

          {/* Another section */}
          <div>
            <div className="flex items-center space-x-2.5 mb-3">
              <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
              <div className="h-4 bg-gray-200 rounded w-32 animate-pulse" />
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100">
              <InboxCardSkeleton />
              <InboxCardSkeleton />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
