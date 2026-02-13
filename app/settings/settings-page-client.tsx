'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface SettingsPageClientProps {
  children: React.ReactNode;
}

export default function SettingsPageClient({ children }: SettingsPageClientProps) {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(null);

  useEffect(() => {
    const success = searchParams?.get('success');

    if (success === 'disconnected') {
      setMessage({ type: 'success', text: 'Email account disconnected successfully' });
      // Clean URL after showing message
      window.history.replaceState({}, '', '/settings');

      // Clear message after 5 seconds
      setTimeout(() => setMessage(null), 5000);
    }
  }, [searchParams]);

  return (
    <>
      {message && (
        <div className="fixed top-4 right-4 z-50 max-w-md">
          <div className={`p-4 border shadow-lg ${
            message.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            <p className="text-[13px] font-medium">{message.text}</p>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
