import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { invalidateTenantConfig } from '@/lib/ai/factory';

// GET /api/settings/tier — returns current tier for the user
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('tenant_configs')
    .select('tier')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ tier: data?.tier ?? 'standard' });
}

// POST /api/settings/tier — switches between 'standard' and 'private_shared'
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { tier } = await request.json();
  if (tier !== 'standard' && tier !== 'private_shared' && tier !== 'bedrock_private') {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
  }

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (tier === 'standard') {
    // Remove row → falls back to standard (default)
    await adminClient.from('tenant_configs').delete().eq('user_id', user.id);
  } else {
    await adminClient.from('tenant_configs').upsert(
      { user_id: user.id, tier },
      { onConflict: 'user_id' }
    );
  }

  invalidateTenantConfig(user.id);

  return NextResponse.json({ tier });
}
