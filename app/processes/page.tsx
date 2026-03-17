import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';
import { ProcessesClient } from './processes-client';

export default async function ProcessesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const company = await getMyCompany(user.id, supabase);
  if (!company) redirect('/settings?tab=company');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', user.id)
    .single();

  return (
    <ProcessesClient
      userId={user.id}
      userEmail={profile?.email ?? user.email ?? ''}
      companyName={company.name}
    />
  );
}
