import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendGmailInvite, sendOutlookInvite } from '@/lib/calendar/invite-sender';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, startTime, endTime, timezone, attendees, notes, connectionId, includeMeetLink } = body as {
      title: string;
      startTime: string;
      endTime: string;
      timezone: string;
      attendees: string[];
      notes?: string;
      connectionId?: string;
      includeMeetLink?: boolean;
    };

    if (!title || !startTime || !endTime || !timezone || !attendees?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Filter out non-email attendees (names without @) to prevent provider errors
    const validAttendees = attendees.filter((a: string) => a.includes('@'));
    if (validAttendees.length === 0) {
      return NextResponse.json({ error: 'No valid attendee email addresses provided' }, { status: 400 });
    }

    // Get the user's active connection
    let connectionQuery = supabase
      .from('connections')
      .select('id, provider, metadata, provider_account_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook']);

    if (connectionId) {
      connectionQuery = connectionQuery.eq('id', connectionId);
    }

    const { data: connections, error: connError } = await connectionQuery.limit(1).single();
    if (connError || !connections) {
      return NextResponse.json({ error: 'No active email connection found' }, { status: 404 });
    }

    const connection = connections;
    const encryptedTokens: string = connection.metadata?.tokens;
    if (!encryptedTokens) {
      return NextResponse.json({ error: 'No tokens found for connection' }, { status: 400 });
    }

    const onGoogleTokenRefresh = async (newEncrypted: string) => {
      await supabase
        .from('connections')
        .update({ metadata: { ...connection.metadata, tokens: newEncrypted } })
        .eq('id', connection.id);
    };

    const onOutlookTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
      const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
      await supabase
        .from('connections')
        .update({ metadata: { ...connection.metadata, tokens: newEncrypted } })
        .eq('id', connection.id);
    };

    let eventId: string;
    let meetLink: string | undefined;

    try {
      if (connection.provider === 'gmail') {
        const result = await sendGmailInvite({
          encryptedTokens,
          onTokenRefresh: onGoogleTokenRefresh,
          title, startTime, endTime, timezone, notes,
          attendees: validAttendees,
          includeMeetLink: includeMeetLink !== false,
        });
        eventId = result.eventId;
        meetLink = result.meetLink;
      } else {
        const result = await sendOutlookInvite({
          encryptedTokens,
          onTokenRefresh: onOutlookTokenRefresh,
          title, startTime, endTime, timezone, notes,
          attendees: validAttendees,
          includeMeetLink: includeMeetLink !== false,
        });
        eventId = result.eventId;
      }
    } catch (err: any) {
      if (err?.code === 'calendar_scope_required') {
        return NextResponse.json({ error: 'calendar_scope_required', provider: connection.provider }, { status: 403 });
      }
      throw err;
    }

    // Upsert into calendar_events so sidebar refreshes
    await supabase.from('calendar_events').upsert({
      user_id: user.id,
      connection_id: connection.id,
      event_id: eventId,
      calendar_id: 'primary',
      title,
      start_time: startTime,
      end_time: endTime,
      is_all_day: false,
      status: 'confirmed',
      provider: connection.provider,
      attendees: validAttendees.map((email: string) => ({ email, responseStatus: 'needsAction' })),
      meeting_link: meetLink ?? null,
      metadata: meetLink ? { meetLink } : {},
    }, { onConflict: 'user_id,event_id,provider' });

    return NextResponse.json({ eventId, meetLink });
  } catch (err) {
    console.error('[meetings/create] POST error:', err);
    return NextResponse.json({ error: 'Failed to create meeting' }, { status: 500 });
  }
}
