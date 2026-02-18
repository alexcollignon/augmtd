import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import ConnectionCard from '@/components/settings/connection-card';
import AttendeeConnectionCard from '@/components/settings/attendee-connection-card';
import IdentitySection from '@/components/settings/identity-section';
import SettingsPageClient from './settings-page-client';
import { getUserIdentity } from '@/lib/context/work-patterns-service';

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

  // Fetch profile data (name + attendee status)
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, attendee_enabled')
    .eq('id', user.id)
    .single();

  // Fetch identity (department + role)
  const identity = await getUserIdentity(user.id, supabase);

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

            {/* Profile / Identity Section */}
            <IdentitySection
              userEmail={user.email ?? ''}
              initialName={profile?.full_name ?? ''}
              initialDepartment={identity?.department ?? ''}
              initialRole={identity?.jobRole ?? ''}
            />

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
              <h3 className="text-[15px] font-semibold text-neutral-900 mb-4">Meeting Assistant</h3>
              <p className="text-[13px] text-neutral-600 mb-4">
                Automatically join your meetings, capture transcripts, and generate action items using AI.
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
