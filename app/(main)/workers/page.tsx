import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { WorkersPageClient } from '@/app/workers/workers-page-client';
import type { WorkersPageClientProps } from '@/app/workers/workers-page-client';

export default async function WorkersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Seed pre-built workers on first visit (idempotent — creates them as disabled)
  const baseUrl = process.env.AUGMTD_WEBHOOK_BASE_URL ?? 'http://localhost:3000';
  try {
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ');
    await fetch(`${baseUrl}/api/workers/init`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
  } catch { /* non-critical */ }

  // Fetch ALL workers (enabled and disabled) so the setup view can show them
  const { data: workers } = await supabase
    .from('custom_agents')
    .select('id, name, description, color, icon, worker_role, is_enabled, conversation_starters')
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  // SSR threads + messages for the first enabled worker's most recent thread
  const firstEnabled = (workers ?? []).find(w => w.is_enabled) ?? null;
  const { data: initialThreads } = firstEnabled
    ? await supabase
        .from('work_threads')
        .select('id, title, created_at, updated_at, agent_id')
        .eq('user_id', user.id)
        .eq('agent_id', firstEnabled.id)
        .eq('status', 'active')
        .or('is_temporary.eq.false,is_temporary.is.null')
        .is('workflow_id', null)
        .order('updated_at', { ascending: false })
        .limit(30)
    : { data: [] };

  const firstThread = (initialThreads ?? [])[0] ?? null;
  const { data: initialMessages } = firstThread
    ? await supabase
        .from('work_messages')
        .select('id, role, content, created_at, metadata')
        .eq('thread_id', firstThread.id)
        .order('created_at', { ascending: true })
    : { data: [] };

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const fullName = (profile as { full_name: string | null } | null)?.full_name ?? null;
  const firstName = fullName?.split(' ')[0] ?? undefined;

  return (
    <WorkersPageClient
      userId={user.id}
      userFirstName={firstName}
      initialWorkers={(workers ?? []) as Parameters<typeof WorkersPageClient>[0]['initialWorkers']}
      initialThreads={initialThreads ?? []}
      initialMessages={(initialMessages ?? []) as WorkersPageClientProps['initialMessages']}
    />
  );
}
