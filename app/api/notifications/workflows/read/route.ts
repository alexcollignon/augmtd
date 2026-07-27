// ─── POST /api/notifications/workflows/read — mark notifications as seen ──────
// Body: { workflow_id?, ids? } — scope to one workflow's notifications, or to
// specific notification ids; with neither, marks all (legacy bulk behavior —
// the team home no longer uses it: seen flips per-open now, so unread-first
// grouping and the auto-pause review signal stay honest).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const workflowId = body.workflow_id as string | undefined;
  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 100)
    : undefined;

  let query = supabase
    .from('workflow_notifications')
    .update({ seen: true })
    .eq('user_id', user.id)
    .eq('seen', false);

  if (workflowId) query = query.eq('workflow_id', workflowId);
  else if (ids?.length) query = query.in('id', ids);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
