import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { sendCoworkerEmail } from '@/lib/tools';

// User-confirmed send of a coworker email draft (Resend, from the coworker's own address).
// The model NEVER hits this — it only drafts (compose_email); the user reviews/edits the
// card and clicks Send, which lands here. Distinct from /send-email (connected Gmail/Outlook).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: threadId } = await params;
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { to, cc, subject, body, agentId } = await req.json();

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Thread must belong to the user.
    const { data: thread } = await admin.from('work_threads').select('user_id').eq('id', threadId).maybeSingle();
    if (!thread || thread.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // The sending coworker must belong to the user.
    if (agentId) {
      const { data: agent } = await admin.from('custom_agents').select('id').eq('id', agentId).eq('user_id', user.id).maybeSingle();
      if (!agent) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const res = await sendCoworkerEmail(admin, user.id, agentId, {
      to: Array.isArray(to) ? to : [],
      cc: Array.isArray(cc) ? cc : [],
      subject: String(subject ?? ''),
      body: String(body ?? ''),
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[send-coworker-email] error:', err);
    return NextResponse.json({ error: 'Failed to send.' }, { status: 500 });
  }
}
