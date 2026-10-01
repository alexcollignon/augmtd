import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { reEnhanceTranscript } from '@/lib/integrations/meeting-bot/bot-manager';

/**
 * POST /api/meetings/[id]/re-enhance
 * Re-run AI insight extraction with a different template.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const templateId = body.templateId ?? 'default';

  try {
    const result = await reEnhanceTranscript(user.id, eventId, templateId, supabase);
    // W35 · FAILURE HONESTY: a failed re-run is said (the notes that stood are untouched and the failure
    // is recorded on the transcript for the page and the automatic retry).
    if (result.failed) return NextResponse.json({ success: false, error: 'Notes couldn’t be generated — try again in a moment.' }, { status: 502 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[ReEnhance] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Re-enhance failed' }, { status: 500 });
  }
}
