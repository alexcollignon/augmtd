import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// POST /api/notifications/processes/read — mark notifications as read
// Body: { process_id? } — if provided, marks only that process; otherwise marks all
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const processId = body.process_id as string | undefined;

  // Use adminClient — RLS UPDATE policy only allows users to update their own rows,
  // but the supabase server client has the user's JWT, so regular client works here.
  let query = supabase
    .from('process_notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('read', false);

  if (processId) {
    query = query.eq('process_id', processId);
  }

  await query;

  return NextResponse.json({ ok: true });
}
