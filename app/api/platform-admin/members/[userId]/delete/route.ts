import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { deleteUserFully, removeUserFromWorkspace } from '@/lib/workspace/cascade-delete';

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

  // Optional: workspaceId signals "remove from this workspace only" intent.
  // Without it (e.g. from All Users tab), intent is full account deletion.
  const body = await _request.json().catch(() => ({}));
  const workspaceId: string | null = body?.workspaceId ?? null;

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Fetch memberships to determine if user belongs to other workspaces.
  const { data: allMemberships } = await adminClient
    .from('company_members')
    .select('id, company_id')
    .eq('user_id', targetUserId)
    .eq('status', 'active');

  const otherWorkspaceMemberships = workspaceId
    ? (allMemberships ?? []).filter(m => m.company_id !== workspaceId)
    : [];

  const hasOtherWorkspaces = otherWorkspaceMemberships.length > 0;

  if (workspaceId && hasOtherWorkspaces) {
    // User still belongs to other workspaces — only remove this membership.
    await removeUserFromWorkspace(adminClient, targetUserId, workspaceId);
    console.log(`[SuperAdminDelete] Removed user ${targetUserId} from workspace ${workspaceId} (kept account — has other workspaces)`);
    return NextResponse.json({ ok: true, removedOnly: true });
  }

  // No other workspaces — safe to fully wipe the account.
  try {
    await deleteUserFully(adminClient, targetUserId);
  } catch (err) {
    console.error('[SuperAdminDelete] Full delete failed:', err);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }

  console.log(`[SuperAdminDelete] Super admin ${user.id} deleted user ${targetUserId}`);
  return NextResponse.json({ ok: true });
}
