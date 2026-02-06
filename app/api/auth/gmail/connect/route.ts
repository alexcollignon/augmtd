import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthUrl } from '@/lib/google/oauth';

export async function GET(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Generate state token (includes user ID for callback)
    const state = Buffer.from(JSON.stringify({
      userId: user.id,
      timestamp: Date.now()
    })).toString('base64');

    // Get Google OAuth URL
    const authUrl = getAuthUrl(state);

    // Redirect to Google
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating Gmail OAuth:', error);
    return NextResponse.json(
      { error: 'Failed to initiate OAuth flow' },
      { status: 500 }
    );
  }
}
