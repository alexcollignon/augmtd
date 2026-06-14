import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { WorkersPageClient } from '@/app/workers/workers-page-client';

export default async function WorkersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Seed pre-built workers on first visit (idempotent)
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? process.env.AUGMTD_WEBHOOK_BASE_URL ?? 'http://localhost:3000'
    : 'http://localhost:3000';

  try {
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ');
    await fetch(`${baseUrl}/api/workers/init`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
  } catch { /* non-critical — UI will show empty state */ }

  // Fetch workers
  const { data: workers } = await supabase
    .from('custom_agents')
    .select('id, name, description, color, icon, worker_role, conversation_starters')
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  const firstWorker = workers?.[0] ?? null;

  // Fetch threads for first worker (SSR for instant load)
  const { data: initialThreads } = firstWorker
    ? await supabase
        .from('work_threads')
        .select('id, title, created_at, updated_at, agent_id')
        .eq('user_id', user.id)
        .eq('agent_id', firstWorker.id)
        .eq('status', 'active')
        .or('is_temporary.eq.false,is_temporary.is.null')
        .is('workflow_id', null)
        .order('updated_at', { ascending: false })
        .limit(30)
    : { data: [] };

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  return (
    <WorkersPageClient
      userId={user.id}
      userFullName={(profile as { full_name: string | null } | null)?.full_name ?? undefined}
      initialWorkers={workers ?? []}
      initialActiveWorkerId={firstWorker?.id ?? null}
      initialThreads={initialThreads ?? []}
    />
  );
}
