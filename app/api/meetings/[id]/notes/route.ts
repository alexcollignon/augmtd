import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * PATCH /api/meetings/[id]/notes
 * Body: { document: string } — saves edited document into notes_structured.document
 * Body: { document?: string, action_items?: Array<{text, assignee?, due_date?}> } — AI edit path
 * Legacy body: { notes_structured: object } — direct notes_structured override
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    document?: string;
    notes_structured?: Record<string, any>;
    action_items?: Array<{ text: string; assignee?: string; due_date?: string }>;
  };

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Resolve transcript — by calendar_event_id first, then direct id
  let transcriptId: string | null = null;
  let existingStructured: Record<string, any> = {};

  const { data: byEvent } = await adminClient
    .from('meeting_transcripts')
    .select('id, notes_structured')
    .eq('calendar_event_id', eventId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byEvent) {
    transcriptId = byEvent.id;
    existingStructured = (byEvent.notes_structured as Record<string, any>) ?? {};
  } else {
    const { data: byId } = await adminClient
      .from('meeting_transcripts')
      .select('id, notes_structured')
      .eq('id', eventId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (byId) {
      transcriptId = byId.id;
      existingStructured = (byId.notes_structured as Record<string, any>) ?? {};
    }
  }

  if (!transcriptId) return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });

  // Build the notes_structured update
  if (typeof body.document === 'string' || body.notes_structured || body.action_items) {
    let newStructured: Record<string, any> | undefined;
    if (typeof body.document === 'string') {
      newStructured = { ...existingStructured, document: body.document };
    } else if (body.notes_structured) {
      newStructured = body.notes_structured;
    }

    if (newStructured !== undefined) {
      await adminClient
        .from('meeting_transcripts')
        .update({ notes_structured: newStructured })
        .eq('id', transcriptId)
        .eq('user_id', user.id);
    }

    // Replace action items (inbox_items rows) for this transcript
    if (body.action_items !== undefined) {
      await adminClient
        .from('inbox_items')
        .delete()
        .eq('transcript_id', transcriptId)
        .eq('user_id', user.id);

      if (body.action_items.length > 0) {
        const rows = body.action_items.map((item) => ({
          user_id: user.id,
          transcript_id: transcriptId,
          title: item.text,
          work_title: item.text,
          assignee: item.assignee ?? null,
          due_date: item.due_date ?? null,
          status: 'pending',
          cognitive_cost: 'action_required',
          source: 'meeting',
        }));
        await adminClient.from('inbox_items').insert(rows);
      }
    }
  } else {
    return NextResponse.json({ error: 'document, notes_structured, or action_items is required' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
