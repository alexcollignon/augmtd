import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/platform-admin/audit-logs?workspace_id=&action=&limit=&offset=
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id');
  const action = searchParams.get('action');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const adminClient = await getAdminClient();

  let query = adminClient
    .from('audit_logs')
    .select('id, actor_user_id, actor_email, action, target_type, target_id, workspace_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  if (action) query = query.eq('action', action);

  const { data, error } = await query;
  if (error) {
    console.error('[AuditLogs GET] error:', error);
    return NextResponse.json({ error: 'Failed to load audit logs' }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [] });
}
