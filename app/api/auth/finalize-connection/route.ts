import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { registerGmailWatch } from '@/lib/google/gmail-watch';
import { registerOutlookSubscription } from '@/lib/microsoft/outlook-subscriptions';

export async function POST() {
  // Verify the user has an active session (set by the client-side Supabase)
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const pendingCookie = cookieStore.get('pending_oauth_connection');

  if (!pendingCookie) {
    // No pending connection — nothing to finalize (may have already been processed)
    return NextResponse.json({ ok: true });
  }

  try {
    const payload = JSON.parse(Buffer.from(pendingCookie.value, 'base64').toString());

    // Security: cookie userId must match the authenticated session
    if (payload.userId !== user.id) {
      console.error('[FinalizeConnection] userId mismatch — rejecting');
      cookieStore.delete('pending_oauth_connection');
      return NextResponse.json({ error: 'Session mismatch' }, { status: 403 });
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Connection + profile already upserted in the callback — just register the push watch
    try {
      const { data: connection } = await adminSupabase
        .from('connections')
        .select('*')
        .eq('user_id', payload.userId)
        .eq('provider', payload.provider)
        .eq('provider_account_id', payload.providerAccountId)
        .single();

      if (connection) {
        if (payload.provider === 'gmail') {
          await registerGmailWatch(connection, adminSupabase);
        } else if (payload.provider === 'outlook') {
          await registerOutlookSubscription(connection, adminSupabase);
        }
      }
    } catch (watchErr) {
      console.error('[FinalizeConnection] Push watch registration failed (non-fatal):', watchErr);
    }

    cookieStore.delete('pending_oauth_connection');

    console.log(`[FinalizeConnection] Watch registered for ${payload.provider} / user ${payload.userId}`);
    return NextResponse.json({ ok: true, provider: payload.provider });

  } catch (err) {
    console.error('[FinalizeConnection] Error:', err);
    return NextResponse.json({ error: 'Failed to finalize connection' }, { status: 500 });
  }
}
