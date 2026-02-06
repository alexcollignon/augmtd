'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export default function InboxViewToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'filtered';

  const handleViewChange = (newView: string) => {
    router.push(`/inbox?view=${newView}`);
  };

  return (
    <div className="inline-flex items-center bg-white border border-gray-200 rounded-lg p-1">
      <button
        onClick={() => handleViewChange('filtered')}
        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
          view === 'filtered'
            ? 'bg-primary-100 text-primary-700'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        🤖 AI-Filtered
      </button>
      <button
        onClick={() => handleViewChange('all')}
        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
          view === 'all'
            ? 'bg-primary-100 text-primary-700'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        📧 All Emails
      </button>
    </div>
  );
}
