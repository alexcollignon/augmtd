import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/meetings/[id]/live-notes
 * Saves live notes to calendar_events.metadata.live_notes (JSONB merge)
 * Used during bot recording so the user can jot notes that guide AI generation.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: calendarEventId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { liveNotes } = await req.json();

  // Read current metadata then merge
  const { data: event } = await supabase
    .from('calendar_events')
    .select('metadata')
    .eq('id', calendarEventId)
    .eq('user_id', user.id)
    .single();

  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const metadata = { ...(event.metadata ?? {}), live_notes: liveNotes ?? '' };

  const { error } = await supabase
    .from('calendar_events')
    .update({ metadata })
    .eq('id', calendarEventId)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
