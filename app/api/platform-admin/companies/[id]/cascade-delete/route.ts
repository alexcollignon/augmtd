import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { cascadeDeleteWorkspace } from '@/lib/workspace/cascade-delete';

// 5 minutes — enough for ~600 members at 500ms each. Larger workspaces should
// move to a background queue (not in scope v1).
export const maxDuration = 300;

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/platform-admin/companies/[id]/cascade-delete
// Body: { confirmName: string } — must match workspaces.name exactly.
//
// Destructive: iterates all members, hard-deletes each non-superadmin user
// (storage + DB via delete_user_account RPC + auth.users), then drops the
// workspace row (cascades invitations + remaining member rows).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { confirmName } = await request.json() as { confirmName?: string };
  if (!confirmName?.trim()) {
    return NextResponse.json({ error: 'confirmName required' }, { status: 400 });
  }

  const adminClient = await getAdminClient();

  // Verify the typed name matches exactly (case-sensitive, trimmed)
  const { data: workspace } = await adminClient
    .from('companies')
    .select('id, name, type, status')
    .eq('id', id)
    .maybeSingle();

  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  if (workspace.name.trim() !== confirmName.trim()) {
    return NextResponse.json({ error: 'Name confirmation did not match' }, { status: 400 });
  }
  if (workspace.status === 'deleting') {
    return NextResponse.json({ error: 'Workspace is already being deleted' }, { status: 409 });
  }

  try {
    const result = await cascadeDeleteWorkspace({
      adminClient,
      workspaceId: id,
      actorUserId: user.id,
      actorEmail: user.email,
    });
    return NextResponse.json({
      ok: true,
      workspaceName: workspace.name,
      ...result,
    });
  } catch (err) {
    console.error('[cascade-delete] error:', err);
    const message = err instanceof Error ? err.message : 'Cascade delete failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
