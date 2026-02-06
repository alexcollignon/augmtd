import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { connectionId, maxEmails } = body;

    if (!connectionId || !maxEmails) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (maxEmails < 1 || maxEmails > 100) {
      return NextResponse.json(
        { error: 'maxEmails must be between 1 and 100' },
        { status: 400 }
      );
    }

    // Verify user owns this connection
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('*')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .single();

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }

    // Update connection metadata
    const updatedMetadata = {
      ...connection.metadata,
      max_emails_per_sync: maxEmails,
    };

    const { error: updateError } = await supabase
      .from('connections')
      .update({ metadata: updatedMetadata })
      .eq('id', connectionId);

    if (updateError) {
      console.error('Error updating connection:', updateError);
      return NextResponse.json(
        { error: 'Failed to update settings' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    console.error('Error updating email sync settings:', error);
    return NextResponse.json(
      {
        error: 'Failed to update settings',
        details: error instanceof Error ? error.message : 'Unknown',
      },
      { status: 500 }
    );
  }
}
