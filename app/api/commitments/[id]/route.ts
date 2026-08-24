import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { after } from 'next/server';
import { noteItemAction } from '@/lib/entities/on-action';

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

    // ── THE GATED WORK (processes arc; owner walk, Aug 20). A source='handoff' commitment is a
    // decision on a parked workflow RUN — which is why the source-context read above finds nothing
    // and the room used to say "no linked source" while asking for a decision about work it never
    // showed. ONE derivation (lib/workflows/handoff-context.ts) serves the ask, who asked, and THE
    // OBJECT (the run's last step output) on THIS payload — the decision card already learns
    // source/sourceId here, so it never makes a second call to know what it is gating.
    //
    // AUTHORIZATION: the row above is the caller's OWN commitment (user-scoped, RLS-safe read).
    // That row IS the entitlement — being handed a handoff gate is exactly the fact
    // `canReadRunRecord` grants its 'holder' role on (a current OR PAST gate holder may read the
    // record of the run they were asked about). The admin client below reads only the run and
    // workflow that this very row points at; nothing else is reachable from it.
    let handoff = null;
    if (c.source === 'handoff' && c.source_id) {
      try {
        const { createClient: createAdmin } = await import('@supabase/supabase-js');
        const admin = createAdmin(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );
        const { handoffContextFor } = await import('@/lib/workflows/handoff-context');
        handoff = await handoffContextFor(admin, {
          userId: user.id,
          source: c.source ?? null,
          sourceId: c.source_id ?? null,
          description: c.description ?? null,
          status: c.status ?? null,
        });
      } catch { /* additive — a gate we can't describe never breaks the room */ }
    }

    return NextResponse.json({
      id: c.id,
      direction: c.direction,
      description: c.description,
      counterparty: c.counterparty ?? null,
      dueDate: c.due_date ?? null,
      source: c.source ?? null,
      // The source's OWN id travels with the source word: a source='handoff' commitment's
      // source_id IS the parked run, and the deep-dive's decision card posts to it (the one
      // /api/workflows/runs/[id]/resume door). Inert for every other source.
      sourceId: c.source_id ?? null,
      // THE GATED WORK — present only on a handoff whose run reads; null everywhere else.
      handoff,
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
    const body = await request.json() as { status?: string; description?: string; due_date?: string | null; priority?: 'high' | 'low' | null; note?: string | null };
    const { status } = body;

    // ── EDIT path (Phase 4 R3a + B4): description / due_date / manual priority — a task is
    // WRITABLE. due_date must be absolute-or-null (never invented); priority is the human OVERRIDE
    // the spine honors permanently. Edits log activity + bust the brief. No status change here.
    if (status === undefined) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.description === 'string' && body.description.trim()) patch.description = body.description.trim().slice(0, 500);
      if ('due_date' in body) {
        const { validDate } = await import('@/lib/commitments/extract');
        patch.due_date = validDate(body.due_date);
      }
      if ('priority' in body) {
        patch.priority = body.priority === 'high' || body.priority === 'low' ? body.priority : null;
      }
      if (Object.keys(patch).length === 1) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
      const { error: uerr } = await supabase.from('commitments').update(patch).eq('id', id).eq('user_id', user.id);
      if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 });
      import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});
      after(async () => {
        try { await logActivity(supabase, user.id, { type: 'task_edited', title: `Edited: ${String(patch.description ?? 'task due date').slice(0, 60)}`, entityType: 'commitment', entityId: id, metadata: {} }); } catch { /* non-fatal */ }
      });
      return NextResponse.json({ ok: true });
    }

    // B4: the human marks a task as actively WORKED ('in_progress', from open/pending only).
    if (status === 'in_progress') {
      const { data: cur } = await supabase.from('commitments').select('status').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!cur || (cur.status !== 'open' && cur.status !== 'pending')) return NextResponse.json({ error: 'only an open task can move to in progress' }, { status: 400 });
      const { error: perr } = await supabase.from('commitments').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
      if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
      import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    // B2 (workbench): ACCEPT — a meeting-proposed task (status 'suggested') becomes real work. The
    // accept is the trust ritual and a learning signal. B4: un-marking an in-progress task also
    // returns it to open (the cycle's reverse) — no signal for that.
    if (status === 'open') {
      const { data: cur } = await supabase.from('commitments').select('description, status').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!cur) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (cur.status === 'in_progress') {
        const { error: rerr } = await supabase.from('commitments').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
        if (rerr) return NextResponse.json({ error: rerr.message }, { status: 500 });
        import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      if (cur.status !== 'suggested') return NextResponse.json({ error: 'only a suggested task can be accepted' }, { status: 400 });
      const { error: aerr } = await supabase.from('commitments').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
      if (aerr) return NextResponse.json({ error: aerr.message }, { status: 500 });
      import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(supabase, user.id)).catch(() => {});
      after(async () => {
        try {
          await logActivity(supabase, user.id, { type: 'task_accepted', title: `Accepted: ${String(cur.description).slice(0, 60)}`, entityType: 'commitment', entityId: id, metadata: { via: 'meeting_suggestion' } });
          await supabase.from('learning_signals').insert({ user_id: user.id, signal_type: 'action_taken', inbox_item_id: null, signal_data: { action: 'suggested_task_accepted', commitmentId: id } });
        } catch { /* non-fatal */ }
      });
      return NextResponse.json({ ok: true });
    }

    if (status !== 'done' && status !== 'dismissed') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Load the description first (for a readable activity title) — cheap, owner-scoped.
    const { data: commitment } = await supabase
      .from('commitments')
      .select('description, status')
      .eq('id', id).eq('user_id', user.id).maybeSingle();
    // B2: rejecting a meeting-PROPOSED task is a learning signal (the extractor hears the "no").
    if (status === 'dismissed' && commitment?.status === 'suggested') {
      after(async () => {
        await supabase.from('learning_signals').insert({ user_id: user.id, signal_type: 'action_taken', inbox_item_id: null, signal_data: { action: 'suggested_task_rejected', commitmentId: id } }).then(() => {}, () => {});
      });
    }

    // Stamp resolved_at (the REAL resolution timestamp the Day-cleared ring counts by — the
    // commitments.resolved_at column from migration 20260705d). resolved_at/resolved_reason may not
    // exist on older schemas, so retry status-only if the column-aware update fails.
    const nowIso = new Date().toISOString();
    // D2 (work-surface): an optional user NOTE ("we'll discuss it on Thursday's call") becomes the
    // resolved_reason — a ledger fact the entity's next state synthesis reasons WITH.
    const userNote = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    let error;
    ({ error } = await supabase
      .from('commitments')
      .update({ status, resolved_at: nowIso, resolved_reason: userNote ?? (status === 'done' ? 'user_marked' : 'user_dismissed'), updated_at: nowIso })
      .eq('id', id)
      .eq('user_id', user.id));
    if (error) {
      ({ error } = await supabase
        .from('commitments')
        .update({ status, updated_at: nowIso })
        .eq('id', id)
        .eq('user_id', user.id));
    }
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

    // L2 ACTION EVENT — the brain hears this action (entity re-synthesis + brief-cache bust).
    after(async () => { await noteItemAction(supabase, user.id, { kind: 'commitment', id }).catch(() => {}); });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Commitment status update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
