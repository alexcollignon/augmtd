import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: transcriptId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: transcript } = await adminClient
    .from('meeting_transcripts')
    .select('id, recording_storage_path')
    .eq('id', transcriptId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!transcript) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Delete linked inbox items (fetch IDs first to clean desk_items)
  const { data: deletedInboxItems } = await adminClient
    .from('inbox_items')
    .delete()
    .eq('user_id', user.id)
    .eq('source_meeting_transcript_id', transcriptId)
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

  // Delete storage file if present
  if (transcript.recording_storage_path) {
    await adminClient.storage
      .from('meeting-recordings')
      .remove([transcript.recording_storage_path]);
  }

  // Delete the transcript row
  await adminClient
    .from('meeting_transcripts')
    .delete()
    .eq('id', transcriptId)
    .eq('user_id', user.id);

  return NextResponse.json({ success: true });
}
