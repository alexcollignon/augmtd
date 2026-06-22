import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

// DELETE /api/workers/[id]/activity — clear this worker's run history (workflow_runs).
// Conversations are left alone (delete those from the chat tab).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workerId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: wfs } = await admin.from('workflows').select('id').eq('user_id', user.id).eq('agent_id', workerId);
  const ids = (wfs ?? []).map((w: { id: string }) => w.id);
  if (ids.length === 0) return NextResponse.json({ deleted: 0 });

  const { data: del } = await admin
    .from('workflow_runs')
    .delete()
    .eq('user_id', user.id)
    .in('workflow_id', ids)
    .select('id');

  return NextResponse.json({ deleted: del?.length ?? 0 });
}
