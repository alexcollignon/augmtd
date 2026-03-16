import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import InviteAcceptClient from './invite-accept-client';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InviteAcceptPage({ params }: Props) {
  const { token } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/company/invite/${token}`);

  // Validate the token server-side
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/company/invitations/${token}`
  );
  const inviteData = res.ok ? await res.json() : null;
  const inviteError = res.ok ? null : (await res.json().catch(() => ({ error: 'Invalid invitation' }))).error;

  return (
    <div className="flex h-screen bg-gradient-to-br from-neutral-50 to-white">
      <SidebarNav userEmail={user.email} />
      <main className="flex-1 flex items-center justify-center">
        <InviteAcceptClient
          token={token}
          invite={inviteData}
          error={inviteError}
          userEmail={user.email ?? ''}
        />
      </main>
    </div>
  );
}
