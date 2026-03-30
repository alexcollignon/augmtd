import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { updateGmailEvent, updateOutlookEvent } from '@/lib/calendar/invite-sender';

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

    // Fetch the calendar event + connection
    const { data: calEvent } = await supabase
      .from('calendar_events')
      .select('id, event_id, connection_id, provider')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!calEvent) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const { data: connection } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('id', calEvent.connection_id)
      .eq('user_id', user.id)
      .single();

    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const encryptedTokens: string = connection.metadata?.tokens;
    if (!encryptedTokens) return NextResponse.json({ error: 'No tokens' }, { status: 400 });

    try {
      if (connection.provider === 'gmail') {
        const onTokenRefresh = async (newEncrypted: string) => {
          await supabase.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
        };
        await updateGmailEvent({ encryptedTokens, onTokenRefresh, eventId: calEvent.event_id, title, startTime, endTime, timezone, attendees: validAttendees, notes });
      } else {
        const onTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
          const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
          await supabase.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
        };
        await updateOutlookEvent({ encryptedTokens, onTokenRefresh, eventId: calEvent.event_id, title, startTime, endTime, timezone, attendees: validAttendees, notes });
      }
    } catch (err: any) {
      if (err?.code === 'calendar_scope_required') {
        return NextResponse.json({ error: 'calendar_scope_required', provider: connection.provider }, { status: 403 });
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
