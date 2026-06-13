import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sharingMode, sharedWithUserIds } = await req.json();

  if (sharingMode !== null && sharingMode !== 'live' && sharingMode !== 'specific') {
    return NextResponse.json({ error: 'Invalid sharingMode' }, { status: 400 });
  }

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Verify ownership
  const { data: transcript } = await adminClient
    .from('meeting_transcripts')
    .select('id, user_id')
    .eq('id', id)
    .single();

  if (!transcript || transcript.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let companyId: string | null = null;
  if (sharingMode === 'live' || sharingMode === 'specific') {
    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: 'No active company membership' }, { status: 400 });
    }
    companyId = membership.company_id;
  }

  // Update sharing_mode and company_id on the transcript
  const { error: updateError } = await adminClient
    .from('meeting_transcripts')
    .update({ sharing_mode: sharingMode, company_id: companyId })
    .eq('id', id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // For 'specific' mode, sync the shared_note_receipts access list
  if (sharingMode === 'specific' && Array.isArray(sharedWithUserIds)) {
    // Delete receipts for users no longer in the list
    await adminClient
      .from('shared_note_receipts')
      .delete()
      .eq('transcript_id', id)
      .not('user_id', 'in', `(${sharedWithUserIds.length > 0 ? sharedWithUserIds.map((u: string) => `'${u}'`).join(',') : "''"})`)
      .neq('user_id', user.id);

    // Upsert receipts for newly added users (preserves existing folder_id)
    if (sharedWithUserIds.length > 0) {
      const upsertRows = sharedWithUserIds.map((uid: string) => ({
        transcript_id: id,
        user_id: uid,
      }));
      await adminClient
        .from('shared_note_receipts')
        .upsert(upsertRows, { onConflict: 'transcript_id,user_id', ignoreDuplicates: true });
    }
  }

  // Fetch current specific recipients to return to client
  const { data: currentReceipts } = await adminClient
    .from('shared_note_receipts')
    .select('user_id')
    .eq('transcript_id', id)
    .neq('user_id', user.id);

  const currentSharedIds = (currentReceipts ?? []).map((r: any) => r.user_id);

  return NextResponse.json({ sharingMode, companyId, sharedWithUserIds: currentSharedIds });
}

// GET /api/meetings/[id]/sharing — fetch current sharing state
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminClient = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: transcript } = await adminClient
    .from('meeting_transcripts')
    .select('sharing_mode, user_id')
    .eq('id', id)
    .single();

  if (!transcript || transcript.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: receipts } = await adminClient
    .from('shared_note_receipts')
    .select('user_id')
    .eq('transcript_id', id)
    .neq('user_id', user.id);

  return NextResponse.json({
    sharingMode: transcript.sharing_mode ?? null,
    sharedWithUserIds: (receipts ?? []).map((r: any) => r.user_id),
  });
}
