import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeError } from '@/lib/utils/api-error';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: transcriptId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { folderId } = await req.json();

  const { error } = await supabase
    .from('meeting_transcripts')
    .update({ folder_id: folderId ?? null })
    .eq('id', transcriptId)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  return NextResponse.json({ success: true });
}
