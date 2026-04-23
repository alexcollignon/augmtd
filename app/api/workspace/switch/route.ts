import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { setActiveWorkspaceCookie } from '@/lib/workspace/active-workspace';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { workspace_id } = await request.json();
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  // Verify the user is actually a member of that workspace
  const { data: membership } = await supabase
    .from('company_members')
    .select('id')
    .eq('user_id', user.id)
    .eq('company_id', workspace_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Not a member of that workspace' }, { status: 403 });

  const res = NextResponse.json({ ok: true });
  setActiveWorkspaceCookie(res, workspace_id);
  return res;
}
