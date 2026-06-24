import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Per-user Drafting + Todo Capture preferences (the Email tab toggles).
const DEFAULTS = {
  auto_draft: true,      // draft replies in the user's voice
  auto_label: true,      // write triage labels back to Gmail/Outlook (default-on, opt-out)
  cc_bcc_new: false,     // allow new CC/BCC recipients in auto-drafts
  todo_auto: true,       // capture commitments
  todo_internal: false,  // include internal-org todos
  todo_others: false,    // capture other people's todos (accountability)
  todo_instructions: '', // custom extraction guidance
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase.from('profiles').select('email_settings').eq('id', user.id).maybeSingle();
  return NextResponse.json({ settings: { ...DEFAULTS, ...((data?.email_settings as object) ?? {}) } });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { data: existing } = await supabase.from('profiles').select('email_settings').eq('id', user.id).maybeSingle();
  const merged = { ...DEFAULTS, ...((existing?.email_settings as object) ?? {}), ...body };
  const { error: upErr } = await supabase.from('profiles').update({ email_settings: merged }).eq('id', user.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ settings: merged });
}
