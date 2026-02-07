import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import ConnectionCard from '@/components/settings/connection-card';

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
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <SidebarNav userEmail={user.email} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Settings</h1>
            <p className="text-sm text-gray-500">
              Manage your account and connections
            </p>
          </div>

          {/* Account Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Account</h3>
            <div className="space-y-3">
              <div className="p-4 bg-gray-50 rounded-lg">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</label>
                <p className="text-sm text-gray-900 mt-1">{user.email}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">User ID</label>
                <p className="text-xs text-gray-600 mt-1 font-mono break-all">{user.id}</p>
              </div>
            </div>
          </div>

          {/* Email Connections Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Email Connections</h3>
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
          <div className="mt-8 text-center text-xs text-gray-400">
            <p>Need help? Contact support@augmtd.ai</p>
          </div>
        </div>
      </main>
    </div>
  );
}
