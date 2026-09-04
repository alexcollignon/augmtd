import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

/**
 * A definitive auth verdict (4xx from the auth server: dead/rotated refresh token, missing
 * session, revoked JWT) vs. a transport hiccup (network error, 5xx). Only a definitive verdict
 * may log someone out — a Supabase blip must never clear a healthy user's cookies.
 */
function isDefinitiveAuthError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; status?: number; code?: string };
  if (typeof e.status === 'number') return e.status >= 400 && e.status < 500;
  // AuthSessionMissingError carries no status — there is simply no session to refresh.
  return e.name === 'AuthSessionMissingError';
}

/**
 * THE HALF-DEAD SESSION (Sep 2026 — the /home ⇄ /login ERR_TOO_MANY_REDIRECTS loop).
 *
 * A session can be half-dead: the access-token JWT is still unexpired (so `getUser()` validates
 * it and happily returns a user) while the REFRESH token is already dead — single-use rotation
 * means a second browser signing into the same account leaves this one's token stale
 * (`refresh_token_already_used`, then `refresh_token_not_found` once the family is revoked).
 * Middleware then called the session authenticated and bounced /login → /home, while anything
 * that actually tried to refresh called it dead and bounced back → an infinite 307 loop that only
 * ended when the JWT finally expired (~1h).
 *
 * The cure is to make the AUTH-ROUTE verdict match what the session can actually sustain: on
 * /login and /signup — the only leg that can close the loop — the verdict comes from a real
 * refresh instead of a JWT check. That is still exactly ONE auth round-trip, and every other
 * route (the whole healthy path) keeps the untouched single `getUser()` call.
 */
export async function updateSession(
  request: NextRequest,
  opts: { verifyRefreshable?: boolean } = {}
): Promise<{ supabaseResponse: NextResponse; user: User | null }> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const secureOptions = {
              ...options,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax' as const,
              // A 7-day life for a real session cookie — but NEVER for a removal. An empty value
              // is @supabase/ssr deleting the session; forcing maxAge onto it resurrected a dead
              // cookie for a week and kept `hasAuthCookies` true forever.
              ...(value === '' ? {} : { maxAge: 60 * 60 * 24 * 7 }),
            };

            request.cookies.set(name, value);
            supabaseResponse = NextResponse.next({
              request,
            });
            supabaseResponse.cookies.set(name, value, secureOptions);
          });
        },
      },
    }
  );

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // THE AUTH-ROUTE VERDICT: a session that cannot refresh is effectively logged out, even while
  // its JWT is briefly still valid. One call (refresh, not getUser) — never two on the happy path.
  // A 4xx is definitive → user null → the caller clears the cookies and /login stands, once.
  // A transport hiccup falls through to the normal getUser verdict (fail-open, never a blip logout).
  if (opts.verifyRefreshable) {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.user) return { supabaseResponse, user: data.user };
      if (isDefinitiveAuthError(error)) return { supabaseResponse, user: null };
    } catch {
      // fall through to getUser
    }
  }

  let user: User | null = null;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    // An auth-server hiccup must never throw out of middleware. No verdict = no user for this
    // request; the caller only clears cookies on a protected route, and the next request retries.
    user = null;
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  // Return the user too so the caller doesn't re-validate the token (a second
  // network round-trip to the auth server) on every request.
  return { supabaseResponse, user };
}
