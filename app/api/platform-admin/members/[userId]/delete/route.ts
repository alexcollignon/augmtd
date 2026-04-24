import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { deleteUserFully } from '@/lib/workspace/cascade-delete';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify caller is super admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_super_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId: targetUserId } = await params;

  if (targetUserId === user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    await deleteUserFully(adminClient, targetUserId);
  } catch (err) {
    console.error('[SuperAdminDelete] Full delete failed:', err);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }

  console.log(`[SuperAdminDelete] Super admin ${user.id} deleted user ${targetUserId}`);
  return NextResponse.json({ ok: true });
}
