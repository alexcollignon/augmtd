import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/workers/[id] — toggle is_enabled
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  if (typeof body.is_enabled !== 'boolean') {
    return NextResponse.json({ error: 'is_enabled required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('custom_agents')
    .update({ is_enabled: body.is_enabled })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('is_worker', true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
