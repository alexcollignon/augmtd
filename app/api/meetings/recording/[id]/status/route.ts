import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: transcript } = await supabase
    .from('meeting_transcripts')
    .select('bot_state, processed')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    botState: transcript?.bot_state ?? null,
    processed: transcript?.processed ?? false,
  });
}
