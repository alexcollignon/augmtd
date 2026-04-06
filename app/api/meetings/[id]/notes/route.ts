import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * PATCH /api/meetings/[id]/notes
 * Body: { document: string } — saves edited document into notes_structured.document
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

  const body = await req.json() as { document?: string; notes_structured?: Record<string, any> };

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

  // Build the update
  let newStructured: Record<string, any>;
  if (typeof body.document === 'string') {
    // Merge document field into existing notes_structured
    newStructured = { ...existingStructured, document: body.document };
  } else if (body.notes_structured) {
    newStructured = body.notes_structured;
  } else {
    return NextResponse.json({ error: 'document or notes_structured is required' }, { status: 400 });
  }

  await adminClient
    .from('meeting_transcripts')
    .update({ notes_structured: newStructured })
    .eq('id', transcriptId)
    .eq('user_id', user.id);

  return NextResponse.json({ success: true });
}
