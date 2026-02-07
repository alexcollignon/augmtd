import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);

    // Check if user has Gmail connection
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: connection } = await supabase
        .from('connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('provider', 'gmail')
        .eq('status', 'active')
        .single();

      // Redirect to onboarding if no Gmail connection, otherwise inbox
      if (!connection) {
        return NextResponse.redirect(`${origin}/onboarding`);
      }
    }
  }

  // Redirect to inbox after successful auth
  return NextResponse.redirect(`${origin}/inbox`);
}
