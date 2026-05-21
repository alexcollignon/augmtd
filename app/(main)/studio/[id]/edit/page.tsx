import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { StudioBuilderClient } from '@/app/work/studio/[id]/edit/studio-builder-client';

export const dynamic = 'force-dynamic';

export default async function StudioEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: workflow }, { data: agents }] = await Promise.all([
    supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('custom_agents')
      .select('id, name, description, color, icon')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('name'),
  ]);

  if (!workflow) notFound();

  return (
    <StudioBuilderClient
      userId={user.id}
      initialWorkflow={workflow}
      agents={agents ?? []}
    />
  );
}
