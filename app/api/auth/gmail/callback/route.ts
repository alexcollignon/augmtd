import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { getOAuth2Client } from '@/lib/google/oauth';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin;
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle user denial
    if (error) {
      return NextResponse.redirect(`${origin}/settings?error=oauth_denied`);
    }

    if (!code || !state) {
      return NextResponse.redirect(`${origin}/settings?error=invalid_callback`);
    }

    // Decode state to get user ID
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const userId = stateData.userId;

    // Exchange code for tokens
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user's Gmail profile
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    // Store connection in Supabase (using service role to bypass RLS)
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

    // Encrypt tokens (simple base64 for now, use proper encryption in production)
    const encryptedTokens = Buffer.from(JSON.stringify(tokens)).toString('base64');

    const { error: insertError } = await supabase
      .from('connections')
      .upsert({
        user_id: userId,
        provider: 'gmail',
        provider_account_id: profile.email!,
        status: 'active',
        metadata: {
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          tokens: encryptedTokens // Store encrypted tokens
        },
        last_sync: null,
        sync_status: 'pending'
      }, {
        onConflict: 'user_id,provider,provider_account_id'
      });

    if (insertError) {
      console.error('Error storing connection:', insertError);
      return NextResponse.redirect(`${origin}/settings?error=storage_failed`);
    }

    // Trigger initial sync in background (don't wait for it)
    // Import sync functions and run directly instead of HTTP fetch
    import('@/lib/google/gmail').then(async ({ fetchUnreadEmails, parseGmailMessage }) => {
      const { processEmail } = await import('@/lib/ai/email-processor');

      try {
        console.log(`Starting initial Gmail sync for user ${userId}...`);

        const messages = await fetchUnreadEmails(encryptedTokens, 10, 7);
        console.log(`Fetched ${messages.length} Gmail emails for initial sync`);

        for (const message of messages) {
          try {
            const parsed = parseGmailMessage(message);

            // Check if email already exists
            const { data: existingEmail } = await supabase
              .from('emails')
              .select('id')
              .eq('message_id', parsed.message_id)
              .single();

            if (existingEmail) continue;

            // Store email
            const { data: storedEmail, error: emailError } = await supabase
              .from('emails')
              .insert({ user_id: userId, ...parsed })
              .select()
              .single();

            if (emailError || !storedEmail) continue;

            // Skip if from user
            const userEmail = profile.email;
            if (storedEmail.from_address.toLowerCase() === userEmail?.toLowerCase()) continue;

            // Check if inbox item exists for thread
            const { data: existingInboxItem } = await supabase
              .from('inbox_items')
              .select('id')
              .eq('user_id', userId)
              .eq('source', 'email')
              .eq('source_data->>thread_id', storedEmail.thread_id || storedEmail.message_id)
              .eq('status', 'pending')
              .single();

            if (existingInboxItem) continue;

            // Get thread context
            const { data: threadEmails } = await supabase
              .from('emails')
              .select('*')
              .eq('user_id', userId)
              .eq('thread_id', storedEmail.thread_id || storedEmail.message_id)
              .order('received_at', { ascending: true });

            const threadContext = threadEmails?.map(e => ({
              from_address: e.from_address,
              from_name: e.from_name,
              subject: e.subject,
              body: e.body,
              received_at: e.received_at,
              is_from_user: e.from_address === userEmail
            })) || [];

            // Process with AI
            const processed = await processEmail({
              id: storedEmail.id,
              user_id: storedEmail.user_id,
              message_id: storedEmail.message_id,
              from_address: storedEmail.from_address,
              from_name: storedEmail.from_name,
              subject: storedEmail.subject,
              body: storedEmail.body,
              received_at: storedEmail.received_at,
              thread_context: threadContext
            });

            // Create inbox item
            await supabase.from('inbox_items').insert({
              user_id: userId,
              source: 'email',
              source_id: storedEmail.id,
              work_state: processed.workState,
              work_title: processed.workTitle,
              what_i_prepared: processed.whatIPrepared,
              why_matters: processed.whyMatters,
              source_data: {
                email_id: storedEmail.id,
                message_id: storedEmail.message_id,
                thread_id: storedEmail.thread_id || storedEmail.message_id,
                from: storedEmail.from_address,
                from_name: storedEmail.from_name,
                subject: storedEmail.subject,
                received_at: storedEmail.received_at,
                provider: 'gmail',
                thread_history: threadEmails?.map(e => ({
                  from: e.from_address,
                  from_name: e.from_name,
                  subject: e.subject,
                  received_at: e.received_at,
                  snippet: e.body.substring(0, 150),
                  is_from_user: e.from_address === userEmail
                })),
                summary: processed.summary,
                keyPoints: processed.keyPoints,
                urgency: processed.urgency,
                signals: processed.signals,
                ...processed.preparedOutput
              },
              ai_suggestion_type: processed.workState,
              ai_suggestion_content: processed.summary,
              ai_suggestion_reasoning: processed.reasoning,
              confidence_score: processed.confidence,
              priority: processed.priority,
              status: 'pending',
              needs_review: processed.workState === 'work_prepared' || processed.workState === 'decision_required' || processed.workState === 'waiting'
            });
          } catch (err) {
            console.error('Error processing email in background sync:', err);
          }
        }

        // Update sync status
        await supabase
          .from('connections')
          .update({ sync_status: 'completed', last_sync: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('provider', 'gmail');

        console.log(`✓ Initial Gmail sync completed for user ${userId}`);
      } catch (err) {
        console.error('Background sync failed:', err);
        await supabase
          .from('connections')
          .update({ sync_status: 'failed' })
          .eq('user_id', userId)
          .eq('provider', 'gmail');
      }
    }).catch(err => console.error('Failed to start background sync:', err));

    // Success - redirect to inbox
    return NextResponse.redirect(`${origin}/inbox?success=gmail_connected`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${origin}/settings?error=callback_failed`);
  }
}
