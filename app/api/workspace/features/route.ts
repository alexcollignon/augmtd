import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWorkspaceFeatures } from '@/lib/workspace/features';

// GET /api/workspace/features — the current user's workspace feature flags.
// Used by the studio builder to disable steps whose feature is off.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const features = await getWorkspaceFeatures(user.id, supabase);
    return NextResponse.json({ features });
  } catch (err) {
    console.error('[workspace/features] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
