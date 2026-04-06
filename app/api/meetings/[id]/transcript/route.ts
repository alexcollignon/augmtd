import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: calendarEventId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch transcript(s) — first by calendar_event_id, fall back to transcript id directly
  let { data: transcripts } = await adminClient
    .from('meeting_transcripts')
    .select('id, recording_storage_path')
    .eq('calendar_event_id', calendarEventId)
    .eq('user_id', user.id);

  if (!transcripts || transcripts.length === 0) {
    const { data: byId } = await adminClient
      .from('meeting_transcripts')
      .select('id, recording_storage_path')
      .eq('id', calendarEventId)
      .eq('user_id', user.id);
    transcripts = byId ?? [];
  }

  if (transcripts && transcripts.length > 0) {
    const transcriptIds = transcripts.map((t) => t.id);

    // Delete linked inbox items (fetch IDs first to clean desk_items)
    const { data: deletedInboxItems } = await adminClient
      .from('inbox_items')
      .delete()
      .eq('user_id', user.id)
      .in('source_meeting_transcript_id', transcriptIds)
      .select('id');

    // Delete linked desk items (meeting_action cards)
    const deletedInboxIds = (deletedInboxItems ?? []).map((r: { id: string }) => r.id);
    if (deletedInboxIds.length > 0) {
      await adminClient
        .from('desk_items')
        .delete()
        .eq('user_id', user.id)
        .eq('source_type', 'meeting_action')
        .in('source_id', deletedInboxIds);
    }

    // Delete storage files for any recordings
    const storagePaths = transcripts
      .map((t) => t.recording_storage_path)
      .filter(Boolean) as string[];

    if (storagePaths.length > 0) {
      await adminClient.storage
        .from('meeting-recordings')
        .remove(storagePaths);
    }

    // Delete the transcript rows
    await adminClient
      .from('meeting_transcripts')
      .delete()
      .eq('user_id', user.id)
      .in('id', transcriptIds);
  }

  return NextResponse.json({ success: true });
}
