import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import EmailSyncSettings from '@/components/settings/email-sync-settings';
import ManualSyncButton from '@/components/settings/manual-sync-button';
import { EnvelopeIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';

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

        {/* Gmail Connection Section */}
        <div className="bg-white rounded-2xl border border-gray-200/50 p-6 mb-6 shadow-lg shadow-gray-200/50">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Gmail Connection</h3>

          {gmailConnection && gmailConnection.status === 'active' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-5 bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200/50 rounded-xl shadow-sm">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-200">
                      <svg viewBox="0 0 48 48" className="w-7 h-7">
                        <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"/>
                        <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"/>
                        <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/>
                        <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z"/>
                        <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0 C43.076,8,45,9.924,45,12.298z"/>
                      </svg>
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Gmail</p>
                    <p className="text-sm text-gray-600 mt-0.5">{gmailConnection.account_email}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Connected {new Date(gmailConnection.connected_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 shadow-sm">
                    ● Active
                  </span>
                </div>
              </div>

              {/* Sync Status */}
              <div className="p-5 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">Sync Status</span>
                  <span className="text-xs font-medium text-gray-600 capitalize px-2.5 py-1 bg-white rounded-full border border-gray-200">{gmailConnection.sync_status || 'ready'}</span>
                </div>
                {gmailConnection.last_sync && (
                  <p className="text-xs text-gray-500 mt-2">
                    Last synced: {new Date(gmailConnection.last_sync).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Manual Sync */}
              <div className="p-5 bg-gradient-to-br from-primary-50 to-purple-50 rounded-xl border border-primary-200/50">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Manual Sync</h4>
                <p className="text-xs text-gray-600 mb-4 leading-relaxed">
                  Fetch and process new emails immediately instead of waiting for the scheduled sync.
                </p>
                <ManualSyncButton />
              </div>

              {/* Sync Settings */}
              <div className="p-5 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200/50">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Sync Settings</h4>
                <EmailSyncSettings
                  connectionId={gmailConnection.id}
                  currentMaxEmails={gmailConnection.metadata?.max_emails_per_sync || 10}
                />
              </div>

              {/* Disconnect Button */}
              <form action="/api/auth/gmail/disconnect" method="POST">
                <button
                  type="submit"
                  className="w-full px-4 py-3 border-2 border-red-200 text-red-700 rounded-xl hover:bg-red-50 hover:border-red-300 font-semibold transition-all duration-200"
                >
                  Disconnect Gmail
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-8 bg-gradient-to-br from-gray-50 to-white border border-gray-200/50 rounded-xl text-center">
                <div className="inline-flex p-4 bg-white rounded-2xl mb-4 border border-gray-200 shadow-sm">
                  <svg viewBox="0 0 48 48" className="w-10 h-10">
                    <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"/>
                    <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"/>
                    <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/>
                    <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z"/>
                    <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0 C43.076,8,45,9.924,45,12.298z"/>
                  </svg>
                </div>
                <p className="text-gray-600 mb-6 font-medium">No email account connected</p>
                <Link
                  href="/api/auth/gmail/connect"
                  className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl hover:from-primary-700 hover:to-primary-800 font-semibold transition-all duration-200 shadow-lg shadow-primary-500/30"
                >
                  <svg viewBox="0 0 48 48" className="w-5 h-5">
                    <path fill="currentColor" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"/>
                    <path fill="currentColor" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"/>
                    <polygon fill="currentColor" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/>
                  </svg>
                  <span>Connect Gmail</span>
                </Link>
              </div>
              <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200/50">
                <p className="text-xs font-semibold text-gray-700 mb-3">Permissions required:</p>
                <ul className="space-y-2 text-xs text-gray-600">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2">•</span>
                    <span>Read your emails</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2">•</span>
                    <span>Send emails on your behalf</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2">•</span>
                    <span>Manage labels</span>
                  </li>
                </ul>
                <p className="mt-4 text-xs text-gray-500 italic">
                  Your credentials are stored securely and never shared with third parties.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Outlook Connection Section */}
        <div className="bg-white rounded-2xl border border-gray-200/50 p-6 mb-6 shadow-lg shadow-gray-200/50">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Outlook Connection</h3>

          {outlookConnection && outlookConnection.status === 'active' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-5 bg-gradient-to-br from-blue-50 to-sky-50 border border-blue-200/50 rounded-xl shadow-sm">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-200">
                      <svg viewBox="0 0 48 48" className="w-7 h-7">
                        <path fill="#0078D4" d="M24,4L4,12v24l20,8l20-8V12L24,4z M24,28l-12-6l12-6l12,6L24,28z"/>
                        <path fill="#50E6FF" d="M24,16l12,6v12l-12,6V28l-12-6v-6L24,16z"/>
                        <path fill="#0078D4" opacity="0.5" d="M12,22v12l12,6V28L12,22z"/>
                      </svg>
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Outlook</p>
                    <p className="text-sm text-gray-600 mt-0.5">{outlookConnection.account_email}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Connected {new Date(outlookConnection.connected_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 shadow-sm">
                    ● Active
                  </span>
                </div>
              </div>

              {/* Sync Status */}
              <div className="p-5 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">Sync Status</span>
                  <span className="text-xs font-medium text-gray-600 capitalize px-2.5 py-1 bg-white rounded-full border border-gray-200">{outlookConnection.sync_status || 'ready'}</span>
                </div>
                {outlookConnection.last_sync && (
                  <p className="text-xs text-gray-500 mt-2">
                    Last synced: {new Date(outlookConnection.last_sync).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Disconnect Button */}
              <form action="/api/auth/outlook/disconnect" method="POST">
                <button
                  type="submit"
                  className="w-full px-4 py-3 border-2 border-red-200 text-red-700 rounded-xl hover:bg-red-50 hover:border-red-300 font-semibold transition-all duration-200"
                >
                  Disconnect Outlook
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-8 bg-gradient-to-br from-gray-50 to-white border border-gray-200/50 rounded-xl text-center">
                <div className="inline-flex p-4 bg-white rounded-2xl mb-4 border border-gray-200 shadow-sm">
                  <svg viewBox="0 0 48 48" className="w-10 h-10">
                    <path fill="#0078D4" d="M24,4L4,12v24l20,8l20-8V12L24,4z M24,28l-12-6l12-6l12,6L24,28z"/>
                    <path fill="#50E6FF" d="M24,16l12,6v12l-12,6V28l-12-6v-6L24,16z"/>
                    <path fill="#0078D4" opacity="0.5" d="M12,22v12l12,6V28L12,22z"/>
                  </svg>
                </div>
                <p className="text-gray-600 mb-6 font-medium">No Outlook account connected</p>
                <Link
                  href="/api/auth/outlook/connect"
                  className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 font-semibold transition-all duration-200 shadow-lg shadow-blue-500/30"
                >
                  <svg viewBox="0 0 48 48" className="w-5 h-5">
                    <path fill="currentColor" d="M24,4L4,12v24l20,8l20-8V12L24,4z M24,28l-12-6l12-6l12,6L24,28z"/>
                    <path fill="currentColor" opacity="0.7" d="M24,16l12,6v12l-12,6V28l-12-6v-6L24,16z"/>
                  </svg>
                  <span>Connect Outlook</span>
                </Link>
              </div>
              <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200/50">
                <p className="text-xs font-semibold text-gray-700 mb-3">Permissions required:</p>
                <ul className="space-y-2 text-xs text-gray-600">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2">•</span>
                    <span>Read your emails</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2">•</span>
                    <span>Send emails on your behalf</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2">•</span>
                    <span>Access your profile information</span>
                  </li>
                </ul>
                <p className="mt-4 text-xs text-gray-500 italic">
                  Your credentials are stored securely and never shared with third parties.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Preferences Section */}
        <div className="bg-white rounded-2xl border border-gray-200/50 p-6 shadow-lg shadow-gray-200/50">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Preferences</h3>
          <div className="space-y-1">
            <div className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-50 transition-colors">
              <div>
                <p className="font-semibold text-gray-900">Email notifications</p>
                <p className="text-sm text-gray-600 mt-0.5">Get notified when new items arrive</p>
              </div>
              <button className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 hover:bg-gray-300">
                <span className="translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"></span>
              </button>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-50 transition-colors border-t border-gray-100">
              <div>
                <p className="font-semibold text-gray-900">Auto-approve low-risk items</p>
                <p className="text-sm text-gray-600 mt-0.5">Automatically execute high-confidence suggestions</p>
              </div>
              <button className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 hover:bg-gray-300">
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
