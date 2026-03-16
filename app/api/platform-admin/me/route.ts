import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/platform-admin/me — returns { isSuperAdmin } for sidebar
// Always returns 200 (never 401) so the sidebar fetch never errors
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ isSuperAdmin: false });

  const { data } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  return NextResponse.json({ isSuperAdmin: data?.is_super_admin === true });
}
