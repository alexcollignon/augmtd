import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ pictureUrl: null });

  // Return picture from the first connection that has one
  const { data: connections } = await supabase
    .from('connections')
    .select('metadata')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  const pictureUrl = connections
    ?.map((c) => c.metadata?.picture)
    .find((p) => typeof p === 'string' && p.length > 0) ?? null;

  return NextResponse.json({ pictureUrl });
}
