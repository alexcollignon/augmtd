import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InboxPageClient } from './inbox-page-client';
import { getUserIdentity } from '@/lib/context/work-patterns-service';

export default async function PreparedWorkPage() {
  const supabase = await createClient();

  // Server-side auth check
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  // Fetch connection
  const { data: connections } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', user.id)
    .in('provider', ['gmail', 'outlook'])
    .eq('status', 'active')
    .limit(1);

  const connection = connections?.[0] || null;

  // Fetch inbox items
  const { data: inboxItems } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  // Check if user has completed identity profile (full name, department, role)
  const identity = await getUserIdentity(user.id, supabase);
  const hasCompletedIdentity = !!(
    profile?.full_name &&
    identity?.department &&
    identity?.jobRole
  );

  // Render client component with initial data
  return (
    <InboxPageClient
      initialUser={user}
      initialUserFullName={profile?.full_name}
      initialConnection={connection}
      initialInboxItems={inboxItems || []}
      hasCompletedIdentity={hasCompletedIdentity}
    />
  );
}
