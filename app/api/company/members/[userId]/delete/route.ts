import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyCompany } from '@/lib/company/get-my-company';
import { deleteUserFully } from '@/lib/workspace/cascade-delete';

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

  try {
    await deleteUserFully(adminClient, targetUserId);
  } catch (err) {
    console.error('[DeleteAccount] Full delete failed:', err);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }

  console.log(`[DeleteAccount] Owner ${user.id} deleted member ${targetUserId} from company ${company.id}`);
  return NextResponse.json({ ok: true });
}
