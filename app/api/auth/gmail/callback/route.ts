import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { getOAuth2Client } from '@/lib/google/oauth';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle user denial
    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=oauth_denied`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=invalid_callback`
      );
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
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=storage_failed`
      );
    }

    // Success - redirect to settings
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?success=gmail_connected`
    );
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=callback_failed`
    );
  }
}
