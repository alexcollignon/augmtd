import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import MeetingAssistantCard from '@/components/settings/meeting-assistant-card';
import DataManagementSection from '@/components/settings/data-management-section';
import IdentitySection from '@/components/settings/identity-section';
import SettingsLeftPanel from '@/components/settings/settings-left-panel';
import SettingsPageClient from '@/app/settings/settings-page-client';
import CompanyPageClient from '@/app/company/company-page-client';
import CompanyPending from '@/app/company/company-pending';
import CompanyAIOperationsSection from '@/components/settings/company-ai-operations-section';
import CompanyStrategySection from '@/components/settings/company-strategy-section';
import MemorySection from '@/components/settings/memory-section';
import EmailSettings from '@/components/settings/email-settings';
import IntegrationsSection from '@/components/settings/integrations-section';
import { getMyCompany } from '@/lib/company/get-my-company';

interface Props {
  searchParams: Promise<{ tab?: string; section?: string }>;
}

export default async function SettingsPage({ searchParams }: Props) {
  const { tab = 'account', section: rawSection } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const company = await getMyCompany(user.id, supabase);
  const isCompanyAdmin = company?.role === 'owner' || company?.role === 'admin';
  const section = rawSection ?? (tab === 'company' ? 'members' : 'connections');

  let members: any[] = [];
  let invitations: any[] = [];

  if (tab === 'company' && company && section === 'members') {
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

  if (tab === 'account' || tab === 'email') {
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

  const selfHostedConfigured = !!process.env.MEETING_BOT_SERVICE_URL;

  return (
    <SettingsPageClient>
      <>
        <SettingsLeftPanel activeTab={tab} companyRole={company?.role ?? null} />

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
                  <DataManagementSection connections={connections} userEmail={user.email ?? ''} />
                </section>
              </div>
            )}

            {tab === 'email' && (
              <EmailSettings connections={connections} section={section as 'connections' | 'rules' | 'drafting' | 'todo'} />
            )}

            {tab === 'memory' && (
              <MemorySection />
            )}

            {tab === 'connections' && (
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <IntegrationsSection />
              </div>
            )}

            {tab === 'company' && (
              <div className="flex-1 overflow-y-auto">
                {!company ? (
                  <div className="flex justify-center pt-8">
                    <CompanyPending />
                  </div>
                ) : section === 'ai-operations' ? (
                  isCompanyAdmin ? <CompanyAIOperationsSection /> : null
                ) : section === 'strategy' ? (
                  isCompanyAdmin ? <CompanyStrategySection /> : null
                ) : (
                  <CompanyPageClient
                    company={company}
                    members={members}
                    invitations={invitations}
                    currentUserId={user.id}
                    embedded
                  />
                )}
              </div>
            )}

          </div>
        </div>
      </>
    </SettingsPageClient>
  );
}
