// ─── POST /api/notifications/workflows/read — mark notifications as seen ──────
// Body: { workflow_id? } — if provided, marks only that workflow's; else all.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const workflowId = body.workflow_id as string | undefined;

  let query = supabase
    .from('workflow_notifications')
    .update({ seen: true })
    .eq('user_id', user.id)
    .eq('seen', false);

  if (workflowId) query = query.eq('workflow_id', workflowId);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
