import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Redirect /signup to /login — OAuth handles both new and existing users
  if (pathname === '/signup') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Auth routes - redirect if already logged in
  const authRoutes = ['/login', '/signup'];
  const isAuthRoute = authRoutes.includes(pathname);

  // Refresh session cookies AND get the user in ONE auth round-trip — updateSession
  // already validated the token, so we don't re-fetch it on a second client.
  // THE HALF-DEAD SESSION: on the auth routes only — the single leg that can close a redirect
  // loop — the verdict comes from a real refresh, so a valid JWT with a dead refresh token is
  // never bounced back to /home. Still one auth call; the protected-route path is untouched.
  const { supabaseResponse, user } = await updateSession(request, { verifyRefreshable: isAuthRoute });

  // Protected routes - require authentication. /work, /join and /suspended
  // need auth but have their own server-side logic for orphan / workspace-state
  // handling, so they don't appear in authRoutes (won't be redirected away).
  const protectedRoutes = ['/home', '/inbox', '/settings', '/activity', '/company', '/admin', '/platform-admin', '/drive', '/meetings', '/work', '/join', '/onboarding', '/suspended'];
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname.startsWith(route)
  );

  // Check if we have auth cookies but no valid user (stale/invalid session)
  const hasAuthCookies = request.cookies.getAll().some(cookie =>
    cookie.name.startsWith('sb-') || cookie.name.includes('auth')
  );

  // Redirect unauthenticated users away from protected routes
  if (isProtectedRoute && !user) {
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);

    // Clear stale auth cookies if present
    if (hasAuthCookies) {
      request.cookies.getAll().forEach(cookie => {
        if (cookie.name.startsWith('sb-') || cookie.name.includes('auth-token')) {
          response.cookies.delete(cookie.name);
        }
      });
    }

    return response;
  }

  // Redirect authenticated users away from auth routes. The auth-route verdict came from a real
  // refresh, so the rotated tokens MUST ride along — dropping them would leave the browser holding
  // a stale refresh token, i.e. manufacture the very half-dead session this fix exists to kill.
  if (isAuthRoute && user) {
    const response = NextResponse.redirect(new URL('/home', request.url));
    supabaseResponse.cookies.getAll().forEach(cookie => {
      response.cookies.set(cookie.name, cookie.value, cookie);
    });
    return response;
  }

  // Clear stale cookies on auth pages if no valid user
  if (isAuthRoute && !user && hasAuthCookies) {
    const response = NextResponse.next({
      request,
    });

    request.cookies.getAll().forEach(cookie => {
      if (cookie.name.startsWith('sb-') || cookie.name.includes('auth-token')) {
        response.cookies.delete(cookie.name);
      }
    });

    // Copy over any valid cookies from supabaseResponse. An empty value is a REMOVAL — copying it
    // back would undo the delete above and leave a dead cookie standing.
    supabaseResponse.cookies.getAll().forEach(cookie => {
      if (!cookie.value) return;
      response.cookies.set(cookie.name, cookie.value, {
        ...cookie,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
    });

    return response;
  }

  // Redirect authenticated users from root to the Home — PRESERVING the query string (deep-link
  // doors like ?view=projects&entity=… must survive the hop; dropping it was the dead
  // "Open project" click, Aug 3).
  if (pathname === '/' && user) {
    const home = new URL('/home', request.url);
    home.search = request.nextUrl.search;
    return NextResponse.redirect(home);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - API routes (handle auth separately)
     */
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
