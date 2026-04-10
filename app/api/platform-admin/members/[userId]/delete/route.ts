import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

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

  // Delete storage files
  try {
    const { data: storageObjects } = await adminClient.rpc('get_user_storage_objects', {
      target_user_id: targetUserId,
    }) as { data: { bucket_id: string; name: string }[] | null };

    if (storageObjects && storageObjects.length > 0) {
      const byBucket = storageObjects.reduce<Record<string, string[]>>((acc, obj) => {
        if (!acc[obj.bucket_id]) acc[obj.bucket_id] = [];
        acc[obj.bucket_id].push(obj.name);
        return acc;
      }, {});

      await Promise.all(
        Object.entries(byBucket).map(([bucket, paths]) =>
          adminClient.storage.from(bucket).remove(paths)
        )
      );
    }
  } catch (err) {
    console.error('[SuperAdminDelete] Storage cleanup failed (non-fatal):', err);
  }

  // Wipe all user data
  const { error: rpcError } = await adminClient.rpc('delete_user_account', {
    target_user_id: targetUserId,
  });

  if (rpcError) {
    console.error('[SuperAdminDelete] RPC error:', rpcError);
    return NextResponse.json({ error: 'Failed to delete user data' }, { status: 500 });
  }

  // Remove from auth.users
  const { error: authError } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (authError) {
    console.error('[SuperAdminDelete] Auth delete error:', authError);
    return NextResponse.json({ error: 'Failed to delete auth account' }, { status: 500 });
  }

  console.log(`[SuperAdminDelete] Super admin ${user.id} deleted user ${targetUserId}`);
  return NextResponse.json({ ok: true });
}
