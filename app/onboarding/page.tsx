'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { EnvelopeIcon, SparklesIcon, ClockIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient();
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login');
        return;
      }

      // Check if user already has a connection
      const { data: connection } = await supabase
        .from('connections')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('provider', 'gmail')
        .eq('status', 'active')
        .single();

      if (connection) {
        // Already connected, redirect to inbox
        router.push('/inbox');
        return;
      }

      setUser(currentUser);
      setLoading(false);
    }

    loadUser();
  }, [router]);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <Image
              src="/augmtd-logo.png"
              alt="AUGMTD"
              width={80}
              height={80}
              className="w-20 h-20"
            />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">
            Welcome to AUGMTD
          </h1>
          <p className="text-xl text-gray-600">
            Your personal digital twin that prepares your next steps
          </p>
        </div>

        {/* What happens next */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">
            Here's what happens next:
          </h2>
          <div className="space-y-6">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <EnvelopeIcon className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-1">Connect your Gmail</h3>
                <p className="text-sm text-gray-600">
                  We'll securely connect to your Gmail account. AUGMTD only reads emails - we never send or modify anything without your explicit approval.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <SparklesIcon className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-1">AI analyzes your emails</h3>
                <p className="text-sm text-gray-600">
                  Our AI reads your emails and prepares everything you need: draft replies, action items, calendar events, and key information.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <ClockIcon className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-1">Daily sync at 9 AM</h3>
                <p className="text-sm text-gray-600">
                  Every morning, AUGMTD fetches your new emails and prepares work for you. Wake up to an organized inbox with everything ready to review.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <CheckCircleIcon className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-1">Review and approve</h3>
                <p className="text-sm text-gray-600">
                  You stay in control. Review the prepared work, approve what looks good, or make edits before taking action.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Connect button */}
        <div className="text-center">
          <a
            href="/api/auth/gmail/connect"
            className="inline-flex items-center px-8 py-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium text-lg transition-colors shadow-sm"
          >
            <EnvelopeIcon className="w-6 h-6 mr-2" />
            Connect Gmail
          </a>
          <p className="text-sm text-gray-500 mt-4">
            Signed in as {user?.email}
          </p>
        </div>
      </div>
    </div>
  );
}
