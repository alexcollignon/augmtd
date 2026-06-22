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

    const { to, cc, subject, body, agentId, draftId } = await req.json();

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

    // Persist the "sent" state on the draft in its message metadata so reload shows it sent.
    if (draftId) {
      const { data: msgs } = await admin.from('work_messages')
        .select('id, metadata').eq('thread_id', threadId)
        .order('created_at', { ascending: false }).limit(25);
      for (const m of (msgs ?? []) as Array<{ id: string; metadata: { email_drafts?: Array<{ id?: string; sent_at?: string }> } | null }>) {
        const drafts = m.metadata?.email_drafts;
        if (!Array.isArray(drafts)) continue;
        const i = drafts.findIndex(d => d.id === draftId);
        if (i >= 0) {
          drafts[i] = { ...drafts[i], sent_at: new Date().toISOString() };
          await admin.from('work_messages').update({ metadata: { ...m.metadata, email_drafts: drafts } }).eq('id', m.id);
          break;
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[send-coworker-email] error:', err);
    return NextResponse.json({ error: 'Failed to send.' }, { status: 500 });
  }
}
