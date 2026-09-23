import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Per-user Drafting + Todo Capture preferences (the Email tab toggles).
const DEFAULTS = {
  auto_draft: true,      // draft replies in the user's voice
  auto_label: false,     // W10: AUGMTD's own posture labels in Gmail/Outlook — OFF unless explicitly chosen
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
  // W10 — store ONLY what the user chose (existing choices + this change), never the defaults: the
  // old merge wrote every default into the row, so one toggle of ANY setting silently recorded
  // `auto_label: true` as if the user had chosen it. Unset must stay unset so the default can speak.
  const ALLOWED = new Set(Object.keys(DEFAULTS));
  const patch = Object.fromEntries(Object.entries((body ?? {}) as Record<string, unknown>).filter(([k]) => ALLOWED.has(k)));
  const stored = { ...((existing?.email_settings as object) ?? {}), ...patch };
  const { error: upErr } = await supabase.from('profiles').update({ email_settings: stored }).eq('id', user.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ settings: { ...DEFAULTS, ...stored } });
}
