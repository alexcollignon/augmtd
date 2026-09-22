import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
// ONE CALENDAR WRITE PATH (Wave 2, Sep 22) — see lib/calendar/event-writes.ts. The load/token/
// refresh/provider-branch block these two handlers each carried is now shared with the RSVP route
// and the event card's deeds door. Behaviour unchanged.
import {
  loadEventWriteTarget, isWriteTargetError, applyEventUpdate, applyCancel,
} from '@/lib/calendar/event-writes';

const targetError = (error: 'event_not_found' | 'connection_not_found' | 'no_tokens') =>
  error === 'event_not_found' ? 'Event not found' : error === 'connection_not_found' ? 'Connection not found' : 'No tokens';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const target = await loadEventWriteTarget(supabase, user.id, id);
    if (isWriteTargetError(target)) {
      return NextResponse.json({ error: targetError(target.error) }, { status: target.status });
    }

    try {
      await applyCancel(target);
    } catch (err: any) {
      if (err?.code === 'calendar_scope_required') {
        return NextResponse.json({ error: 'calendar_scope_required', provider: target.provider }, { status: 403 });
      }
      throw err;
    }

    await supabase.from('calendar_events').delete().eq('id', id).eq('user_id', user.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[meetings/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete meeting' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { title, startTime, endTime, timezone, attendees, notes } = body as {
      title: string;
      startTime: string;
      endTime: string;
      timezone: string;
      attendees: string[];
      notes?: string;
    };

    if (!title || !startTime || !endTime || !timezone || !attendees?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validAttendees = attendees.filter((a: string) => a.includes('@'));
    if (validAttendees.length === 0) {
      return NextResponse.json({ error: 'No valid attendee email addresses' }, { status: 400 });
    }

    const target = await loadEventWriteTarget(supabase, user.id, id);
    if (isWriteTargetError(target)) {
      return NextResponse.json({ error: targetError(target.error) }, { status: target.status });
    }

    try {
      await applyEventUpdate(target, {
        title, startISO: startTime, endISO: endTime, timezone, attendees: validAttendees, notes,
      });
    } catch (err: any) {
      if (err?.code === 'calendar_scope_required') {
        return NextResponse.json({ error: 'calendar_scope_required', provider: target.provider }, { status: 403 });
      }
      throw err;
    }

    // Update local cache
    await supabase.from('calendar_events').update({
      title,
      start_time: startTime,
      end_time: endTime,
      attendees: validAttendees.map((email: string) => ({ email, responseStatus: 'needsAction' })),
    }).eq('id', id).eq('user_id', user.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[meetings/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update meeting' }, { status: 500 });
  }
}
