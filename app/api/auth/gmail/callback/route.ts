import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@supabase/supabase-js';
import { getOAuth2Client } from '@/lib/google/oauth';
import { google } from 'googleapis';
import { registerGmailWatch } from '@/lib/google/gmail-watch';

// The server-side INITIAL SYNC runs in this route's after() — the function budget must cover a
// full first sync (fetch + classify + AI phase 2 ≈ 60–150s). Without this, the default budget
// KILLED the sync partway on real signups: mail stored newest-first then silently truncated (and
// the single-flight claim then blocks the client's retry until the 10-min stale release).
export const maxDuration = 300;

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
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user's Gmail profile
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    // Admin Supabase client (service role — bypasses RLS)
    const adminSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const encryptedTokens = Buffer.from(JSON.stringify(tokens)).toString('base64');

    // -------------------------------------------------------------------------
    // SIGNUP FLOW: create/find user, issue magic link for session
    // -------------------------------------------------------------------------
    if (isSignupFlow) {
      let userId: string;
      // magicLinkEmail may differ from profile.email when the user is signing in
      // with a secondary connection email (their primary auth email is different)
      let magicLinkEmail = profile.email!;

      // Check if this email is already a secondary connection for an existing user
      // (e.g. user signed up with Google, added Outlook, now tries to sign in with Outlook)
      const { data: existingConn } = await adminSupabase
        .from('connections')
        .select('user_id')
        .eq('provider_account_id', profile.email)
        .maybeSingle();

      if (existingConn) {
        // Sign them into their real account using their primary auth email
        userId = existingConn.user_id;
        const { data: authUser } = await adminSupabase.auth.admin.getUserById(userId);
        if (!authUser?.user) throw new Error('Could not resolve auth user from connection');
        magicLinkEmail = authUser.user.email!;
        console.log(`[GmailCallback] Secondary connection sign-in: ${profile.email} → user ${userId} (primary: ${magicLinkEmail})`);
      } else {
        // Try to create user — fall back to lookup if already exists
        const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
          email: profile.email!,
          email_confirm: true,
          user_metadata: {
            full_name: profile.name,
            avatar_url: profile.picture,
          },
        });

        if (createError) {
          const msg = createError.message.toLowerCase();
          if (msg.includes('already been registered') || msg.includes('already exists') || msg.includes('email_exists')) {
            // User exists — find their ID
            const { data: { users }, error: listError } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
            if (listError) throw listError;
            const existing = users.find(u => u.email === profile.email);
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
        provider: 'gmail',
        provider_account_id: profile.email,
        status: 'active',
        metadata: {
          email: profile.email,
          name: profile.name,
          picture: profile.picture ?? null,
          tokens: encryptedTokens,
        },
        last_sync: null,
        sync_status: 'pending',
      }, { onConflict: 'user_id,provider,provider_account_id' });

      await adminSupabase.from('profiles').upsert({
        id: userId,
        email: profile.email,
        full_name: profile.name ?? null,
      }, { onConflict: 'id', ignoreDuplicates: false });

      // Minimal cookie — only needed so finalize-connection can register the push watch
      const pendingPayload = Buffer.from(JSON.stringify({
        userId,
        provider: 'gmail',
        providerAccountId: profile.email,
      })).toString('base64');

      // Generate a magic link — use magicLinkEmail (primary auth email, may differ for secondary sign-ins)
      const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
        type: 'magiclink',
        email: magicLinkEmail,
        options: {
          redirectTo: `${origin}/auth/oauth-complete?provider=gmail`,
        },
      });

      if (linkError || !linkData?.properties?.action_link) {
        console.error('[GmailCallback] Failed to generate magic link:', linkError);
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
        provider: 'gmail',
        provider_account_id: profile.email!,
        status: 'active',
        metadata: {
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          tokens: encryptedTokens,
        },
        last_sync: null,
        sync_status: 'pending',
      }, { onConflict: 'user_id,provider,provider_account_id' });

    if (insertError) {
      console.error('Error storing connection:', insertError);
      return NextResponse.redirect(`${origin}/settings?error=storage_failed`);
    }

    console.log(`✓ Gmail connected for user ${userId}, firing server-side initial sync`);

    // Register Gmail push watch (non-blocking — failure must not break OAuth flow)
    try {
      const { data: newConnection } = await adminSupabase
        .from('connections')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .eq('provider_account_id', profile.email!)
        .single();
      if (newConnection) {
        await registerGmailWatch(newConnection, adminSupabase);
        // SERVER-SIDE INITIAL SYNC (after the redirect is sent): the first sync must never depend
        // on which page the browser lands on — the client's /inbox trigger stays as a belt-and-
        // braces duplicate (message-id dedup + the first-look claim make the race harmless).
        const { after } = await import('next/server');
        after(async () => {
          try {
            const { syncEmailsForConnection } = await import('@/lib/email-sync/sync-emails');
            await syncEmailsForConnection(newConnection, adminSupabase);
          } catch (e) { console.warn('[GmailCallback] initial sync failed (cron will retry):', e); }
        });
      }
    } catch (watchErr) {
      console.error('[GmailCallback] Failed to register watch (non-fatal):', watchErr);
    }

    return NextResponse.redirect(`${origin}/inbox?success=gmail_connected`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${request.nextUrl.origin}/settings?error=callback_failed`);
  }
}
