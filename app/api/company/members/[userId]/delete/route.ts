import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });
  if (company.role !== 'owner') return NextResponse.json({ error: 'Only owners can delete accounts' }, { status: 403 });

  const { userId: targetUserId } = await params;

  if (targetUserId === user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify target is a non-owner member of the same company
  const { data: target } = await adminClient
    .from('company_members')
    .select('role')
    .eq('company_id', company.id)
    .eq('user_id', targetUserId)
    .eq('status', 'active')
    .maybeSingle();

  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (target.role === 'owner') return NextResponse.json({ error: 'Cannot delete another owner' }, { status: 400 });

  // Delete storage files via the Storage API (direct SQL deletion is blocked by Supabase)
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
  } catch (storageErr) {
    console.error('[DeleteAccount] Storage cleanup failed (non-fatal):', storageErr);
  }

  // Wipe all user data via the SQL function
  const { error: rpcError } = await adminClient.rpc('delete_user_account', {
    target_user_id: targetUserId,
  });

  if (rpcError) {
    console.error('[DeleteAccount] RPC error:', rpcError);
    return NextResponse.json({ error: 'Failed to delete user data' }, { status: 500 });
  }

  // Remove from auth.users
  const { error: authError } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (authError) {
    console.error('[DeleteAccount] Auth delete error:', authError);
    return NextResponse.json({ error: 'Failed to delete auth account' }, { status: 500 });
  }

  console.log(`[DeleteAccount] Owner ${user.id} deleted member ${targetUserId} from company ${company.id}`);
  return NextResponse.json({ ok: true });
}
