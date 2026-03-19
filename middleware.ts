import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Update session cookies first
  let supabaseResponse = await updateSession(request);

  // Get user from the updated session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes - require authentication
  const protectedRoutes = ['/inbox', '/settings', '/activity', '/company', '/processes', '/admin', '/platform-admin', '/drive', '/meetings'];
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname.startsWith(route)
  );

  // Auth routes - redirect if already logged in
  const authRoutes = ['/login', '/signup'];
  const isAuthRoute = authRoutes.includes(pathname);

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

  // Redirect authenticated users away from auth routes
  if (isAuthRoute && user) {
    const inboxUrl = new URL('/inbox', request.url);
    return NextResponse.redirect(inboxUrl);
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

    // Copy over any valid cookies from supabaseResponse
    supabaseResponse.cookies.getAll().forEach(cookie => {
      response.cookies.set(cookie.name, cookie.value, {
        ...cookie,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
    });

    return response;
  }

  // Redirect authenticated users from root to inbox
  if (pathname === '/' && user) {
    const inboxUrl = new URL('/inbox', request.url);
    return NextResponse.redirect(inboxUrl);
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
