import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import ConnectionCard from '@/components/settings/connection-card';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch all email connections (Gmail + Outlook)
  const { data: connections } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', user.id)
    .in('provider', ['gmail', 'outlook']);

  const gmailConnection = connections?.find(c => c.provider === 'gmail');
  const outlookConnection = connections?.find(c => c.provider === 'outlook');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-primary-50/30">
      {/* Header */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link href="/" className="flex items-center space-x-2.5 group">
                <div className="relative">
                  <Image
                    src="/augmtd-logo.png"
                    alt="AUGMTD"
                    width={32}
                    height={32}
                    className="w-8 h-8 group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-primary-900 bg-clip-text text-transparent">AUGMTD</span>
              </Link>
              <Link href="/inbox" className="text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100 transition-all border border-transparent">
                Inbox
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">{user.email}</span>
              <Link href="/settings" className="p-2 text-gray-900 bg-gradient-to-br from-primary-50 to-purple-50 border border-primary-200/50 rounded-lg shadow-sm transition-all" title="Settings">
                <Cog6ToothIcon className="w-5 h-5" />
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Settings</h2>
          <p className="text-gray-600">
            Manage your account and connections
          </p>
        </div>

        {/* Account Section */}
        <div className="bg-white rounded-2xl border border-gray-200/50 p-6 mb-6 shadow-lg shadow-gray-200/50">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Account</h3>
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-100">
              <label className="text-sm font-medium text-gray-600 uppercase tracking-wide text-xs">Email</label>
              <p className="text-gray-900 mt-1.5 font-medium">{user.email}</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-100">
              <label className="text-sm font-medium text-gray-600 uppercase tracking-wide text-xs">User ID</label>
              <p className="text-xs text-gray-500 mt-1.5 font-mono break-all">{user.id}</p>
            </div>
          </div>
        </div>

        {/* Email Connections Section */}
        <div className="bg-white rounded-2xl border border-gray-200/50 p-6 mb-6 shadow-lg shadow-gray-200/50">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Connections</h3>
          <div className="space-y-3">
            <ConnectionCard
              provider="gmail"
              connection={gmailConnection}
              connectUrl="/api/auth/gmail/connect"
              disconnectUrl="/api/auth/gmail/disconnect"
            />
            <ConnectionCard
              provider="outlook"
              connection={outlookConnection}
              connectUrl="/api/auth/outlook/connect"
              disconnectUrl="/api/auth/outlook/disconnect"
            />
          </div>
        </div>

        {/* Info */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Need help? Contact support@augmtd.ai</p>
        </div>
      </main>
    </div>
  );
}
