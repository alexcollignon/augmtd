// THE PENDING LIST (stabilization W0.3b) — what awaits the user's click, newest first. A change
// prepared on a lane with no visible thread (a delegated run's coworker step) has no card of its
// own yet; this door is where it can still be found. GET only, user-scoped, zero AI.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listPendingChanges } from '@/lib/work/pending-change';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const changes = await listPendingChanges(supabase, user.id);
  return NextResponse.json({ changes });
}
