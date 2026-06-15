import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/workers — list the user's workers (custom_agents where is_worker = true)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('custom_agents')
    .select('id, name, description, color, icon, worker_role, is_enabled, conversation_starters')
    .eq('user_id', user.id)
    .eq('is_worker', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workers: data ?? [] });
}
