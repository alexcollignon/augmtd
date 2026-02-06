import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch Gmail connection
  const { data: connection } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .single();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <h1 className="text-2xl font-bold text-primary-600">AUGMTD</h1>
              <div className="flex space-x-4">
                <Link href="/inbox" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md">
                  Inbox
                </Link>
                <Link href="/settings" className="text-gray-900 font-medium px-3 py-2 rounded-md bg-gray-100">
                  Settings
                </Link>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user.email}</span>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900"
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
          <h2 className="text-2xl font-semibold text-gray-900">Settings</h2>
          <p className="text-gray-600 mt-1">
            Manage your account and connections
          </p>
        </div>

        {/* Account Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Account</h3>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Email</label>
              <p className="text-gray-900 mt-1">{user.email}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">User ID</label>
              <p className="text-xs text-gray-500 mt-1 font-mono">{user.id}</p>
            </div>
          </div>
        </div>

        {/* Gmail Connection Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Connection</h3>

          {connection && connection.status === 'active' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                      <span className="text-xl">📧</span>
                    </div>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Gmail</p>
                    <p className="text-sm text-gray-600">{connection.account_email}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Connected on {new Date(connection.connected_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Active
                  </span>
                </div>
              </div>

              {/* Sync Status */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Sync Status</span>
                  <span className="text-xs text-gray-600 capitalize">{connection.sync_status || 'ready'}</span>
                </div>
                {connection.last_sync && (
                  <p className="text-xs text-gray-500">
                    Last synced: {new Date(connection.last_sync).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Disconnect Button */}
              <form action="/api/auth/gmail/disconnect" method="POST">
                <button
                  type="submit"
                  className="w-full px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 font-medium transition-colors"
                >
                  Disconnect Gmail
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                <p className="text-gray-600 mb-4">No email account connected</p>
                <Link
                  href="/api/auth/gmail/connect"
                  className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium transition-colors"
                >
                  Connect Gmail
                </Link>
              </div>
              <div className="text-xs text-gray-500">
                <p className="mb-2"><strong>Permissions required:</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Read your emails</li>
                  <li>Send emails on your behalf</li>
                  <li>Manage labels</li>
                </ul>
                <p className="mt-3">
                  Your credentials are stored securely and never shared with third parties.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Preferences Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Preferences</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-gray-900">Email notifications</p>
                <p className="text-sm text-gray-600">Get notified when new items arrive</p>
              </div>
              <button className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2">
                <span className="translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"></span>
              </button>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-gray-200">
              <div>
                <p className="font-medium text-gray-900">Auto-approve low-risk items</p>
                <p className="text-sm text-gray-600">Automatically execute high-confidence suggestions</p>
              </div>
              <button className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2">
                <span className="translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"></span>
              </button>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Need help? Contact support@augmtd.com</p>
        </div>
      </main>
    </div>
  );
}
