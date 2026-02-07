import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { getTokenFromCode } from '@/lib/microsoft/oauth';
import { Client } from '@microsoft/microsoft-graph-client';

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
    const redirectUri = `${origin}/api/auth/outlook/callback`;
    const tokenResponse = await getTokenFromCode(code, redirectUri);

    // Get user's profile from Microsoft Graph
    const client = Client.init({
      authProvider: (done) => {
        done(null, tokenResponse.accessToken);
      },
    });

    const profile = await client.api('/me').get();

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
    // MSAL manages refresh tokens internally via cache, we store access token and account info
    const encryptedTokens = Buffer.from(JSON.stringify({
      accessToken: tokenResponse.accessToken,
      expiresOn: tokenResponse.expiresOn,
      account: tokenResponse.account, // Store account for silent token acquisition
    })).toString('base64');

    const { error: insertError } = await supabase
      .from('connections')
      .upsert({
        user_id: userId,
        provider: 'outlook',
        provider_account_id: profile.userPrincipalName || profile.mail,
        account_email: profile.mail || profile.userPrincipalName,
        status: 'active',
        metadata: {
          email: profile.mail || profile.userPrincipalName,
          name: profile.displayName,
          tokens: encryptedTokens
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

    // Success - redirect to inbox
    return NextResponse.redirect(`${origin}/inbox?success=outlook_connected`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${origin}/settings?error=callback_failed`);
  }
}
