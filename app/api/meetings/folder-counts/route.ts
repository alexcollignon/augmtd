import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('calendar_events')
    .select('folder_id')
    .eq('user_id', user.id);

  const counts: Record<string, number> = {};
  let unorganised = 0;
  for (const row of data ?? []) {
    if (row.folder_id) {
      counts[row.folder_id] = (counts[row.folder_id] ?? 0) + 1;
    } else {
      unorganised++;
    }
  }

  return NextResponse.json({ counts, unorganised });
}
