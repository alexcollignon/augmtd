import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Per-user preference: also deliver coworker report-backs as a real Slack DM.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ enabled: false });
  const { data } = await supabase.from('profiles').select('slack_dm_reports').eq('id', user.id).maybeSingle();
  return NextResponse.json({ enabled: Boolean((data as { slack_dm_reports?: boolean } | null)?.slack_dm_reports) });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const enabled = Boolean(body.enabled);
  const { error } = await supabase.from('profiles').update({ slack_dm_reports: enabled }).eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, enabled });
}
