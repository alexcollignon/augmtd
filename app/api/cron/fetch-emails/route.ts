import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { syncEmailsForConnection } from '@/lib/email-sync/sync-emails';

export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel Cron sends this header)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Starting email fetch cron job...');

    // Use service role to bypass RLS
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get all active email connections (Gmail + Outlook)
    const { data: connections, error: connectionsError } = await supabase
      .from('connections')
      .select('*')
      .in('provider', ['gmail', 'outlook'])
      .eq('status', 'active');

    if (connectionsError) {
      console.error('Error fetching connections:', connectionsError);
      return NextResponse.json(
        { error: 'Failed to fetch connections' },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      console.log('No active email connections found');
      return NextResponse.json({
        success: true,
        message: 'No connections to process',
        processed: 0
      });
    }

    console.log(`Found ${connections.length} active email connections`);

    let totalEmailsFetched = 0;
    let totalInboxItems = 0;
    const errors: string[] = [];

    // Process each connection (Gmail or Outlook)
    for (const connection of connections) {
      console.log(`Syncing ${connection.provider} emails for user ${connection.user_id}...`);

      const result = await syncEmailsForConnection(connection, supabase);

      totalEmailsFetched += result.emailsFetched;
      totalInboxItems += result.inboxItemsCreated;
      errors.push(...result.errors);
    }

    console.log(`Cron job completed. Fetched: ${totalEmailsFetched}, Inbox items: ${totalInboxItems}`);

    return NextResponse.json({
      success: true,
      processed: connections.length,
      emailsFetched: totalEmailsFetched,
      inboxItemsCreated: totalInboxItems,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
