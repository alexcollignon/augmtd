import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('Auth callback error:', error);
      // Redirect to login with error message
      const loginUrl = new URL('/login', origin);
      loginUrl.searchParams.set('error', 'auth_callback_failed');
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirect to inbox on success
  return NextResponse.redirect(`${origin}/inbox`);
}
