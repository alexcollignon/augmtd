import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { sanitizeError } from '@/lib/utils/api-error';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: transcriptId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { folderId } = await req.json();

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Determine if caller is the owner or a recipient
  const { data: transcript } = await adminClient
    .from('meeting_transcripts')
    .select('user_id, sharing_mode, company_id')
    .eq('id', transcriptId)
    .single();

  if (!transcript) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (transcript.user_id === user.id) {
    // Owner: update the transcript's own folder_id
    const { error } = await adminClient
      .from('meeting_transcripts')
      .update({ folder_id: folderId ?? null })
      .eq('id', transcriptId);
    if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // Recipient: verify company membership then upsert shared_note_receipts
  if (transcript.sharing_mode === 'live' && transcript.company_id) {
    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('company_id', transcript.company_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { error } = await adminClient
      .from('shared_note_receipts')
      .upsert(
        { transcript_id: transcriptId, user_id: user.id, folder_id: folderId ?? null },
        { onConflict: 'transcript_id,user_id' },
      );
    if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
