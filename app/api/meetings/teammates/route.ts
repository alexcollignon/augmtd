import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

// GET /api/meetings/teammates
// Returns active company members (excluding caller) for the share-with picker.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!membership) return NextResponse.json({ teammates: [] });

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: members } = await adminClient
    .from('company_members')
    .select('user_id')
    .eq('company_id', membership.company_id)
    .eq('status', 'active')
    .neq('user_id', user.id);

  const userIds = (members ?? []).map((m: any) => m.user_id);
  if (userIds.length === 0) return NextResponse.json({ teammates: [] });

  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  const teammates = userIds
    .map((uid: string) => {
      const p = profileMap.get(uid);
      return {
        userId: uid,
        name: p?.full_name ?? p?.email ?? 'Teammate',
        email: p?.email ?? '',
      };
    })
    .filter((t: any) => t.userId);

  return NextResponse.json({ teammates });
}
