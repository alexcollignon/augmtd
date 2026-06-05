import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderAllProfiles } from '@/lib/context/render-memory';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: allRows, error } = await adminSupabase
    .from('context_profiles')
    .select('user_id, rendered_at, last_updated');

  if (error) {
    console.error('[RenderMemoryCron] Failed to fetch profiles:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const staleUserIds = [...new Set(
    (allRows ?? [])
      .filter(r => !r.rendered_at || new Date(r.last_updated) > new Date(r.rendered_at))
      .map(r => r.user_id)
  )];

  if (staleUserIds.length === 0) {
    return NextResponse.json({ rendered: 0 });
  }

  console.log(`[RenderMemoryCron] Rendering memory for ${staleUserIds.length} user(s)`);

  const results = await Promise.allSettled(
    staleUserIds.map(async (userId) => {
      await renderAllProfiles(userId, adminSupabase);
      console.log(`[RenderMemoryCron] ✓ ${userId.slice(0, 8)}`);
    }),
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log(`[RenderMemoryCron] Done — ${succeeded} ok, ${failed} failed`);

  return NextResponse.json({ succeeded, failed });
}
