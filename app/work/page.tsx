import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkPageClient } from './work-page-client';

export default async function WorkPage() {
  const supabase = await createClient();

  // Server-side auth check
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  // Render client component
  return (
    <WorkPageClient
      userEmail={profile?.email || user.email}
    />
  );
}
