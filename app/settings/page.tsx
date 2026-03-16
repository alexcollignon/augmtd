import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import ConnectionCard from '@/components/settings/connection-card';
import AttendeeConnectionCard from '@/components/settings/attendee-connection-card';
import DataManagementSection from '@/components/settings/data-management-section';
import IdentitySection from '@/components/settings/identity-section';
import SettingsPageClient from './settings-page-client';
import SettingsTabsClient from './settings-tabs-client';
import CompanyPageClient from '../company/company-page-client';
import CompanyPending from '../company/company-pending';
import { getUserIdentity } from '@/lib/context/work-patterns-service';
import { getMyCompany } from '@/lib/company/get-my-company';

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export default async function SettingsPage({ searchParams }: Props) {
  const { tab = 'account' } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // ── Company tab data ───────────────────────────────────────────────────────
  const company = await getMyCompany(user.id, supabase);

  let members: any[] = [];
  let invitations: any[] = [];

  if (tab === 'company' && company) {
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Use adminClient to bypass RLS — members need to see all teammates, not just themselves
    const { data: membersRaw } = await adminClient
      .from('company_members')
      .select('id, user_id, role, status, joined_at, last_active_at')
      .eq('company_id', company.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });

    const memberIds = (membersRaw ?? []).map((m: any) => m.user_id as string);

    // Get full names from profiles separately (no direct FK for embedded join)
    const { data: profilesData } = memberIds.length > 0
      ? await adminClient.from('profiles').select('id, full_name').in('id', memberIds)
      : { data: [] };
    const fullNameMap: Record<string, string | null> = {};
    (profilesData ?? []).forEach((p: any) => { fullNameMap[p.id] = p.full_name ?? null; });

    // Get emails from auth
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    const emailMap: Record<string, string> = {};
    (authUsers?.users ?? []).forEach((u: any) => { emailMap[u.id] = u.email ?? ''; });

    if (company.role === 'owner' || company.role === 'admin') {
      const { data: inv } = await adminClient
        .from('company_invitations')
        .select('id, email, role, status, expires_at, created_at, token')
        .eq('company_id', company.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      invitations = inv ?? [];
    }

    members = (membersRaw ?? []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      status: m.status,
      joined_at: m.joined_at,
      last_active_at: m.last_active_at,
      full_name: fullNameMap[m.user_id] ?? null,
      email: emailMap[m.user_id] ?? '',
      isCurrentUser: m.user_id === user.id,
    }));
  }

  // ── Account tab data ───────────────────────────────────────────────────────
  let connections: any[] = [];
  let profile: any = null;
  let identity: any = null;

  if (tab === 'account') {
    const { data: conns } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .in('provider', ['gmail', 'outlook']);
    connections = conns ?? [];

    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name, attendee_enabled')
      .eq('id', user.id)
      .single();
    profile = prof;

    identity = await getUserIdentity(user.id, supabase);
  }

  const gmailConnections = connections.filter(c => c.provider === 'gmail');
  const outlookConnections = connections.filter(c => c.provider === 'outlook');
  const apiKeyConfigured = !!process.env.ATTENDEE_API_KEY;

  return (
    <SettingsPageClient>
      <div className="flex h-screen bg-gradient-to-br from-neutral-50 to-white">
        <SidebarNav userEmail={user.email} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-1">Settings</h1>
              <p className="text-[14px] text-neutral-500">Manage your account and team</p>
            </div>

            {/* Tabs */}
            <SettingsTabsClient activeTab={tab} />

            {/* ── Account tab ─────────────────────────────────────────────── */}
            {tab === 'account' && (
              <>
                <IdentitySection
                  userEmail={user.email ?? ''}
                  initialName={profile?.full_name ?? ''}
                  initialDepartment={identity?.department ?? ''}
                  initialRole={identity?.jobRole ?? ''}
                />

                <div className="bg-white border border-neutral-200 p-6 mb-6 shadow-sm">
                  <h3 className="text-[15px] font-semibold text-neutral-900 mb-4">Email Connections</h3>
                  <div className="space-y-3">
                    {gmailConnections.length === 0 ? (
                      <ConnectionCard provider="gmail" connection={null}
                        connectUrl="/api/auth/gmail/connect" disconnectUrl="/api/auth/gmail/disconnect" />
                    ) : (
                      <div className="space-y-2">
                        {gmailConnections.map(conn => (
                          <ConnectionCard key={conn.id} provider="gmail" connection={conn}
                            connectUrl="/api/auth/gmail/connect" disconnectUrl="/api/auth/gmail/disconnect" />
                        ))}
                        <a href="/api/auth/gmail/connect"
                          className="flex items-center gap-2 px-3 py-2 text-[13px] text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 border border-dashed border-neutral-300 transition-colors">
                          <span className="text-[16px] leading-none">+</span>
                          Add another Gmail account
                        </a>
                      </div>
                    )}
                    {outlookConnections.length === 0 ? (
                      <ConnectionCard provider="outlook" connection={null}
                        connectUrl="/api/auth/outlook/connect" disconnectUrl="/api/auth/outlook/disconnect" />
                    ) : (
                      <div className="space-y-2">
                        {outlookConnections.map(conn => (
                          <ConnectionCard key={conn.id} provider="outlook" connection={conn}
                            connectUrl="/api/auth/outlook/connect" disconnectUrl="/api/auth/outlook/disconnect" />
                        ))}
                        <a href="/api/auth/outlook/connect"
                          className="flex items-center gap-2 px-3 py-2 text-[13px] text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 border border-dashed border-neutral-300 transition-colors">
                          <span className="text-[16px] leading-none">+</span>
                          Add another Outlook account
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                <DataManagementSection connections={connections} />

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

                <div className="mt-8 text-center text-[12px] text-neutral-500">
                  <p>Need help? Contact support@augmtd.ai</p>
                </div>
              </>
            )}

            {/* ── Company tab ─────────────────────────────────────────────── */}
            {tab === 'company' && (
              company ? (
                <CompanyPageClient
                  company={company}
                  members={members}
                  invitations={invitations}
                  currentUserId={user.id}
                  embedded
                />
              ) : (
                <div className="flex justify-center pt-8">
                  <CompanyPending />
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </SettingsPageClient>
  );
}
