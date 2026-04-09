import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google/oauth';

export async function GET(request: NextRequest) {
  try {
    const state = Buffer.from(JSON.stringify({
      flow: 'signup',
      timestamp: Date.now(),
    })).toString('base64');

    const authUrl = getAuthUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating Gmail signup OAuth:', error);
    return NextResponse.redirect(`${request.nextUrl.origin}/login?error=oauth_init_failed`);
  }
}
