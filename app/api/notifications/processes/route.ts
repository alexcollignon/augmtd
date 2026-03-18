import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/notifications/processes — unread count for current user
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ count: 0 });

  const { count } = await supabase
    .from('process_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('read', false);

  return NextResponse.json({ count: count ?? 0 });
}
