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
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[ReEnhance] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Re-enhance failed' }, { status: 500 });
  }
}
