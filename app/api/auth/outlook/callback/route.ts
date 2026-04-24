import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { getTokenFromCode } from '@/lib/microsoft/oauth';
import { Client } from '@microsoft/microsoft-graph-client';
import { registerOutlookSubscription } from '@/lib/microsoft/outlook-subscriptions';

export async function GET(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin;
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    // Handle user denial
    if (error) {
      const stateData = state ? JSON.parse(Buffer.from(state, 'base64').toString()) : {};
      const errorDest = stateData.flow === 'signup' ? '/login' : '/settings';
      return NextResponse.redirect(`${origin}${errorDest}?error=oauth_denied`);
    }

    if (!code || !state) {
      return NextResponse.redirect(`${origin}/settings?error=invalid_callback`);
    }

    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const isSignupFlow = stateData.flow === 'signup';

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

    const providerAccountId = profile.userPrincipalName || profile.mail;
    const providerEmail = profile.mail || profile.userPrincipalName;

    // Admin Supabase client (service role — bypasses RLS)
    const adminSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const encryptedTokens = Buffer.from(JSON.stringify({
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      expiresOn: tokenResponse.expiresOn,
    })).toString('base64');

    // -------------------------------------------------------------------------
    // SIGNUP FLOW: create/find user, issue magic link for session
    // -------------------------------------------------------------------------
    if (isSignupFlow) {
      let userId: string;
      // magicLinkEmail may differ from providerEmail when the user is signing in
      // with a secondary connection email (their primary auth email is different)
      let magicLinkEmail = providerEmail;

      // Check if this email is already a secondary connection for an existing user
      // (e.g. user signed up with Google, added Outlook, now tries to sign in with Outlook)
      const { data: existingConn } = await adminSupabase
        .from('connections')
        .select('user_id')
        .eq('provider_account_id', providerAccountId)
        .maybeSingle();

      if (existingConn) {
        // Sign them into their real account using their primary auth email
        userId = existingConn.user_id;
        const { data: authUser } = await adminSupabase.auth.admin.getUserById(userId);
        if (!authUser?.user) throw new Error('Could not resolve auth user from connection');
        magicLinkEmail = authUser.user.email!;
        console.log(`[OutlookCallback] Secondary connection sign-in: ${providerAccountId} → user ${userId} (primary: ${magicLinkEmail})`);
      } else {
        // Try to create user — fall back to lookup if already exists
        const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
          email: providerEmail,
          email_confirm: true,
          user_metadata: {
            full_name: profile.displayName,
          },
        });

        if (createError) {
          const msg = createError.message.toLowerCase();
          if (msg.includes('already been registered') || msg.includes('already exists') || msg.includes('email_exists')) {
            // User exists — find their ID
            const { data: { users }, error: listError } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
            if (listError) throw listError;
            const existing = users.find(u => u.email === providerEmail);
            if (!existing) throw new Error('Could not locate existing user');
            userId = existing.id;
          } else {
            throw createError;
          }
        } else {
          userId = newUser.user.id;
        }
      }

      // Upsert connection + profile immediately — robust even if the cookie is later lost
      await adminSupabase.from('connections').upsert({
        user_id: userId,
        provider: 'outlook',
        provider_account_id: providerAccountId,
        status: 'active',
        metadata: {
          email: providerEmail,
          name: profile.displayName,
          picture: null,
          tokens: encryptedTokens,
        },
        last_sync: null,
        sync_status: 'pending',
      }, { onConflict: 'user_id,provider,provider_account_id' });

      await adminSupabase.from('profiles').upsert({
        id: userId,
        email: providerEmail,
        full_name: profile.displayName ?? null,
      }, { onConflict: 'id', ignoreDuplicates: false });

      // Minimal cookie — only needed so finalize-connection can register the push watch
      const pendingPayload = Buffer.from(JSON.stringify({
        userId,
        provider: 'outlook',
        providerAccountId,
      })).toString('base64');

      // Generate a magic link — use magicLinkEmail (primary auth email, may differ for secondary sign-ins)
      const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
        type: 'magiclink',
        email: magicLinkEmail,
        options: {
          redirectTo: `${origin}/auth/oauth-complete?provider=outlook`,
        },
      });

      if (linkError || !linkData?.properties?.action_link) {
        console.error('[OutlookCallback] Failed to generate magic link:', linkError);
        return NextResponse.redirect(`${origin}/login?error=session_failed`);
      }

      const response = NextResponse.redirect(linkData.properties.action_link);
      response.cookies.set('pending_oauth_connection', pendingPayload, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 300, // 5 minutes
        path: '/',
      });
      return response;
    }

    // -------------------------------------------------------------------------
    // RECONNECT FLOW: user already has a session, update their connection
    // -------------------------------------------------------------------------
    const userId = stateData.userId;

    const { error: insertError } = await adminSupabase
      .from('connections')
      .upsert({
        user_id: userId,
        provider: 'outlook',
        provider_account_id: providerAccountId,
        status: 'active',
        metadata: {
          email: providerEmail,
          name: profile.displayName,
          tokens: encryptedTokens,
        },
        last_sync: null,
        sync_status: 'pending',
      }, { onConflict: 'user_id,provider,provider_account_id' });

    if (insertError) {
      console.error('Error storing connection:', insertError);
      return NextResponse.redirect(`${origin}/settings?error=storage_failed`);
    }

    console.log(`✓ Outlook connected for user ${userId}, sync will be triggered by client`);

    // Register Outlook push subscription (non-blocking — failure must not break OAuth flow)
    try {
      const { data: newConnection } = await adminSupabase
        .from('connections')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'outlook')
        .eq('provider_account_id', providerAccountId)
        .single();
      if (newConnection) {
        await registerOutlookSubscription(newConnection, adminSupabase);
      }
    } catch (subErr) {
      console.error('[OutlookCallback] Failed to register subscription (non-fatal):', subErr);
    }

    return NextResponse.redirect(`${origin}/inbox?success=outlook_connected`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${request.nextUrl.origin}/settings?error=callback_failed`);
  }
}
