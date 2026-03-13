import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rsvpGmail, rsvpOutlook } from '@/lib/calendar/rsvp';

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

    // Fetch the calendar_events row
    const { data: calEvent, error: evtError } = await supabase
      .from('calendar_events')
      .select('id, event_id, connection_id, provider, attendees, title')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (evtError || !calEvent) {
      return NextResponse.json({ error: 'Calendar event not found' }, { status: 404 });
    }

    // Get connection tokens
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('id, provider, metadata, provider_account_id')
      .eq('id', calEvent.connection_id)
      .single();

    if (connError || !connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

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

    try {
      if (calEvent.provider === 'gmail') {
        await rsvpGmail({
          encryptedTokens,
          onTokenRefresh: onGoogleTokenRefresh,
          eventId: calEvent.event_id,
          response,
          userEmail: connection.provider_account_id,
        });
      } else {
        await rsvpOutlook({
          encryptedTokens,
          onTokenRefresh: onOutlookTokenRefresh,
          eventId: calEvent.event_id,
          response,
        });
      }
    } catch (err: any) {
      if (err?.code === 'calendar_scope_required') {
        return NextResponse.json({ error: 'calendar_scope_required', provider: calEvent.provider }, { status: 403 });
      }
      throw err;
    }

    // Update attendees in DB to reflect the new response status
    const rsvpStatusMap: Record<string, string> = {
      accepted: 'accepted',
      tentative: 'tentative',
      declined: 'declined',
    };
    const updatedAttendees = (calEvent.attendees ?? []).map((a: any) => {
      if (a.email === connection.provider_account_id || a.self) {
        // Set both fields: sync stores 'status', Google API uses 'responseStatus'
        return { ...a, status: rsvpStatusMap[response], responseStatus: rsvpStatusMap[response] };
      }
      return a;
    });

    await supabase
      .from('calendar_events')
      .update({ attendees: updatedAttendees })
      .eq('id', id);

    // Auto-complete any pending calendar invite inbox items for this event.
    // Invite emails have subjects like "Convite: {title} @..." or "Invitation: {title} @..."
    // Use .filter() for JSONB text extraction — .ilike() doesn't handle ->> operator reliably.
    if (calEvent.title) {
      await supabase
        .from('inbox_items')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .filter('source_data->>subject', 'ilike', `%${calEvent.title}%`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[meetings/rsvp] POST error:', err);
    return NextResponse.json({ error: 'Failed to update RSVP' }, { status: 500 });
  }
}
