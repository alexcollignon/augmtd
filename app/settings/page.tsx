import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import ConnectionCard from '@/components/settings/connection-card';
import AttendeeConnectionCard from '@/components/settings/attendee-connection-card';
import SettingsPageClient from './settings-page-client';

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

  // Fetch Attendee connection status
  const { data: profile } = await supabase
    .from('profiles')
    .select('attendee_enabled')
    .eq('id', user.id)
    .single();

  // Check if API key is configured
  const apiKeyConfigured = !!process.env.ATTENDEE_API_KEY;

  return (
    <SettingsPageClient>
      <div className="flex h-screen bg-gradient-to-br from-neutral-50 to-white">
        {/* Sidebar */}
        <SidebarNav userEmail={user.email} />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
            {/* Page Header */}
            <div className="mb-10">
              <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-2">
                Settings
              </h1>
              <p className="text-[15px] text-neutral-600">
                Manage your account and connections
              </p>
            </div>

            {/* Account Section */}
            <div className="bg-white border border-neutral-200 p-6 mb-6 shadow-sm">
              <h3 className="text-[15px] font-semibold text-neutral-900 mb-4">Account</h3>
              <div className="space-y-3">
                <div className="p-4 bg-neutral-50 border border-neutral-200">
                  <label className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">Email</label>
                  <p className="text-[14px] text-neutral-900 mt-1">{user.email}</p>
                </div>
                <div className="p-4 bg-neutral-50 border border-neutral-200">
                  <label className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">User ID</label>
                  <p className="text-[12px] text-neutral-600 mt-1 font-mono break-all">{user.id}</p>
                </div>
              </div>
            </div>

            {/* Email Connections Section */}
            <div className="bg-white border border-neutral-200 p-6 mb-6 shadow-sm">
              <h3 className="text-[15px] font-semibold text-neutral-900 mb-4">Email Connections</h3>
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

            {/* Meeting Transcription Section */}
            <div className="bg-white border border-neutral-200 p-6 mb-6 shadow-sm">
              <h3 className="text-[15px] font-semibold text-neutral-900 mb-4">Meeting Transcription</h3>
              <p className="text-[13px] text-neutral-600 mb-4">
                Automatically capture transcripts and generate action items from your meetings with Zoom, Google Meet, or Microsoft Teams.
              </p>
              <AttendeeConnectionCard
                isEnabled={profile?.attendee_enabled || false}
                apiKeyConfigured={apiKeyConfigured}
              />
            </div>

            {/* Info */}
            <div className="mt-8 text-center text-[12px] text-neutral-500">
              <p>Need help? Contact support@augmtd.ai</p>
            </div>
          </div>
        </main>
      </div>
    </SettingsPageClient>
  );
}
