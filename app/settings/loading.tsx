export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-primary-50/30">
      {/* Header Skeleton */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <div className="w-32 h-8 bg-gray-200 rounded animate-pulse" />
              <div className="w-20 h-8 bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="flex items-center space-x-4">
              <div className="w-32 h-6 bg-gray-200 rounded-full animate-pulse" />
              <div className="w-8 h-8 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Skeleton */}
        <div className="mb-8">
          <div className="h-9 w-32 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-5 w-64 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Account Card Skeleton */}
        <div className="bg-white rounded-2xl border border-gray-200/50 p-6 mb-6 shadow-lg shadow-gray-200/50">
          <div className="h-6 w-24 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-xl">
              <div className="h-3 w-16 bg-gray-200 rounded animate-pulse mb-2" />
              <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="p-4 bg-gray-50 rounded-xl">
              <div className="h-3 w-16 bg-gray-200 rounded animate-pulse mb-2" />
              <div className="h-4 w-64 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* Connection Card Skeleton */}
        <div className="bg-white rounded-2xl border border-gray-200/50 p-6 mb-6 shadow-lg shadow-gray-200/50">
          <div className="h-6 w-40 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="p-5 bg-gray-50 rounded-xl">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gray-200 rounded-xl animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
