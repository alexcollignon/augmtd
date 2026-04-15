// ─── GET /api/notifications/workflows — unseen workflow notifications + count ─

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ count: 0, items: [] });

  const { data, error } = await supabase
    .from('workflow_notifications')
    .select('id, workflow_id, workflow_run_id, title, summary, seen, created_at')
    .eq('user_id', user.id)
    .eq('seen', false)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ count: 0, items: [], error: error.message });
  return NextResponse.json({ count: data?.length ?? 0, items: data ?? [] });
}
