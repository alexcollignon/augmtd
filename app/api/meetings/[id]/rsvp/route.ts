import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
// ONE CALENDAR WRITE PATH (Wave 2, Sep 22): the load-connection / read-tokens / refresh-callback /
// provider-branch block this route used to carry inline now lives in lib/calendar/event-writes.ts,
// shared with the meeting PATCH/DELETE route and the event card's deeds door. Behaviour unchanged.
import {
  loadEventWriteTarget, isWriteTargetError, applyRsvp, attendeesWithResponse,
} from '@/lib/calendar/event-writes';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { response } = body as { response: 'accepted' | 'tentative' | 'declined' };
    if (!['accepted', 'tentative', 'declined'].includes(response)) {
      return NextResponse.json({ error: 'Invalid response value' }, { status: 400 });
    }

    const target = await loadEventWriteTarget(supabase, user.id, id);
    if (isWriteTargetError(target)) {
      const message = target.error === 'event_not_found' ? 'Calendar event not found'
        : target.error === 'connection_not_found' ? 'Connection not found' : 'No tokens found for connection';
      return NextResponse.json({ error: message }, { status: target.status });
    }

    try {
      await applyRsvp(target, response);
    } catch (err: any) {
      if (err?.code === 'calendar_scope_required') {
        return NextResponse.json({ error: 'calendar_scope_required', provider: target.provider }, { status: 403 });
      }
      throw err;
    }

    // Update attendees in DB to reflect the new response status.
    await supabase
      .from('calendar_events')
      .update({ attendees: attendeesWithResponse(target.row, target.selfEmail, response) })
      .eq('id', id);

    // Auto-complete any pending calendar invite inbox items for this event.
    // Invite emails have subjects like "Convite: {title} @..." or "Invitation: {title} @..."
    // Use .filter() for JSONB text extraction — .ilike() doesn't handle ->> operator reliably.
    if (target.row.title) {
      await supabase
        .from('inbox_items')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .filter('source_data->>subject', 'ilike', `%${target.row.title}%`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[meetings/rsvp] POST error:', err);
    return NextResponse.json({ error: 'Failed to update RSVP' }, { status: 500 });
  }
}
