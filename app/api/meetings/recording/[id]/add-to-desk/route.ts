import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: transcriptId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: transcript } = await supabase
    .from('meeting_transcripts')
    .select('id, summary, work_items_generated, suggested_next_step, title')
    .eq('id', transcriptId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!transcript) return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });

  const count = (transcript.work_items_generated as number) ?? 0;
  const urgency = count >= 3 ? 'high' : count >= 1 ? 'medium' : 'low';
  const title = transcript.suggested_next_step
    ? (transcript.suggested_next_step as string).slice(0, 120)
    : `Review: ${(transcript.title as string) ?? 'Meeting'}`;

  const { error } = await supabase
    .from('desk_items')
    .upsert({
      user_id: user.id,
      source_type: 'meeting_action',
      source_id: transcriptId,
      thread_key: null,
      source_refs: [{ type: 'meeting_action', id: transcriptId }],
      kanban_column: 'pool',
      position: 0,
      title,
      description: transcript.summary ? (transcript.summary as string).slice(0, 200) : null,
      source_url: `/meetings/recording/${transcriptId}`,
      urgency,
      email_count: 1,
      has_prepared: false,
      synthesis: null,
      synthesis_at: null,
    }, { onConflict: 'user_id,source_type,source_id', ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
