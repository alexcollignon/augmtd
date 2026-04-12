import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ConnectionCard from '@/components/settings/connection-card';
import MeetingAssistantCard from '@/components/settings/meeting-assistant-card';
import DataManagementSection from '@/components/settings/data-management-section';
import IdentitySection from '@/components/settings/identity-section';
import SignatureSection from '@/components/settings/signature-section';
import SyncAllButton from '@/components/settings/sync-all-button';
import SettingsLeftPanel from '@/components/settings/settings-left-panel';
import SettingsPageClient from '@/app/settings/settings-page-client';
import CompanyPageClient from '@/app/company/company-page-client';
import CompanyPending from '@/app/company/company-pending';
import { getMyCompany } from '@/lib/company/get-my-company';

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export default async function SettingsPage({ searchParams }: Props) {
  const { tab = 'account' } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const company = await getMyCompany(user.id, supabase);

  let members: any[] = [];
  let invitations: any[] = [];

  if (tab === 'company' && company) {
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: membersRaw } = await adminClient
      .from('company_members')
      .select('id, user_id, role, status, joined_at, last_active_at')
      .eq('company_id', company.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });

    const memberIds = (membersRaw ?? []).map((m: any) => m.user_id as string);

    const { data: profilesData } = memberIds.length > 0
      ? await adminClient.from('profiles').select('id, full_name').in('id', memberIds)
      : { data: [] };
    const fullNameMap: Record<string, string | null> = {};
    (profilesData ?? []).forEach((p: any) => { fullNameMap[p.id] = p.full_name ?? null; });

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

  let connections: any[] = [];
  let profile: any = null;

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
  }

  const gmailConnections = connections.filter(c => c.provider === 'gmail');
  const outlookConnections = connections.filter(c => c.provider === 'outlook');
  const selfHostedConfigured = !!process.env.MEETING_BOT_SERVICE_URL;

  const activeProviders = [
    ...gmailConnections.filter(c => c.status === 'active').map(() => 'gmail'),
    ...outlookConnections.filter(c => c.status === 'active').map(() => 'outlook'),
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <SettingsPageClient>
      <>
        <SettingsLeftPanel activeTab={tab} />

        <div className="flex-1 overflow-hidden flex flex-col bg-neutral-50 p-2">
          <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">

            {tab === 'account' && (
              <div className="flex-1 overflow-y-auto">
                <section className="px-6 py-5 border-b border-neutral-100">
                  <IdentitySection
                    userEmail={user.email ?? ''}
                    initialName={profile?.full_name ?? ''}
                    avatarUrl={connections.map((c: any) => c.metadata?.picture).find((p: any) => typeof p === 'string' && p.length > 0) ?? null}
                  />
                </section>

                <section className="px-6 py-5 border-b border-neutral-100">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-[14px] font-semibold text-neutral-900">Connections</h3>
                    <SyncAllButton providers={activeProviders} />
                  </div>
                  <p className="text-[12px] text-neutral-400 mb-3">Connect your email accounts to sync messages and calendar.</p>
                  <div className="divide-y divide-neutral-100">
                    {gmailConnections.length === 0 ? (
                      <ConnectionCard provider="gmail" connection={null}
                        connectUrl="/api/auth/gmail/connect" disconnectUrl="/api/auth/gmail/disconnect" />
                    ) : (
                      <>
                        {gmailConnections.map(conn => (
                          <ConnectionCard key={conn.id} provider="gmail" connection={conn}
                            connectUrl="/api/auth/gmail/connect" disconnectUrl="/api/auth/gmail/disconnect" />
                        ))}
                        <div className="py-3">
                          <a href="/api/auth/gmail/connect" className="text-[12px] text-neutral-400 hover:text-indigo-600 transition-colors">
                            + Add another Gmail account
                          </a>
                        </div>
                      </>
                    )}
                    {outlookConnections.length === 0 ? (
                      <ConnectionCard provider="outlook" connection={null}
                        connectUrl="/api/auth/outlook/connect" disconnectUrl="/api/auth/outlook/disconnect" />
                    ) : (
                      <>
                        {outlookConnections.map(conn => (
                          <ConnectionCard key={conn.id} provider="outlook" connection={conn}
                            connectUrl="/api/auth/outlook/connect" disconnectUrl="/api/auth/outlook/disconnect" />
                        ))}
                        <div className="py-3">
                          <a href="/api/auth/outlook/connect" className="text-[12px] text-neutral-400 hover:text-indigo-600 transition-colors">
                            + Add another Outlook account
                          </a>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                <section className="px-6 py-5 border-b border-neutral-100">
                  <h3 className="text-[14px] font-semibold text-neutral-900 mb-1">Signatures</h3>
                  <p className="text-[12px] text-neutral-400 mb-3">
                    Set your email signature per account. Appended automatically when composing or replying.
                  </p>
                  <SignatureSection connections={connections} />
                </section>

                <section className="px-6 py-5 border-b border-neutral-100">
                  <h3 className="text-[14px] font-semibold text-neutral-900 mb-1">Meeting Assistant</h3>
                  <p className="text-[12px] text-neutral-400 mb-3">
                    Automatically join meetings, capture transcripts, and generate action items.
                  </p>
                  <MeetingAssistantCard
                    isEnabled={profile?.attendee_enabled || false}
                    selfHostedConfigured={selfHostedConfigured}
                  />
                </section>

                <section className="px-6 py-5">
                  <DataManagementSection connections={connections} />
                </section>
              </div>
            )}

            {tab === 'company' && (
              <div className="flex-1 overflow-y-auto">
                {company ? (
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
                )}
              </div>
            )}

          </div>
        </div>
      </>
    </SettingsPageClient>
  );
}
