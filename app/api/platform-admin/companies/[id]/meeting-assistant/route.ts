import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';

// PATCH /api/platform-admin/companies/[id]/meeting-assistant
// Toggles meeting assistant for a company and bulk-updates all active members.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { enabled } = await request.json();
  if (typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Merge into existing settings JSONB
  const { data: company } = await adminClient
    .from('companies')
    .select('settings')
    .eq('id', id)
    .single();

  const newSettings = { ...(company?.settings ?? {}), meeting_assistant: enabled };
  await adminClient.from('companies').update({ settings: newSettings }).eq('id', id);

  // Bulk-update all active members
  const { data: members } = await adminClient
    .from('company_members')
    .select('user_id')
    .eq('company_id', id)
    .eq('status', 'active');

  if (members && members.length > 0) {
    const userIds = members.map((m: any) => m.user_id);
    await adminClient.from('profiles').update({ attendee_enabled: enabled }).in('id', userIds);
  }

  return NextResponse.json({ ok: true, enabled });
}
