import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin;

    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(`${origin}/settings?error=unauthorized`);
    }

    // Delete Gmail connection
    const { error: deleteError } = await supabase
      .from('connections')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'gmail');

    if (deleteError) {
      console.error('Error disconnecting Gmail:', deleteError);
      return NextResponse.redirect(`${origin}/settings?error=disconnect_failed`);
    }

    return NextResponse.redirect(`${origin}/settings?success=disconnected`);
  } catch (error) {
    console.error('Disconnect error:', error);
    return NextResponse.redirect(`${request.nextUrl.origin}/settings?error=server_error`);
  }
}
