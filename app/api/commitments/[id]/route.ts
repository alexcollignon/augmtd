import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';

// GET /api/commitments/[id] — one commitment + its SOURCE CONTEXT, RLS-safe (cookie client). Powers
// the Home commitment deep-dive: the description / counterparty / due date, plus enough of what it
// was extracted FROM (the email subject + snippet, or the meeting title) so the user sees what it's
// about without leaving. Non-fatal: source context is best-effort — a commitment always resolves.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { data: c } = await supabase
      .from('commitments')
      .select('id, direction, description, counterparty, due_date, source, source_id, thread_id, status, created_at')
      .eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Best-effort source context — the email it came from (subject + snippet) or the meeting title.
    let sourceKind: 'email' | 'meeting' | null = null;
    let sourceSubject: string | null = null;
    let sourceSnippet: string | null = null;
    let sourceFrom: string | null = null;
    let sourceWhen: string | null = null;
    try {
      if (c.source === 'email' && c.source_id) {
        const { data: email } = await supabase
          .from('emails')
          .select('subject, body, from_name, from_address, received_at')
          .eq('id', c.source_id).eq('user_id', user.id).maybeSingle();
        if (email) {
          sourceKind = 'email';
          sourceSubject = (email.subject as string) || null;
          sourceSnippet = typeof email.body === 'string' ? (email.body as string).replace(/\s+/g, ' ').trim().slice(0, 600) : null;
          sourceFrom = (email.from_name as string) || (email.from_address as string) || null;
          sourceWhen = (email.received_at as string) || null;
        }
      } else if (c.source === 'meeting' && c.source_id) {
        const { data: mt } = await supabase
          .from('meeting_transcripts')
          .select('title, start_time, summary')
          .eq('id', c.source_id).eq('user_id', user.id).maybeSingle();
        if (mt) {
          sourceKind = 'meeting';
          sourceSubject = (mt.title as string) || 'Meeting';
          sourceSnippet = typeof mt.summary === 'string' ? (mt.summary as string).replace(/\s+/g, ' ').trim().slice(0, 600) : null;
          sourceWhen = (mt.start_time as string) || null;
        }
      }
    } catch { /* non-fatal — the commitment fields alone are enough */ }

    return NextResponse.json({
      id: c.id,
      direction: c.direction,
      description: c.description,
      counterparty: c.counterparty ?? null,
      dueDate: c.due_date ?? null,
      source: c.source ?? null,
      threadId: c.thread_id ?? null,
      status: c.status,
      createdAt: c.created_at ?? null,
      sourceContext: sourceKind ? { kind: sourceKind, subject: sourceSubject, snippet: sourceSnippet, from: sourceFrom, when: sourceWhen } : null,
    });
  } catch (error) {
    console.error('Commitment fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/commitments/[id] — set a commitment's status (done | dismissed) for the user's own
// commitment. Powers the Home's per-item Done/Dismiss on On-your-plate + Ball-in-your-court.
// `done` = fulfilled/handled; `dismissed` = not pursuing. Both drop it from the Home (the brief
// reads only status='open') and never resurface it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { status } = await request.json();
    if (status !== 'done' && status !== 'dismissed') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Load the description first (for a readable activity title) — cheap, owner-scoped.
    const { data: commitment } = await supabase
      .from('commitments')
      .select('description')
      .eq('id', id).eq('user_id', user.id).maybeSingle();

    const { error } = await supabase
      .from('commitments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Clean up any inbox item the aging sweep surfaced for this commitment — it's handled now.
    await supabase.from('inbox_items').delete()
      .eq('user_id', user.id).eq('source', 'commitment').eq('source_id', id);

    // Activity timeline (non-fatal).
    const desc = (commitment?.description && String(commitment.description).trim()) || 'a commitment';
    await logActivity(supabase, user.id, {
      type: status === 'done' ? 'commitment_done' : 'commitment_dismissed',
      title: `${status === 'done' ? 'Completed' : 'Dismissed'} commitment: ${desc}`,
      entityType: 'commitment',
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Commitment status update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
